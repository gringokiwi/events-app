import { SupabaseClient } from "@supabase/supabase-js";
import { Event, EventWithId } from "../types/event";
import FormData from "form-data";
import Mailgun from "mailgun.js";

export class EventService {
  constructor(private supabase: SupabaseClient<any, "public", any>) {}

  async addEvent(event: Event): Promise<number> {
    const { data, error } = await this.supabase
      .from("events")
      .insert([
        {
          event_title: event.event_title,
          event_description: event.event_description,
          event_date: event.event_date,
          event_start_time: event.event_start_time,
          event_end_time: event.event_end_time,
          event_price: event.event_price,
          event_location: event.event_location,
        },
      ])
      .select();

    if (error) throw error;
    return data[0].id;
  }

  async getLatestEvents(limit: number = 10): Promise<EventWithId[]> {
    const { data, error } = await this.supabase
      .from("events")
      .select()
      .order("event_date", { ascending: false })
      .order("event_start_time", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  }

  async deleteEvent(id: number): Promise<void> {
    const { error } = await this.supabase.from("events").delete().eq("id", id);

    if (error) throw error;
  }

  async getEventById(event_id: number): Promise<Event | null> {
    const { data, error } = await this.supabase
      .from("events")
      .select()
      .eq("id", event_id)
      .single();

    if (error) throw error;
    return data;
  }

  async addRsvp(rsvpData: {
    rsvp_name: string;
    rsvp_email: string;
    event_id: number;
  }): Promise<number> {
    const mailgun = new Mailgun(FormData);

    const mg = mailgun.client({
      username: "api",
      key: process.env.MAILGUN_API_KEY || "",
    });

    try {
      const eventData = await this.getEventById(rsvpData.event_id);
      const subject = `New RSVP for "${
        eventData?.event_title ?? `EVENT_TITLE`
      }" at ${eventData?.event_date ?? `EVENT_DATE`}`;

      await mg.messages.create(process.env.MAILGUN_DOMAIN as string, {
        from: `Mailgun Sandbox <postmaster@${process.env.MAILGUN_DOMAIN}>`,
        to: JSON.parse(process.env.MAILGUN_RECEIVERS as string),
        subject,
        html: `
            <p>${subject}:</p>
            <p><strong>Name:</strong> ${rsvpData.rsvp_name}</p>
            <p><strong>Email:</strong> ${rsvpData.rsvp_email}</p>
          `,
      });
    } catch (error) {
      console.log(error);
    }

    const { data, error } = await this.supabase
      .from("rsvps")
      .insert([
        {
          event_id: rsvpData.event_id,
          rsvp_name: rsvpData.rsvp_name,
          rsvp_email: rsvpData.rsvp_email,
        },
      ])
      .select();

    if (error) throw error;

    return data[0].id;
  }

  async getAllRsvpsWithEvents() {
    const { data, error } = await this.supabase.from("rsvps").select(`
        *,
        events (
          id,
          event_title,
          event_date
        )
      `);

    if (error) throw error;

    const eventMap = new Map<
      number,
      {
        event_id: number;
        event_title: string;
        event_date: string;
        rsvps: Array<{
          rsvp_name: string;
          rsvp_email: string;
          created_at: string;
        }>;
      }
    >();

    data.forEach((row) => {
      const { events, ...rsvp } = row;

      if (!eventMap.has(events.id)) {
        eventMap.set(events.id, {
          event_id: events.id,
          event_title: events.event_title,
          event_date: events.event_date,
          rsvps: [],
        });
      }

      eventMap.get(events.id)?.rsvps.push({
        rsvp_name: rsvp.rsvp_name,
        rsvp_email: rsvp.rsvp_email,
        created_at: rsvp.created_at,
      });
    });

    return Array.from(eventMap.values());
  }
}
