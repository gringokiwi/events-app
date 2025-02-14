import { Database } from "sqlite3";
import { Event, EventWithId } from "../types/event";
import FormData from "form-data";
import Mailgun from "mailgun.js";

export class EventService {
  constructor(private db: Database) {}

  async addEvent(event: Event): Promise<number> {
    return new Promise((resolve, reject) => {
      const sql = `
                INSERT INTO events (
                    eventTitle,
                    eventDescription,
                    eventDate,
                    eventStartTime,
                    eventEndTime,
                    eventPrice,
                    eventLocation
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `;

      this.db.run(
        sql,
        [
          event.eventTitle,
          event.eventDescription,
          event.eventDate,
          event.eventStartTime,
          event.eventEndTime,
          event.eventPrice,
          event.eventLocation,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  async getLatestEvents(limit: number = 10): Promise<EventWithId[]> {
    return new Promise((resolve, reject) => {
      const sql = `
                SELECT * FROM events 
                ORDER BY eventDate DESC, eventStartTime DESC 
                LIMIT ?
            `;

      this.db.all(sql, [limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as EventWithId[]);
        }
      });
    });
  }

  async deleteEvent(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run("DELETE FROM events WHERE id = ?", [id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getEventById(eventId: number): Promise<Event | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT * FROM events WHERE id = ?",
        [eventId],
        (err, row) => {
          if (err) reject(err);
          resolve((row as Event) || null);
        }
      );
    });
  }

  async addRsvp(rsvpData: {
    rsvpName: string;
    rsvpEmail: string;
    eventId: number;
  }): Promise<number> {
    const mailgun = new Mailgun(FormData);

    const mg = mailgun.client({
      username: "api",
      key: process.env.MAILGUN_API_KEY || "",
    });

    try {
      const eventData = await this.getEventById(rsvpData.eventId);
      const subject = `New RSVP for "${
        eventData?.eventTitle ?? `EVENT_TITLE`
      }" at ${eventData?.eventDate ?? `EVENT_DATE`}`;

      const data = await mg.messages.create(
        process.env.MAILGUN_DOMAIN as string,
        {
          from: `Mailgun Sandbox <postmaster@${process.env.MAILGUN_DOMAIN}>`,
          to: JSON.parse(process.env.MAILGUN_RECEIVERS as string),
          subject,
          html: `
            <p>${subject}:</p>
            <p><strong>Name:</strong> ${rsvpData.rsvpName}</p>
            <p><strong>Email:</strong> ${rsvpData.rsvpEmail}</p>
          `,
        }
      );

      console.log(data); // logs response data
    } catch (error) {
      console.log(error); //logs any error
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO rsvps (eventId, rsvpName, rsvpEmail) VALUES (?, ?, ?)`,
        [rsvpData.eventId, rsvpData.rsvpName, rsvpData.rsvpEmail],
        function (err) {
          if (err) reject(err);
          resolve(this.lastID);
        }
      );
    });
  }

  async getAllRsvpsWithEvents(): Promise<
    Array<{
      eventId: number;
      eventTitle: string;
      eventDate: string;
      rsvps: Array<{
        rsvpName: string;
        rsvpEmail: string;
        createdAt: string;
      }>;
    }>
  > {
    return new Promise((resolve, reject) => {
      this.db.all(
        `
        SELECT 
          e.id as eventId,
          e.eventTitle,
          e.eventDate,
          r.rsvpName,
          r.rsvpEmail,
          r.createdAt
        FROM events e
        LEFT JOIN rsvps r ON e.id = r.eventId
        ORDER BY e.eventDate DESC, r.createdAt DESC
      `,
        [],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          // Group RSVPs by event
          const eventMap = new Map();

          const typecastedRows = rows as unknown as {
            eventId: number;
            eventTitle: string;
            eventDate: string;
            rsvpName: string;
            rsvpEmail: string;
            createdAt: Date;
          }[];

          typecastedRows.forEach((row) => {
            if (!eventMap.has(row.eventId)) {
              eventMap.set(row.eventId, {
                eventId: row.eventId,
                eventTitle: row.eventTitle,
                eventDate: row.eventDate,
                rsvps: [],
              });
            }

            if (row.rsvpName && row.rsvpEmail) {
              eventMap.get(row.eventId).rsvps.push({
                rsvpName: row.rsvpName,
                rsvpEmail: row.rsvpEmail,
                createdAt: row.createdAt,
              });
            }
          });

          resolve(Array.from(eventMap.values()));
        }
      );
    });
  }
}
