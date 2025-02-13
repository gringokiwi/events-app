import { Rsvp } from "./rsvp";

export type Payment = {
  id: string;
  amount: number;
  rsvpData: Rsvp;
  paid: boolean;
  created: Date;
};
