import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";

// Ensure database directory exists
const dbDir = path.join(__dirname, "../data");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

const db = new sqlite3.Database(path.join(dbDir, "events.db"));

// Initialize database tables
const initSQL = fs.readFileSync(
  path.join(__dirname, "database/init.sql"),
  "utf-8"
);

db.exec(initSQL, (err) => {
  if (err) {
    console.error("Error initializing database:", err);
  } else {
    console.log("Database initialized successfully");
  }
});

export default db;
