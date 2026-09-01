# Poste Tracker Bot

Bot Telegram che tiene sott'occhio spedizioni Poste Italiane e avvisa ad
ogni cambiamento — inclusi i cambi di sola **località** a parità di stato
(es. "in transito a Torino" → "in transito a Milano").

## Come funziona

- Ogni utente registra i propri codici via chat (`/aggiungi`).
- Un job schedulato (default: ogni 5 minuti) interroga Poste in batch per
  tutti i codici attivi con un'unica richiesta ogni 20 codici.
- Per ogni spedizione, confronta l'ultimo evento noto (timestamp) con quelli
  appena scaricati: qualsiasi evento più recente genera una notifica.
- Le spedizioni consegnate vengono disattivate automaticamente.
- Dopo 5 controlli falliti di fila (es. codice inesistente) la spedizione
  viene disattivata e l'utente avvisato.

## Setup

```bash
npm install
cp .env.example .env
```

Modifica `.env`:

```
BOT_TOKEN=...       # da BotFather su Telegram (/newbot)
POLL_INTERVAL_MINUTES=5
DB_PATH=./data/tracking.db
```

Avvio:

```bash
npm start
```

In produzione, come per i tuoi altri progetti:

```bash
pm2 start index.js --name poste-tracker-bot
pm2 save
```

## Comandi del bot

| Comando | Descrizione |
|---|---|
| `/aggiungi CODICE [etichetta]` | Registra una spedizione. Fa un primo controllo silenzioso per fissare la baseline (non manda notifiche sullo storico pregresso). |
| `/lista` | Mostra le spedizioni attive con stato e località correnti. |
| `/dettagli [CODICE]` | Storico completo dei movimenti. Senza codice mostra una lista di bottoni per scegliere tra le spedizioni attive. |
| `/rimuovi CODICE` | Smette di seguire quella spedizione. |

## ⚠️ Nota importante sulla fonte dati

`src/posteTracker.js` chiama:

```
POST https://www.poste.it/online/dovequando/DQ-REST/ricercamultipla
```

Questo **non è un endpoint pubblico ufficiale**: è quello usato internamente
dalla pagina "Cerca Spedizioni" di poste.it. Funziona, ma Poste può
cambiarlo o bloccarlo senza preavviso. Se il bot smette di ricevere dati
(tutte le spedizioni restituiscono errore):

1. Vai su https://www.poste.it/cerca/index.html
2. Apri DevTools → Network → filtra per Fetch/XHR
3. Cerca una spedizione reale e guarda quale richiesta parte
4. Aggiorna `POSTE_URL` e la funzione `normalizeShipment()` in
   `src/posteTracker.js` in base al nuovo formato

Tutto il resto del bot (bot.js, poller.js, repository.js) lavora solo
sull'oggetto normalizzato `{ code, status, events }`, quindi un cambio
dell'endpoint si sistema in un unico file.

Se preferisci una soluzione più stabile e sei disposto ad accettare un
servizio terzo, valuta un aggregatore come AfterShip, 17TRACK o
TrackingMore, che supportano "poste-italiane" come corriere con API REST
documentate e piani gratuiti limitati: basterebbe riscrivere
`trackMultiple()` per chiamare loro invece di poste.it.

## Struttura

```
index.js              entry point, avvio bot + poller, shutdown pulito
src/db.js              connessione SQLite (singleton) e schema
src/repository.js       query riusabili
src/posteTracker.js     modulo isolato per parlare con Poste
src/bot.js              comandi Telegram
src/poller.js           job schedulato + logica di diff/notifica
```
