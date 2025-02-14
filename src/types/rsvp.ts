import { z } from "zod";

export const RsvpSchema = z.object({
  rsvp_name: z.string().min(1),
  rsvp_email: z.string().email(),
  event_id: z.number().int().positive(),
});

export type Rsvp = z.infer<typeof RsvpSchema>;
