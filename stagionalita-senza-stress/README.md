# Stagionalità Senza Stress

Sito delle stagionalità ordinate per score, con il backtest del Metodo C2 e il grafico del trade (Risk/Reward).
I dati arrivano dal foglio **Diario Trading - Strategia Stagionalità ELP** (tab *Diario Trade* e *Calendario 2026*).
Ogni modifica al foglio compare sul sito entro circa 5 minuti, oppure subito con il pulsante **Aggiorna**.

## Pubblicazione su Vercel

**Opzione A, da GitHub (consigliata, così ogni modifica si ripubblica da sola)**
1. Crea un repository su GitHub e carica il contenuto di questa cartella (non la cartella stessa, ma i file che contiene).
2. Su vercel.com: **Add New → Project → Import** il repository.
3. Framework Preset: **Other**. Lascia vuoti Build Command e Output Directory. Premi **Deploy**.

**Opzione B, da terminale**
1. Apri il terminale in questa cartella.
2. Esegui `npx vercel` e segui le domande, poi `npx vercel --prod` per pubblicare.

Non servono chiavi né variabili d'ambiente.

## Condizione importante sul foglio
Il foglio deve restare condiviso come **"Chiunque abbia il link: Visualizzatore"** (è già così).
Se lo rendi privato, il sito mostra un avviso al posto delle stagionalità.

## Struttura
- `index.html`: tutto il sito (home, calendario, dettaglio). Le pagine sono `/`, `/calendario`, `/dettaglio/<ID>`.
- `api/candles.js`: candele daily dei futures per il grafico (Yahoo Finance, stessi dati del bot Telegram), es. `/api/candles?asset=NDX&from=2026-10-01`.
- `api/data.js`: legge il foglio e lo passa al sito. Le colonne vengono riconosciute dal nome dell'intestazione, quindi puoi spostarle senza rompere nulla, ma non rinominarle.
- `vercel.json`: indirizza `/calendario` e `/dettaglio/...` verso `index.html`.

## Il grafico nella pagina di dettaglio
È disegnato con Lightweight Charts (libreria open source di TradingView) sulle candele daily dei futures:
grigio prima della finestra (tranne il giorno prima dell'inizio), verde/rosso dentro, ⚠️ sulla 1ª candela opposta,
C2 in blu con la freccia ENTRY e il box Risk/Reward (TP verde, SL rosso) da Entry, TP e SL del Diario.

**Aggiungere un asset:** in `api/candles.js` aggiungi alla tabella `YAHOO` il nome usato nella colonna *Asset* e il simbolo Yahoo
(es. `ZWUSX: "ZW=F"`); azioni e coppie forex vengono riconosciute da sole. Per il link "Apri su TradingView"
aggiungi il simbolo in `FUTURES_MAP` (o `TV_SYMBOLS`) in `index.html`.

## Opzioni (facoltative)
Variabili d'ambiente su Vercel, da usare solo se cambi foglio o tab:
`SHEET_ID`, `DIARIO_GID` (121658962), `CAL_GID` (2001), `DIARIO_RANGE` (A3:BL400), `CAL_RANGE` (A2:O400).
Se il prossimo anno crei il tab *Calendario 2027*, aggiorna `CAL_GID` con il gid del nuovo tab (il numero dopo `gid=` nell'indirizzo).
