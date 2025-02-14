import express, { Application, Request, Response, NextFunction } from "express";
import { EventSchema } from "./types/event";
import { EventService } from "./services/eventService";
import { errorHandler } from "./middleware/errorHandler";
import { createEvent, EventAttributes } from "ics";
import multer from "multer";
import db from "./database";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { validateAdminPin } from "./middleware/adminAuth";
import { RsvpSchema } from "./types/rsvp";
import QRCode from "qrcode";
import { Payment } from "./types/payment";
import axios from "axios";

dotenv.config();

const app: Application = express();
const eventService = new EventService(db);
const upload = multer(); // Initialize multer

// Rate limiter configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: "Too many requests, please try again later" },
});

// Additional rate limiter for admin routes
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // Stricter limit for admin routes
  message: { error: "Too many admin requests, please try again later" },
});

// CORS configuration
const corsOptions = {
  origin: "*", // Be more specific in production!
  methods: ["GET", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200,
};

// Middleware
app.use(cors(corsOptions)); // Use configured CORS
app.use(limiter); // Apply rate limiting to all routes
app.use(express.urlencoded({ extended: true })); // For regular form data

// In-memory store for pending payments (replace with database in production)
const payments = new Map<string, Payment>();

// Function to generate a new invoice
const generateInvoice = async (
  eventPrice: number
): Promise<{
  invoiceId?: string;
  lnInvoice?: string;
  error?: string;
}> => {
  try {
    const bitcoinPrices = await axios.get(
      "https://mempool.space/api/v1/prices"
    );

    if (!bitcoinPrices?.data?.GBP) {
      throw new Error("Could not fetch Bitcoin price");
    }

    const bitcoinAmount = eventPrice / bitcoinPrices?.data?.GBP;

    const authHeaders = {
      Authorization: `Bearer ${process.env.STRIKE_API_KEY}`,
    };

    const invoiceRequestBody = {
      amount: {
        amount: `${bitcoinAmount}`,
        currency: "BTC",
      },
      description: "Events App Test Payment",
    };

    const invoiceResponse = await axios.post(
      "https://api.strike.me/v1/invoices",
      invoiceRequestBody,
      { headers: authHeaders }
    );

    const invoiceId = invoiceResponse.data.invoiceId;

    if (!invoiceId?.length) {
      throw new Error("Invoice ID not found");
    }

    const quoteResponse = await axios.post(
      `https://api.strike.me/v1/invoices/${invoiceId}/quote`,
      {},
      { headers: authHeaders }
    );

    const lnInvoice = quoteResponse.data.lnInvoice;

    return {
      invoiceId,
      lnInvoice,
    };
  } catch (error) {
    return {
      error: (error as any)?.message || "Unknown error",
    };
  }
};

// Function to check invoice status
const checkInvoiceStatus = async (invoiceId: string): Promise<boolean> => {
  const authHeaders = {
    Authorization: `Bearer ${process.env.STRIKE_API_KEY}`,
  };

  try {
    const invoiceResponse = await axios.get(
      `https://api.strike.me/v1/invoices/${invoiceId}`,
      { headers: authHeaders }
    );

    const state = invoiceResponse.data.state;

    if (!state?.length) {
      throw new Error("Invoice status not found");
    }

    const success = state === "PAID";

    return success;
  } catch (error) {
    return false;
  }
};

// Get latest events (replacing hello world)
app.get("/events", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await eventService.getLatestEvents();
    res.json(events);
  } catch (error) {
    next(error);
  }
});

// Generate and download ICS file
app.get(
  "/events/:eventId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventId = parseInt(req.params.eventId);

      if (isNaN(eventId)) {
        res.status(400).json({ error: "Invalid event ID" });
        return;
      }

      const event = await eventService.getEventById(eventId);

      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }

      const startDate = new Date(event.eventDate);
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000); // Add 2 hours as default duration

      const icsEvent: EventAttributes = {
        start: [
          startDate.getFullYear(),
          startDate.getMonth() + 1,
          startDate.getDate(),
          startDate.getHours(),
          startDate.getMinutes(),
        ],
        end: [
          endDate.getFullYear(),
          endDate.getMonth() + 1,
          endDate.getDate(),
          endDate.getHours(),
          endDate.getMinutes(),
        ],
        title: event.eventTitle,
        description: event.eventDescription,
        location: event.eventLocation,
        status: "CONFIRMED",
      };

      createEvent(icsEvent, (error: Error | undefined, value: string) => {
        if (error) {
          next(error);
          return;
        }

        res.set("Content-Type", "text/calendar");
        res.set(
          "Content-Disposition",
          `attachment; filename=${event.eventTitle.replace(/\s+/g, "_")}.ics`
        );
        res.send(value);
      });
    } catch (error) {
      next(error);
    }
  }
);

// Handle payments
app.get("/payment-status/:invoiceId", async (req: Request, res: Response) => {
  const invoiceId = req.params.invoiceId;

  const payment = payments.get(invoiceId);

  if (!payment) {
    res.json({ paid: false });
    return;
  }

  if (payment.paid) {
    try {
      // Process RSVP if payment is confirmed
      await eventService.addRsvp(payment.rsvpData);
      // Clean up pending payment
      payments.delete(invoiceId);
    } catch (error) {
      console.error("Error processing RSVP after payment:", error);
    }
  } else {
    const paid = await checkInvoiceStatus(invoiceId);

    if (paid) {
      payments.set(invoiceId, {
        ...payment,
        paid,
      });
    }
  }

  res.json({ paid: payment.paid });
});

// Handle RSVP submissions
app.post(
  "/events/rsvp",
  upload.none(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rsvpData = {
        rsvpName: req.body.rsvpName,
        rsvpEmail: req.body.rsvpEmail,
        eventId: parseInt(req.body.eventId),
      };

      const validatedRsvpData = RsvpSchema.parse(rsvpData);

      // Check if event exists
      const event = await eventService.getEventById(validatedRsvpData.eventId);

      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }

      if (event.eventPrice > 0) {
        // Generate invoice
        const { invoiceId, lnInvoice, error } = await generateInvoice(
          event.eventPrice
        );

        if (error || !invoiceId || !lnInvoice) {
          res.status(500).json({
            error: `Could not generate invoice${error ? ` - ${error}` : ""}`,
          });
          return;
        }

        // Store payment information
        payments.set(invoiceId, {
          id: invoiceId,
          amount: event.eventPrice,
          rsvpData: validatedRsvpData,
          paid: false,
          created: new Date(),
        });

        // Generate QR code for payment
        const qrCodeData = `${lnInvoice}`; // Replace with your actual payment URL
        const qrCodeImage = await QRCode.toDataURL(qrCodeData);

        const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                margin: 20px;
                line-height: 1.5;
                text-align: center;
              }
              .qr-container {
                margin: 20px auto;
              }
              .amount {
                font-size: 24px;
                font-weight: bold;
                margin: 20px 0;
              }
              .invoice-container {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                margin: 16px auto;
                max-width: 600px;
              }
              input {
                flex: 1;
                padding: 12px;
                border: 1px solid #ddd;
                border-radius: 6px;
                font-size: 14px;
                font-family: monospace;
                width: 100%;
                background: #f5f5f5;
                cursor: text;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: ellipsis;
              }
              .copy-btn, .wallet-btn {
                padding: 12px 16px;
                border: none;
                border-radius: 6px;
                background: #007AFF;
                color: white;
                cursor: pointer;
                font-size: 14px;
                white-space: nowrap;
                transition: background 0.2s;
              }
              .copy-btn:hover, .wallet-btn:hover {
                background: #0056b3;
              }
              .status {
                color: #666;
                margin: 10px 0;
              }
            </style>
            <script>
              function copyToClipboard() {
                const input = document.querySelector('input');
                input.select();
                document.execCommand('copy');
                const copyBtn = document.querySelector('.copy-btn');
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                  copyBtn.textContent = 'Copy Invoice';
                }, 2000);
              }

              async function openInWallet() {
                // Try WebLN (browser wallets) first
                if (window.webln) {
                  try {
                    await window.webln.enable();
                    await window.webln.sendPayment('${qrCodeData}');
                    return;
                  } catch (e) {
                    console.log('WebLN failed:', e);
                  }
                }

                // Fallback to lightning: protocol (desktop wallets)
                const hasDesktopWallet = await new Promise((resolve) => {
                  const timeout = setTimeout(() => resolve(false), 100);
                  window.addEventListener('blur', () => {
                    clearTimeout(timeout);
                    resolve(true);
                  }, { once: true });
                  window.location.href = 'lightning:${qrCodeData}';
                });

                // If no wallet handled the protocol, suggest installing one
                if (!hasDesktopWallet) {
                  const installWallet = confirm('No Lightning wallet detected. Would you like to install one?');
                  if (installWallet) {
                    window.open('https://getalby.com', '_blank');
                  }
                }
              }

              // Check payment status every 5 seconds
              function checkPaymentStatus() {
                fetch('/payment-status/${invoiceId}')
                  .then(response => response.json())
                  .then(data => {
                    if (data.paid && (${
                      process.env.CARRD_URL?.length ?? 0
                    } >= 1)) {
                      window.location.href = '${
                        process.env.CARRD_URL
                      }/?rsvp-success=true&event-id=${
          validatedRsvpData.eventId
        }';
                    }
                  });
              }

              // Update countdown timer
              function updateTimer() {
                const timerElement = document.getElementById('timer');
                let seconds = 5; // 5 seconds countdown
                
                setInterval(() => {
                  seconds--;
                  timerElement.textContent = \`Checking payment status in \${seconds + 1}s...\`;
                  
                  if (seconds <= 0) {
                    checkPaymentStatus();
                    seconds = 5; // Reset countdown
                  }
                }, 1000);
              }

              // Initialize timer when page loads
              window.onload = updateTimer;
            </script>
          </head>
          <body>
            <h1>Payment Required</h1>
            <div class="amount">£${event.eventPrice.toFixed(2)}</div>
            <div class="qr-container">
              <img src="${qrCodeImage}" alt="Payment QR Code">
            </div>
            <p>Scan the QR code to complete your payment, or copy/paste this invoice into your wallet:</p>
            <div class="invoice-container">
              <input type="text" value="${qrCodeData}" readonly />
              <button class="copy-btn" onclick="copyToClipboard()">Copy Invoice</button>
              <button class="wallet-btn" onclick="openInWallet()">Open in Wallet</button>
            </div>
            <p>After payment, your RSVP will be automatically confirmed</p>
            <div id="timer" class="status">Checking payment status...</div>
          </body>
        </html>
      `;

        res.send(html);
        return;
      }

      // Save RSVP to database
      await eventService.addRsvp(validatedRsvpData);

      if (process.env.CARRD_URL) {
        res.redirect(
          `${process.env.CARRD_URL}/?rsvp-success=true&event-id=${validatedRsvpData.eventId}`
        );
      } else {
        res.status(201).json({
          message: "RSVP submitted successfully",
          rsvp: validatedRsvpData,
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

// Add new event
app.post(
  "/create-event",
  adminLimiter,
  upload.none(),
  validateAdminPin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventData = {
        ...req.body,
        eventPrice: Number(req.body.eventPrice),
      };
      delete eventData.adminPIN;

      const validatedEventData = EventSchema.parse(eventData);
      const eventId = await eventService.addEvent(validatedEventData);

      if (process.env.CARRD_URL) {
        res.redirect(
          `${process.env.CARRD_URL}?create-event-success=true&event-id=${eventId}`
        );
      } else {
        res.status(201).json({
          message: "Event created successfully",
          eventId,
          event: validatedEventData,
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

// Delete event
app.post(
  "/delete-event",
  adminLimiter,
  upload.none(),
  validateAdminPin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventId = parseInt(req.body.eventId);

      if (isNaN(eventId)) {
        res.status(400).json({ error: "Invalid event ID" });
        return;
      }

      await eventService.deleteEvent(eventId);

      if (process.env.CARRD_URL) {
        res.redirect(
          `${process.env.CARRD_URL}/?delete-event-success=true&event-id=${eventId}`
        );
      } else {
        res.status(200).json({
          message: "Event deleted successfully",
          eventId,
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

// Delete event
app.get(
  "/list-rsvps",
  adminLimiter,
  validateAdminPin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rsvps = await eventService.getAllRsvpsWithEvents();

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                margin: 20px;
                line-height: 1.5;
              }
              .event-group {
                margin-bottom: 30px;
              }
              .rsvp-item {
                margin: 10px 0;
              }
            </style>
          </head>
          <body>
            <h1>Event RSVPs</h1>
            ${rsvps
              .map(
                (event) => `
              <div class="event-group">
                <h2>${event.eventTitle} - ${new Date(
                  event.eventDate
                ).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}</h2>
                ${
                  event.rsvps.length === 0
                    ? "<p>No RSVPs yet</p>"
                    : event.rsvps
                        .map(
                          (rsvp) => `
                    <div class="rsvp-item">
                      ${rsvp.rsvpName} (${rsvp.rsvpEmail}) - ${new Date(
                            rsvp.createdAt
                          ).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                    </div>
                  `
                        )
                        .join("")
                }
              </div>
            `
              )
              .join("")}
          </body>
        </html>
      `;

      res.send(html);
    } catch (error) {
      next(error);
    }
  }
);

// Error handling middleware
app.use(errorHandler);

// Handle cleanup on shutdown
process.on("SIGINT", () => {
  db.close((err) => {
    if (err) {
      console.error("Error closing database:", err);
    } else {
      console.log("Database connection closed");
    }
    process.exit(0);
  });
});

export default app;
