'use strict';

const cron = require('node-cron');
const repo = require('./repository');
const { trackMultiple } = require('./posteTracker');

const MAX_ERRORS = 5; // dopo N controlli falliti di fila, smettiamo di pollare quel codice
const CHUNK_SIZE = 20; // codici per richiesta batch verso Poste
const CHUNK_DELAY_MS = 1500; // pausa tra un batch e l'altro, per non martellare il server
const DELIVERED_KEYWORDS = ['consegnat']; // copre "consegnato"/"consegnata"

function isDelivered(status) {
  if (!status) return false;
  const s = status.toLowerCase();
  return DELIVERED_KEYWORDS.some((k) => s.includes(k));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function notify(bot, chatId, text) {
  try {
    await bot.telegram.sendMessage(chatId, text);
  } catch (err) {
    console.error(`[poller] impossibile notificare chat ${chatId}:`, err.message);
  }
}

async function handleShipment(bot, shipment, result) {
  if (result.error) {
    const count = repo.bumpErrorCount(shipment.id);
    if (count >= MAX_ERRORS) {
      repo.deactivateShipment(shipment.id);
      await notify(
        bot,
        shipment.chat_id,
        `Non riesco più a trovare informazioni per ${shipment.label || shipment.tracking_code} ` +
          `(${result.error}). Ho smesso di controllarla — usa /aggiungi per riprovare.`
      );
    }
    return;
  }

  // Cuore della logica: notifichiamo solo gli eventi più recenti dell'ultimo
  // che avevamo già visto. Questo copre sia i cambi di stato (es. "in
  // consegna") sia i cambi di sola località a parità di stato (es. "in
  // transito a Torino" -> "in transito a Milano").
  const newEvents = result.events.filter((e) => e.timestamp > shipment.last_event_ts);
  if (newEvents.length === 0) return;

  const nome = shipment.label || shipment.tracking_code;
  const testo = newEvents
    .map(
      (e) =>
        `📦 ${nome}\n${e.status}${e.location ? ` — ${e.location}` : ''}\n${new Date(
          e.timestamp
        ).toLocaleString('it-IT')}`
    )
    .join('\n\n');

  await notify(bot, shipment.chat_id, testo);

  const lastEvent = newEvents[newEvents.length - 1];
  repo.updateShipmentState(shipment.id, {
    status: result.status,
    location: lastEvent.location,
    eventTs: lastEvent.timestamp,
  });

  if (isDelivered(result.status)) {
    repo.deactivateShipment(shipment.id);
    await notify(bot, shipment.chat_id, `${nome} risulta consegnata. Ho smesso di controllarla.`);
  }
}

async function pollOnce(bot) {
  const codes = repo.getAllActiveDistinctCodes();
  if (codes.length === 0) return;

  for (let i = 0; i < codes.length; i += CHUNK_SIZE) {
    const chunk = codes.slice(i, i + CHUNK_SIZE);

    let results;
    try {
      results = await trackMultiple(chunk);
    } catch (err) {
      console.error('[poller] errore nel batch verso Poste:', err.message);
      continue;
    }

    for (const result of results) {
      if (!result.code) continue;
      const shipments = repo.getActiveShipmentsForCode(result.code);
      for (const shipment of shipments) {
        await handleShipment(bot, shipment, result);
      }
    }

    if (i + CHUNK_SIZE < codes.length) {
      await sleep(CHUNK_DELAY_MS);
    }
  }
}

function startPoller(bot, intervalMinutes) {
  const cronExpr = `*/${intervalMinutes} * * * *`;
  const task = cron.schedule(cronExpr, () => {
    pollOnce(bot).catch((err) => console.error('[poller] errore inatteso:', err));
  });
  return task;
}

module.exports = { startPoller, pollOnce };
