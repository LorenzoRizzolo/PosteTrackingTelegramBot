'use strict';

const { Telegraf, Markup } = require('telegraf');
const repo = require('./repository');
const { trackMultiple } = require('./posteTracker');

const HELP_TEXT =
  '/aggiungi CODICE [etichetta] - registra una spedizione\n' +
  '/lista - spedizioni registrate e stato attuale\n' +
  '/dettagli [CODICE] - storico completo di una spedizione; senza codice mostra la selezione\n' +
  '/rimuovi CODICE - smetti di seguirla\n' +
  '/help - questo messaggio';

function buildShipmentActionKeyboard(shipments, action) {
  return Markup.inlineKeyboard(
    shipments.map((shipment) => [
      Markup.button.callback(
        shipment.label ? `${shipment.label} (${shipment.tracking_code})` : shipment.tracking_code,
        `${action}:${shipment.tracking_code}`
      ),
    ])
  );
}

async function sendShipmentDetails(ctx, code) {
  try {
    const [result] = await trackMultiple([code.toUpperCase()]);
    if (!result || result.error) {
      return ctx.reply(`Nessuna informazione trovata per ${code.toUpperCase()}.`);
    }
    const history = result.events
      .slice()
      .reverse()
      .map(
        (e) =>
          `${new Date(e.timestamp).toLocaleString('it-IT')} — ${e.status}${e.location ? ` (${e.location})` : ''}`
      )
      .join('\n');
    return ctx.reply(`Storico ${code.toUpperCase()}:\n\n${history || 'nessun movimento disponibile'}`);
  } catch (err) {
    return ctx.reply(`Errore nel recupero dei dettagli: ${err.message}`);
  }
}

function createBot(token) {
  const bot = new Telegraf(token);

  bot.start((ctx) => {
    repo.upsertUser(ctx.chat.id, ctx.from.username);
    ctx.reply('Ciao! Sono il tuo bot di tracking Poste Italiane.\n\n' + HELP_TEXT);
  });

  bot.help((ctx) => ctx.reply(HELP_TEXT));

  bot.command('aggiungi', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    const code = (parts[0] || '').trim();
    const label = parts.slice(1).join(' ') || null;

    if (!code) {
      return ctx.reply('Uso: /aggiungi CODICE [etichetta]\nEsempio: /aggiungi RR123456789IT regalo compleanno');
    }

    repo.upsertUser(ctx.chat.id, ctx.from.username);
    repo.addShipment(ctx.chat.id, code, label);

    // Primo controllo subito, per fissare la situazione di partenza.
    // Non mandiamo notifiche qui: serve solo a evitare che al primo poll
    // arrivi una raffica di messaggi con tutto lo storico pregresso.
    try {
      const [result] = await trackMultiple([code.toUpperCase()]);
      const shipment = repo.getShipment(ctx.chat.id, code);

      if (result && !result.error) {
        const lastEvent = result.events[result.events.length - 1];
        repo.updateShipmentState(shipment.id, {
          status: result.status,
          location: lastEvent ? lastEvent.location : null,
          eventTs: lastEvent ? lastEvent.timestamp : 0,
        });
        ctx.reply(
          `Spedizione ${code.toUpperCase()} registrata.\n` +
            `Stato attuale: ${result.status || 'nessuna informazione'}` +
            `${lastEvent && lastEvent.location ? ` — ${lastEvent.location}` : ''}`
        );
      } else {
        ctx.reply(
          `Spedizione ${code.toUpperCase()} registrata, ma per ora non trovo informazioni ` +
            `(${result ? result.error : 'nessuna risposta da Poste'}). Continuerò a controllare.`
        );
      }
    } catch (err) {
      ctx.reply(
        `Spedizione ${code.toUpperCase()} registrata. Il primo controllo non è riuscito ` +
          `(${err.message}), ci riproverò al prossimo giro automatico.`
      );
    }
  });

  bot.command('lista', (ctx) => {
    const shipments = repo.listShipments(ctx.chat.id);
    if (shipments.length === 0) {
      return ctx.reply('Non hai spedizioni registrate. Usa /aggiungi CODICE per iniziare.');
    }
    const lines = shipments.map((s) => {
      const titolo = s.label ? `${s.label} (${s.tracking_code})` : s.tracking_code;
      const stato = s.last_status || 'in attesa di dati';
      const luogo = s.last_location ? ` — ${s.last_location}` : '';
      return `${titolo}\n  ${stato}${luogo}`;
    });
    const keyboard = buildShipmentActionKeyboard(shipments, 'details');
    ctx.reply(`Spedizioni attive:\n\n${lines.join('\n\n')}`, keyboard);
  });

  bot.command('rimuovi', (ctx) => {
    const code = ctx.message.text.trim().split(/\s+/)[1];
    if (!code) {
      const shipments = repo.listShipments(ctx.chat.id);
      if (shipments.length === 0) {
        return ctx.reply('Non hai spedizioni attive. Usa /aggiungi CODICE per iniziare.');
      }
      return ctx.reply(
        'Seleziona la spedizione da rimuovere:',
        buildShipmentActionKeyboard(shipments, 'remove')
      );
    }

    repo.removeShipment(ctx.chat.id, code);
    ctx.reply(`Ho smesso di seguire ${code.toUpperCase()}.`);
  });

  bot.command('dettagli', async (ctx) => {
    const code = ctx.message.text.trim().split(/\s+/)[1];
    if (!code) {
      const shipments = repo.listShipments(ctx.chat.id);
      if (shipments.length === 0) {
        return ctx.reply('Non hai spedizioni attive. Usa /aggiungi CODICE per iniziare.');
      }
      return ctx.reply(
        'Seleziona la spedizione di cui vuoi vedere i dettagli:',
        buildShipmentActionKeyboard(shipments, 'details')
      );
    }

    return sendShipmentDetails(ctx, code);
  });

  bot.action(/details:(.+)/, async (ctx) => {
    const code = ctx.match[1].trim();
    await ctx.answerCbQuery();
    return sendShipmentDetails(ctx, code);
  });

  bot.action(/remove:(.+)/, async (ctx) => {
    const code = ctx.match[1].trim();
    repo.removeShipment(ctx.chat.id, code);
    await ctx.answerCbQuery(`Ho smesso di seguire ${code.toUpperCase()}.`);
    return ctx.editMessageText(`Spedizione rimossa: ${code.toUpperCase()}`);
  });

  return bot;
}

module.exports = { createBot };
