'use strict';

const { getDb } = require('./db');

function upsertUser(chatId, username) {
  const db = getDb();
  db.prepare(
    `INSERT INTO users (chat_id, username) VALUES (?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET username = excluded.username`
  ).run(chatId, username || null);
}

function addShipment(chatId, code, label) {
  const db = getDb();
  return db
    .prepare(
      `INSERT INTO shipments (chat_id, tracking_code, label)
       VALUES (?, ?, ?)
       ON CONFLICT(chat_id, tracking_code) DO UPDATE SET active = 1, error_count = 0, label = excluded.label`
    )
    .run(chatId, code.toUpperCase(), label || null);
}

function listShipments(chatId) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM shipments WHERE chat_id = ? AND active = 1 ORDER BY created_at DESC`)
    .all(chatId);
}

function removeShipment(chatId, code) {
  const db = getDb();
  return db
    .prepare(`UPDATE shipments SET active = 0 WHERE chat_id = ? AND tracking_code = ?`)
    .run(chatId, code.toUpperCase());
}

function getShipment(chatId, code) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM shipments WHERE chat_id = ? AND tracking_code = ?`)
    .get(chatId, code.toUpperCase());
}

function getAllActiveDistinctCodes() {
  const db = getDb();
  return db
    .prepare(`SELECT DISTINCT tracking_code FROM shipments WHERE active = 1`)
    .all()
    .map((r) => r.tracking_code);
}

function getActiveShipmentsForCode(code) {
  const db = getDb();
  return db.prepare(`SELECT * FROM shipments WHERE tracking_code = ? AND active = 1`).all(code);
}

function updateShipmentState(id, { status, location, eventTs }) {
  const db = getDb();
  db.prepare(
    `UPDATE shipments
     SET last_status = ?, last_location = ?, last_event_ts = ?, last_checked_at = datetime('now'), error_count = 0
     WHERE id = ?`
  ).run(status, location, eventTs, id);
}

function deactivateShipment(id) {
  const db = getDb();
  db.prepare(`UPDATE shipments SET active = 0 WHERE id = ?`).run(id);
}

function bumpErrorCount(id) {
  const db = getDb();
  db.prepare(`UPDATE shipments SET error_count = error_count + 1 WHERE id = ?`).run(id);
  return db.prepare(`SELECT error_count FROM shipments WHERE id = ?`).get(id).error_count;
}

module.exports = {
  upsertUser,
  addShipment,
  listShipments,
  removeShipment,
  getShipment,
  getAllActiveDistinctCodes,
  getActiveShipmentsForCode,
  updateShipmentState,
  deactivateShipment,
  bumpErrorCount,
};
