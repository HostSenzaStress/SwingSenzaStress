// Legge dal foglio Google il "Diario Trade" e il "Calendario 2026" e li restituisce al sito.
// Il foglio deve restare condiviso come "Chiunque abbia il link: Visualizzatore".
// Per cambiare foglio o tab, imposta le variabili d'ambiente su Vercel (vedi README).

const SHEET_ID = process.env.SHEET_ID || "1ZkUysiJOcvuRUwkqa5lu0CTaN2IRMVtjOA2b9gvoey4";
const DIARIO_GID = process.env.DIARIO_GID || "121658962";   // tab "Diario Trade"
const CAL_GID = process.env.CAL_GID || "2001";              // tab "Calendario 2026"
const DIARIO_RANGE = process.env.DIARIO_RANGE || "A3:BJ400"; // riga 3 = intestazioni (BJ = PUBBLICA SUL SITO)
const CAL_RANGE = process.env.CAL_RANGE || "A2:O400";        // riga 2 = intestazioni

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // toglie le righe vuote (anche quelle con solo numerazione, FALSE o segnaposto)
  return rows.filter(r => r.filter(v => v !== "" && v !== "FALSE").length >= 3);
}

async function readRange(gid, range) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}&range=${encodeURIComponent(range)}`;
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "stagionalita-senza-stress" } });
  const text = await r.text();
  if (!r.ok || /^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(`Foglio non leggibile (HTTP ${r.status}). Controlla che sia condiviso con "Chiunque abbia il link".`);
  }
  return parseCSV(text);
}

module.exports = async (req, res) => {
  try {
    let [diario, cal] = await Promise.all([readRange(DIARIO_GID, DIARIO_RANGE), readRange(CAL_GID, CAL_RANGE)]);
    // Mostra sul sito solo le righe con "PUBBLICA SUL SITO" = SÌ (short e forex restano nel diario come studio)
    const pub = (diario[0] || []).findIndex(h => String(h).trim().toUpperCase() === "PUBBLICA SUL SITO");
    if (pub >= 0) diario = [diario[0], ...diario.slice(1).filter(r => !/^NO/i.test(String(r[pub] || "").trim()))];
    const fresh = req.query && req.query.fresh;
    res.setHeader("Cache-Control", fresh ? "no-store" : "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ ok: true, updatedAt: Date.now(), diario, cal });
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ ok: false, error: String(err && err.message || err) });
  }
};

module.exports.parseCSV = parseCSV;
