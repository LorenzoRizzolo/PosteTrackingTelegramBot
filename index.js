'use strict';

require('dotenv').config();

const { createBot } = require('./src/bot');
const { startPoller } = require('./src/poller');
const { closeDb } = require('./src/db');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Manca BOT_TOKEN nel file .env (vedi .env.example)');
  process.exit(1);
}

const intervalMinutes = Number(process.env.POLL_INTERVAL_MINUTES || 20);

const bot = createBot(token);

bot
  .launch()
  .then(() => console.log('Bot Telegram avviato'))
  .catch((err) => {
    console.error('Errore avvio bot:', err.message);
    process.exit(1);
  });

const task = startPoller(bot, intervalMinutes);
console.log(`Poller attivo ogni ${intervalMinutes} minuti`);

// Stesso pattern di shutdown ordinato già usato per DocStorePro:
// fermiamo cron e bot, poi chiudiamo la connessione SQLite per evitare
// crash da lock/handle lasciati aperti.
function shutdown(signal) {
  console.log(`Ricevuto ${signal}, chiudo...`);
  task.stop();
  bot.stop(signal);
  closeDb();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
