'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let instance = null;

function getDb() {
  if (!instance) {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tracking.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    instance = new Database(dbPath);
    instance.pragma('journal_mode = WAL');
    initSchema(instance);
  }
  return instance;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id INTEGER PRIMARY KEY,
      username TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      tracking_code TEXT NOT NULL,
      label TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_status TEXT,
      last_location TEXT,
      last_event_ts INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      error_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chat_id, tracking_code)
    );
  `);
}

function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

module.exports = { getDb, closeDb };
