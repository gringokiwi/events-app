import { z } from "zod";

// Zod schema for validation
export const EventSchema = z.object({
  eventTitle: z.string().min(1, "Title is required"),
  eventDescription: z.string(),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  eventStartTime: z
    .string()
    .regex(
      /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
      "Start time must be in HH:MM format"
    ),
  eventEndTime: z
    .string()
    .regex(
      /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
      "End time must be in HH:MM format"
    ),
  eventPrice: z.number().min(0, "Price must be non-negative"),
  eventLocation: z.string().min(1, "Location is required"),
});

export type Event = z.infer<typeof EventSchema>;

export interface EventWithId extends Event {
  id: number;
  createdAt: string;
}
