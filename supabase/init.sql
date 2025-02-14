CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    event_title TEXT NOT NULL,
    event_description TEXT,
    event_date TEXT NOT NULL,
    event_start_time TEXT NOT NULL,
    event_end_time TEXT NOT NULL,
    event_price DECIMAL(10,2) DEFAULT 0.00,
    event_location TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rsvps (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL,
  rsvp_name TEXT NOT NULL,
  rsvp_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id)
);