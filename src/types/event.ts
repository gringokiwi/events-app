import { z } from "zod";

// Zod schema for validation
export const EventSchema = z.object({
  event_title: z.string().min(1, "Title is required"),
  event_description: z.string(),
  event_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  event_start_time: z
    .string()
    .regex(
      /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
      "Start time must be in HH:MM format"
    ),
  event_end_time: z
    .string()
    .regex(
      /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
      "End time must be in HH:MM format"
    ),
  event_price: z.number().min(0, "Price must be non-negative"),
  event_location: z.string().min(1, "Location is required"),
});

export type Event = z.infer<typeof EventSchema>;

export interface EventWithId extends Event {
  id: number;
  created_at: string;
}
