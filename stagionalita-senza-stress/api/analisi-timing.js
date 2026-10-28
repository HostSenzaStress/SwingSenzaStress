// Analisi del timing d'ingresso del Metodo C2 su tutte le finestre del Diario.
// Rifà il backtest anno per anno sulle candele daily di Yahoo (stessi simboli del bot) e mostra
// win rate, expectancy ed esiti per fasce di "% di finestra trascorsa all'ingresso".
// Pagina interna, non collegata dal menu: /api/analisi-timing (scarica gli asset uno alla volta: ?asset=NDX)

const { candele, simbolo } = require("./candles.js");
const { parseCSV } = require("./data.js");

const SHEET_ID = process.env.SHEET_ID || "1ZkUysiJOcvuRUwkqa5lu0CTaN2IRMVtjOA2b9gvoey4";
const DIARIO_GID = process.env.DIARIO_GID || "121658962";
const ANNO_DA = 2006;

async function leggiDiario() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${DIARIO_GID}&range=${encodeURIComponent("A3:BL400")}`;
  const r = await fetch(url, { redirect: "follow" });
  const rows = parseCSV(await r.text());
  const h = rows[0].map(x => String(x).trim());
  const c = n => h.indexOf(n);
  const anni = h.map((x, i) => { const m = x.match(/^(\d{4})\s*\(R\)$/); return m ? { y: +m[1], i } : null; }).filter(Boolean);
  const num = v => { let s = String(v || "").replace(/[%R\s+]/g, ""); if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); const n = parseFloat(s); return isFinite(n) ? n : null; };
  return rows.slice(1).map(r => {
    const m = String(r[c("Periodo stagionale")] || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m || !r[c("ID")]) return null;
    const tv = {}; anni.forEach(a => { const v = num(r[a.i]); if (v != null) tv[a.y] = v; });
    return { id: String(r[c("ID")]).trim(), asset: String(r[c("Asset")]).trim(), long: !/SHORT/i.test(r[c("Direzione")]),
      avg: num(r[c("AVG Medio")]), mdI: m[2] + "-" + m[1], mdF: m[5] + "-" + m[4], tv };
  }).filter(f => f && f.avg > 0);
}

async function storico(asset) {
  const sym = simbolo(asset);
  const p1 = Math.floor(Date.UTC(ANNO_DA - 1, 11, 1) / 1000), p2 = Math.floor(Date.now() / 1000);
  for (const host of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    const r = await fetch(`${host}/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0 (stagionalita-senza-stress)" } });
    if (r.ok) return candele(await r.json(), sym).filter(c => !c.live);
  }
  return [];
}

const ms = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const piuGiorni = (iso, n) => new Date(ms(iso) + n * 864e5).toISOString().slice(0, 10);

// Metodo C2 (replica di analizzaC2_ del bot). filtro80: scarta le C2 con movimento già fatto ≥ 80% dell'AVG e continua a cercare.
function c2(cs, ini, fin, long, avg, filtro80) {
  const dentro = b => b.time >= ini && b.time <= fin;
  const opp = b => long ? b.close < b.open : b.close > b.open;
  const primo = cs.findIndex(dentro);
  if (primo < 0) return null;
  const apertura = cs[primo].open;
  let iE = -1, mov = 0;
  for (let i = primo; i < cs.length && dentro(cs[i]); i++) {
    const cur = cs[i], prev = cs[i - 1];
    if (prev && (dentro(prev) || i === primo) && opp(prev) && opp(cur) && (long ? cur.low < prev.low : cur.high > prev.high)) {
      mov = long ? (cur.close / apertura - 1) * 100 : (1 - cur.close / apertura) * 100;
      if (filtro80 && mov >= 0.8 * avg) continue;
      iE = i; break;
    }
  }
  if (iE < 0) return null;
  const e = cs[iE].close, risk = avg / 2;
  const stop = long ? e * (1 - risk / 100) : e * (1 + risk / 100), tgt = long ? e * (1 + avg / 100) : e * (1 - avg / 100);
  let ult = iE;
  for (let j = iE + 1; j < cs.length && dentro(cs[j]); j++) {
    ult = j;
    const b = cs[j], sl = long ? b.low <= stop : b.high >= stop, tp = long ? b.high >= tgt : b.low <= tgt;
    if (sl || tp) return { d: cs[iE].time, mov: mov / avg * 100, R: sl ? -1 : 2, uscita: sl ? "SL" : "TP" };
  }
  const p = cs[ult].close, pct = long ? (p / e - 1) * 100 : (1 - p / e) * 100;
  return { d: cs[iE].time, mov: mov / avg * 100, R: Math.round(pct / risk * 100) / 100, uscita: "Fine" };
}

function statistiche(trades) {
  const n = trades.length;
  if (!n) return { n: 0 };
  const tot = trades.reduce((s, t) => s + t.R, 0);
  const vinti = trades.filter(t => t.R > 0).length;
  const persi = trades.filter(t => t.R < 0).reduce((s, t) => s - t.R, 0);
  const guad = trades.filter(t => t.R > 0).reduce((s, t) => s + t.R, 0);
  return { n, wr: vinti / n * 100, exp: tot / n, tot, pf: persi ? guad / persi : null,
    tp: trades.filter(t => t.uscita === "TP").length / n * 100, sl: trades.filter(t => t.uscita === "SL").length / n * 100,
    fine: trades.filter(t => t.uscita === "Fine").length / n * 100 };
}

const chiave = a => String(a || "").toUpperCase().replace(/^\^/, "");

// Trade di un solo asset (tutte le sue finestre, anno per anno): una richiesta breve, senza timeout
async function calcolaAsset(asset, pre) {
  const finestre = pre ? pre.finestre : (await leggiDiario()).filter(f => chiave(f.asset) === chiave(asset));
  const cs = pre ? pre.cs : (finestre.length ? await storico(asset) : []);
  const oggi = new Date().toISOString().slice(0, 10);
  const base = [], filtrati = [], confronto = { pari: 0, totale: 0 };
  if (cs.length) finestre.forEach(f => {
    const scavalca = f.mdF < f.mdI;
    for (let y = ANNO_DA; y <= +oggi.slice(0, 4); y++) {
      const ini = `${y}-${f.mdI}`, fin = `${scavalca ? y + 1 : y}-${f.mdF}`;
      if (fin >= oggi || piuGiorni(ini, -10) < cs[0].time) continue;
      const giorni = (ms(fin) - ms(ini)) / 864e5;
      const t = c2(cs, ini, fin, f.long, f.avg, false);
      if (t) {
        base.push({ id: f.id, asset: f.asset, anno: y, timing: (ms(t.d) - ms(ini)) / 864e5 / giorni * 100, mov: t.mov, R: t.R, uscita: t.uscita });
        // confronto con il backtest TradingView del Diario (stesso anno di inizio)
        if (f.tv[y] != null) { confronto.totale++; if (Math.abs(f.tv[y] - t.R) <= 0.15) confronto.pari++; }
      }
      const tf = c2(cs, ini, fin, f.long, f.avg, true);
      if (tf) filtrati.push({ timing: (ms(tf.d) - ms(ini)) / 864e5 / giorni * 100, R: tf.R, uscita: tf.uscita });
    }
  });
  return { asset, finestre: finestre.length, conDati: cs.length > 0, base, filtrati, confronto };
}

// Mette insieme i risultati di tutti gli asset (gira anche nel browser: niente dipendenze esterne)
function riassunto(parti) {
  const base = [], filtrati = [], confronto = { pari: 0, totale: 0 };
  let finestre = 0;
  parti.forEach(p => { finestre += p.finestre; base.push(...p.base); filtrati.push(...p.filtrati);
    confronto.pari += p.confronto.pari; confronto.totale += p.confronto.totale; });
  const fasce = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 101]];
  const perFascia = arr => fasce.map(([a, b]) => Object.assign({ da: a, a: Math.min(b, 100) }, statistiche(arr.filter(t => t.timing >= a && t.timing < b))));
  const soglie = [30, 40, 50, 60, 70, 80, 90, 100].map(x => ({
    soglia: x, dentro: statistiche(base.filter(t => t.timing <= x)), fuori: statistiche(base.filter(t => t.timing > x)),
    filtro80dentro: statistiche(filtrati.filter(t => t.timing <= x)) }));
  const anniTrade = base.map(t => t.anno);
  return { finestre, asset: parti.length, senzaDati: parti.filter(p => !p.conDati).map(p => p.asset),
    anni: anniTrade.length ? [Math.min(...anniTrade), Math.max(...anniTrade)] : null,
    totale: statistiche(base), totaleFiltro80: statistiche(filtrati),
    fasce: perFascia(base), fasceFiltro80: perFascia(filtrati), soglie, confronto };
}

// Pagina che scarica gli asset uno alla volta, mostra l'avanzamento e calcola le statistiche nel browser
function paginaCaricamento(assets) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Analisi timing C2</title><style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:24px 16px;background:#f6f7f3;color:#1b2433}
.bar{height:10px;background:#dce1e8;border-radius:6px;overflow:hidden;margin:14px 0}.bar i{display:block;height:100%;width:0;background:#2563b8}p{font-size:15px;color:#4a5568}</style></head>
<body><h1 style="font-size:22px">Analisi timing d'ingresso · Metodo C2</h1>
<p id="st">Ricalcolo del backtest in corso: 0 / ${assets.length} asset…</p><div class="bar"><i id="pb"></i></div>
<p>Ci vuole circa un minuto. Lascia la pagina aperta.</p>
<script>
const statistiche = ${statistiche.toString()};
const riassunto = ${riassunto.toString()};
const f1 = ${f1.toString()};
const f2 = ${f2.toString()};
const sezioneTiming = ${sezioneTiming.toString()};
const pagina = ${pagina.toString()};
const ASSET = ${JSON.stringify(assets)};
(async () => {
  const parti = []; let fatti = 0, i = 0;
  async function lavora() {
    while (i < ASSET.length) {
      const a = ASSET[i++];
      let p = null;
      for (let t = 0; t < 3 && !p; t++) {
        try { const r = await fetch("/api/analisi-timing?asset=" + encodeURIComponent(a)); if (r.ok) p = await r.json(); } catch (e) {}
      }
      parti.push(p || { asset: a, finestre: 0, conDati: false, base: [], filtrati: [], confronto: { pari: 0, totale: 0 } });
      fatti++;
      document.getElementById("st").textContent = "Ricalcolo del backtest in corso: " + fatti + " / " + ASSET.length + " asset…";
      document.getElementById("pb").style.width = (fatti / ASSET.length * 100) + "%";
    }
  }
  await Promise.all([lavora(), lavora(), lavora(), lavora()]);
  const html = pagina(riassunto(parti));
  document.open(); document.write(html); document.close();
})();
</script></body></html>`;
}

const f1 = n => n == null ? "—" : n.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = n => n == null ? "—" : (n > 0 ? "+" : "") + n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function sezioneTiming(d, n) {
  const riga = (et, s) => s.n ? `<tr><td>${et}</td><td>${s.n}</td><td>${f1(s.wr)}%</td><td class="${s.exp >= 0 ? "pos" : "neg"}"><b>${f2(s.exp)}R</b></td><td>${f1(s.tp)}%</td><td>${f1(s.fine)}%</td></tr>` : `<tr><td>${et}</td><td>0</td><td colspan="4">—</td></tr>`;
  const testa = `<tr><th>Timing</th><th>Trade</th><th>WR</th><th>Exp.</th><th>TP</th><th>Fine</th></tr>`;
  const tab = arr => `<table>${testa}${arr.map(s => riga(`${s.da}–${s.a}%`, s)).join("")}</table>`;
  return `<p>WR = win rate · Exp. = expectancy (R medio per trade) · TP = % chiusi a take profit · Fine = % chiusi a fine finestra.</p>
<p>${d.finestre} finestre del Diario, ${d.asset} asset, anni ${d.anni ? d.anni.join("–") : "—"}. Backtest ricalcolato sulle candele daily Yahoo (stessi simboli del bot). Timing = % della finestra già trascorsa alla chiusura della C2.</p>
<div class="kpi" style="margin-top:12px">
<div>Trade totali<b>${d.totale.n}</b></div><div>Expectancy totale<b class="${d.totale.exp >= 0 ? "pos" : "neg"}">${f2(d.totale.exp)}R</b></div>
<div>Win rate<b>${f1(d.totale.wr)}%</b></div><div>Coincidenza con TradingView<b>${d.confronto.totale ? f1(d.confronto.pari / d.confronto.totale * 100) + "%" : "—"}</b></div>
</div>
<h3>${n}.1 · Risultati per fascia di timing (senza filtro 80%)</h3><div class="box">${tab(d.fasce)}</div>
<h3>${n}.2 · Con il filtro dell'80% del movimento</h3><div class="box">${tab(d.fasceFiltro80)}</div>
<h3>${n}.3 · Se non si entra più oltre una certa %</h3>
<div class="box"><table><tr><th>Fino al</th><th>Trade</th><th>Exp. tenuti</th><th>Esclusi</th><th>+ filtro 80%</th></tr>
${d.soglie.map(s => `<tr><td>${s.soglia}%</td><td>${s.dentro.n}</td><td class="${s.dentro.exp >= 0 ? "pos" : "neg"}"><b>${f2(s.dentro.exp)}R</b></td><td class="${(s.fuori.exp || 0) >= 0 ? "pos" : "neg"}">${s.fuori.n ? f2(s.fuori.exp) + "R·" + s.fuori.n : "—"}</td><td>${s.filtro80dentro.n ? f2(s.filtro80dentro.exp) + "R" : "—"}</td></tr>`).join("")}</table></div>
<p>“Exp. tenuti” = expectancy dei trade entrati fino a quella % di finestra; “Esclusi” = expectancy e numero dei trade entrati dopo.</p>
<p>Coincidenza con TradingView: trade dello stesso anno con esito entro ±0,15R su ${d.confronto.totale} confrontabili.</p>`;
}
function pagina(d) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Analisi timing C2</title><style>
body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:16px;background:#f6f7f3;color:#1b2433}
h1{font-size:22px;margin:0 0 4px}h3{font-size:15px;margin:20px 0 8px}h2{font-size:17px;margin:24px 0 8px}p{font-size:14px;line-height:1.5;color:#4a5568;margin:4px 0}
.box{background:#fff;border:1px solid #dce1e8;border-radius:12px;padding:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}th,td{padding:6px 5px;border-bottom:1px solid #eef0f3;text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}th{color:#4a5568;font-weight:600}.pos{color:#15803d}.neg{color:#b91c1c}
.kpi{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.kpi div{background:#fff;border:1px solid #dce1e8;border-radius:12px;padding:10px}.kpi b{display:block;font-size:20px}
</style></head><body>
<h1>Analisi timing d'ingresso · Metodo C2</h1>
${sezioneTiming(d, 1)}
</body></html>`;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    if (q.asset) {
      const d = await calcolaAsset(q.asset);
      res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
      return res.status(200).json(d);
    }
    // L'analisi del timing ora è nella pagina unica delle statistiche
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, "/api/analisi-statistiche");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(paginaCaricamento(assets));
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).send("Errore nell'analisi: " + String((err && err.message) || err));
  }
};

module.exports.c2 = c2;
module.exports.statistiche = statistiche;
module.exports.pagina = pagina;
module.exports.riassunto = riassunto;
module.exports.calcolaAsset = calcolaAsset;
module.exports.leggiDiario = leggiDiario;
module.exports.storico = storico;
module.exports.chiave = chiave;
module.exports.sezioneTiming = sezioneTiming;
