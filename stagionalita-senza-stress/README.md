# Stagionalità Senza Stress

Sito delle stagionalità ordinate per score, con il backtest del Metodo C2 e il grafico TradingView.
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
- `api/data.js`: legge il foglio e lo passa al sito. Le colonne vengono riconosciute dal nome dell'intestazione, quindi puoi spostarle senza rompere nulla, ma non rinominarle.
- `vercel.json`: indirizza `/calendario` e `/dettaglio/...` verso `index.html`.

## Aggiungere un asset al grafico TradingView
In `index.html` cerca `TV_SYMBOLS` e aggiungi una riga con il nome usato nella colonna *Asset* e il simbolo TradingView,
per esempio `"ZWUSX":"CBOT:ZW1!"`. Le coppie forex (es. `EUR/JPY`) vengono riconosciute da sole.

## Opzioni (facoltative)
Variabili d'ambiente su Vercel, da usare solo se cambi foglio o tab:
`SHEET_ID`, `DIARIO_GID` (121658962), `CAL_GID` (2001), `DIARIO_RANGE` (A3:BI400), `CAL_RANGE` (A2:O400).
Se il prossimo anno crei il tab *Calendario 2027*, aggiorna `CAL_GID` con il gid del nuovo tab (il numero dopo `gid=` nell'indirizzo).
