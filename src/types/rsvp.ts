import { z } from "zod";

export const RsvpSchema = z.object({
  rsvpName: z.string().min(1),
  rsvpEmail: z.string().email(),
  eventId: z.number().int().positive(),
});

export type Rsvp = z.infer<typeof RsvpSchema>;
