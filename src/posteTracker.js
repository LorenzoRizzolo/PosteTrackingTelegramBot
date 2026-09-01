'use strict';

/**
 * Modulo isolato per interrogare il servizio di tracking di Poste Italiane.
 *
 * ATTENZIONE: questo endpoint NON è un'API pubblica ufficiale. È lo stesso
 * endpoint usato dalla pagina "Cerca Spedizioni" di poste.it e può cambiare
 * senza preavviso. Se il bot smette di ricevere dati:
 *
 *   1. Vai su https://www.poste.it/cerca/index.html
 *   2. Apri DevTools -> Network -> XHR/Fetch
 *   3. Cerca una spedizione e guarda quale URL/JSON viene chiamato
 *   4. Aggiorna POSTE_URL e/o normalizeShipment() qui sotto
 *
 * Tutto il resto del bot lavora solo con l'output normalizzato di
 * trackMultiple(), quindi un cambio qui non richiede modifiche altrove.
 */

const POSTE_URL = 'https://www.poste.it/online/dovequando/DQ-REST/ricercamultipla';

const HEADERS = {
  'Content-Type': 'application/json;charset=UTF-8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://www.poste.it/cerca/index.html',
  Origin: 'https://www.poste.it',
};

function normalizeTrackingCode(code) {
  if (code == null) return null;

  const cleaned = String(code)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\s]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();

  return cleaned || null;
}

/**
 * Interroga Poste per una lista di codici (max consigliato ~20 per chiamata)
 * e ritorna un array normalizzato:
 *   { code, error, status, events: [{ timestamp(ms), status, location }] }
 * events è ordinato dal più vecchio al più recente.
 */
async function trackMultiple(codes) {
  if (!codes || codes.length === 0) return [];

  const normalizedCodes = codes.map(normalizeTrackingCode).filter(Boolean);
  if (normalizedCodes.length === 0) return [];

  const res = await fetch(POSTE_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      tipoRichiedente: 'WEB',
      listaCodici: normalizedCodes,
    }),
  });
  console.log(`Poste ha risposto con status HTTP ${res.status} per ${normalizedCodes.length} codici: ${normalizedCodes.join(', ')}`);

  if (!res.ok) {
    const message = `Poste ha risposto con status HTTP ${res.status}`;
    if (res.status === 400) {
      return normalizedCodes.map((code) => ({
        code,
        error: 'codice non valido o non trovato',
        status: null,
        events: [],
      }));
    }
    throw new Error(message);
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    throw new Error('Risposta di Poste in un formato inatteso (non è un array)');
  }

  return data.map(normalizeShipment);
}

function normalizeShipment(raw) {
  const code = normalizeTrackingCode(raw.idTracciatura || raw.codice || null);

  if (raw.descrizioneErrore) {
    return { code, error: raw.descrizioneErrore, status: null, events: [] };
  }

  const movimenti = raw.listaMovimenti || [];

  const events = movimenti
    .map((m) => ({
      timestamp: Number(m.dataOra), // epoch in millisecondi
      status: m.statoLavorazione,
      location: m.luogo || null,
    }))
    .filter((e) => Number.isFinite(e.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  const status = raw.sintesiStato || (events.length ? events[events.length - 1].status : null);

  return { code, error: null, status, events };
}

module.exports = { normalizeTrackingCode, trackMultiple, normalizeShipment };
