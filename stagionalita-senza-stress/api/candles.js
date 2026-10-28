// Candele daily di un asset del Diario, dagli stessi dati usati dal bot Telegram e dal Diario
// (Yahoo Finance: futures continui per materie prime e indici USA, come i backtest TradingView).
// Uso: /api/candles?asset=NDX&from=2026-10-01

const YAHOO = {
  XAUUSD: "GC=F", GOLD: "GC=F", XAGUSD: "SI=F", SILVER: "SI=F",
  PLATINUM: "PL=F", PLUSD: "PL=F", PALLADIUM: "PA=F", PAUSD: "PA=F",
  HGUSD: "HG=F", ALIUSD: "ALI=F",
  CLUSD: "CL=F", BZUSD: "BZ=F", NGUSD: "NG=F", RBUSD: "RB=F", HOUSD: "HO=F",
  ZCUSX: "ZC=F", ZSUSX: "ZS=F", KEUSX: "KE=F", ZWUSX: "ZW=F",
  SBUSX: "SB=F", KCUSX: "KC=F", CCUSD: "CC=F", CCUSX: "CC=F", CTUSX: "CT=F", OJUSX: "OJ=F",
  GSPC: "ES=F", NDX: "NQ=F", RUT: "RTY=F", DJI: "YM=F", N225: "NKD=F",
  GDAXI: "^GDAXI", STOXX50E: "^STOXX50E", SSMI: "^SSMI", FTSE: "^FTSE", FCHI: "^FCHI", HSI: "^HSI",
  BTCUSD: "BTC-USD", ETHUSD: "ETH-USD"
};

function simbolo(asset) {
  const a = String(asset || "").trim().toUpperCase().replace(/^\^/, "");
  if (YAHOO[a]) return YAHOO[a];
  const fx = a.replace("/", "");
  if (/^(EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY){2}$/.test(fx)) return fx + "=X";
  return a;
}

function giorno(date, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function ora(date, tz) {
  return +new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(date);
}
function piuUnGiorno(iso) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Trasforma la risposta Yahoo in candele { time, open, high, low, close }.
// Futures: la sessione del giorno X inizia alle 18:00 di New York del giorno prima, quindi una candela
// con orario dalle 18:00 in poi appartiene al giorno DOPO (stessa correzione del bot Telegram).
function candele(dati, sym) {
  const res = dati && dati.chart && dati.chart.result && dati.chart.result[0];
  if (!res) return [];
  const tz = (res.meta && res.meta.exchangeTimezoneName) || "America/New_York";
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const out = [];
  (res.timestamp || []).forEach((ts, i) => {
    const o = q.open && q.open[i], h = q.high && q.high[i], l = q.low && q.low[i], c = q.close && q.close[i];
    if (o == null || h == null || l == null || c == null) return;
    const dt = new Date(ts * 1000);
    let d = giorno(dt, tz);
    if (/=F$/.test(sym) && ora(dt, tz) >= 18) d = piuUnGiorno(d);
    if (out.length && out[out.length - 1].time === d) out.pop();
    out.push({ time: d, open: o, high: h, low: l, close: c });
  });
  // Candela ancora in corso (non usata per i trigger): segnata con live = true
  const ultima = out[out.length - 1];
  if (ultima) {
    const adesso = new Date(), oggi = giorno(adesso, tz), h = ora(adesso, tz);
    // Futures: dalle 18:00 di New York la nuova sessione compare ancora con la data di oggi
    if (/=F$/.test(sym)) ultima.live = ultima.time > oggi || (ultima.time === oggi && (h < 17 || h >= 18));
    else if (tz === "America/New_York") ultima.live = ultima.time === oggi && h < 16;
    else ultima.live = ultima.time >= oggi;
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    const asset = req.query && req.query.asset;
    if (!asset) throw new Error("Parametro asset mancante");
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? req.query.from : null;
    const p1 = Math.floor((from ? Date.parse(from + "T00:00:00Z") : Date.now() - 120 * 864e5) / 1000) - 86400;
    const p2 = Math.floor(Date.now() / 1000) + 86400;
    const sym = simbolo(asset);
    const path = "/v8/finance/chart/" + encodeURIComponent(sym) + "?period1=" + p1 + "&period2=" + p2 + "&interval=1d";
    let dati = null, errore = "";
    for (const host of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
      const r = await fetch(host + path, { headers: { "User-Agent": "Mozilla/5.0 (stagionalita-senza-stress)" } });
      if (r.ok) { dati = await r.json(); break; }
      errore = "HTTP " + r.status;
    }
    if (!dati) throw new Error("Dati non disponibili per " + sym + " (" + errore + ")");
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    res.status(200).json({ ok: true, asset, symbol: sym, candles: candele(dati, sym) });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ ok: false, error: String((err && err.message) || err) });
  }
};

module.exports.candele = candele;
module.exports.simbolo = simbolo;
