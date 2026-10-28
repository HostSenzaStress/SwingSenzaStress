// Test "fuori campione" delle statistiche stagionali.
// Per ogni finestra del Diario e ogni anno Y, le statistiche (WR, AVG, AVG opposto, DD medio, DD max, AVG/DD)
// sono calcolate SOLO sugli anni precedenti a Y; poi si guarda l'esito del trade C2 dell'anno Y
// (regole attuali: filtro movimento 80% e timing 80%). Così si vede quali statistiche PREVEDONO i risultati.
// Pagina interna: /api/analisi-statistiche (scarica gli asset uno alla volta: ?asset=NDX)

const { leggiDiario, storico, chiave } = require("./analisi-timing.js");
const ANNO_DA = 2006;
const ms = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const piuGiorni = (iso, n) => new Date(ms(iso) + n * 864e5).toISOString().slice(0, 10);

// Trade C2 con le regole attuali (filtro movimento 80% e timing 80%)
function tradeC2(cs, ini, fin, long, avg) {
  const dentro = b => b.time >= ini && b.time <= fin;
  const opp = b => long ? b.close < b.open : b.close > b.open;
  const primo = cs.findIndex(dentro);
  if (primo < 0) return null;
  const apertura = cs[primo].open, durata = ms(fin) - ms(ini);
  let iE = -1;
  for (let i = primo; i < cs.length && dentro(cs[i]); i++) {
    const cur = cs[i], prev = cs[i - 1];
    if (!(prev && (dentro(prev) || i === primo) && opp(prev) && opp(cur) && (long ? cur.low < prev.low : cur.high > prev.high))) continue;
    if (durata > 0 && (ms(cur.time) - ms(ini)) / durata > 0.8) break;
    const mov = long ? (cur.close / apertura - 1) * 100 : (1 - cur.close / apertura) * 100;
    if (mov >= 0.8 * avg) continue;
    iE = i; break;
  }
  if (iE < 0) return null;
  const e = cs[iE].close, risk = avg / 2;
  const stop = long ? e * (1 - risk / 100) : e * (1 + risk / 100), tgt = long ? e * (1 + avg / 100) : e * (1 - avg / 100);
  let ult = iE;
  for (let j = iE + 1; j < cs.length && dentro(cs[j]); j++) {
    ult = j;
    const b = cs[j], sl = long ? b.low <= stop : b.high >= stop, tp = long ? b.high >= tgt : b.low <= tgt;
    if (sl || tp) return sl ? -1 : 2;
  }
  const p = cs[ult].close, pct = long ? (p / e - 1) * 100 : (1 - p / e) * 100;
  return Math.round(pct / risk * 100) / 100;
}

// Rendimento stagionale della finestra (a favore della direzione) e drawdown massimo dentro la finestra, in %
function stagione(cs, ini, fin, long) {
  const iPrima = cs.findIndex(b => b.time >= ini) - 1;
  if (iPrima < 0) return null;
  const rif = cs[iPrima].close;
  const dentro = cs.filter(b => b.time >= ini && b.time <= fin);
  if (!dentro.length) return null;
  const fine = dentro[dentro.length - 1].close;
  const ret = long ? (fine / rif - 1) * 100 : (1 - fine / rif) * 100;
  const peggio = long ? Math.min(...dentro.map(b => b.low)) : Math.max(...dentro.map(b => b.high));
  const dd = Math.max(0, long ? (1 - peggio / rif) * 100 : (peggio / rif - 1) * 100);
  return { ret, dd };
}

async function calcolaAsset(asset) {
  const finestre = (await leggiDiario()).filter(f => chiave(f.asset) === chiave(asset));
  const cs = finestre.length ? await storico(asset) : [];
  const oggi = new Date().toISOString().slice(0, 10);
  const out = [];
  if (cs.length) finestre.forEach(f => {
    const scavalca = f.mdF < f.mdI, anni = [];
    for (let y = ANNO_DA; y <= +oggi.slice(0, 4); y++) {
      const ini = `${y}-${f.mdI}`, fin = `${scavalca ? y + 1 : y}-${f.mdF}`;
      if (fin >= oggi || piuGiorni(ini, -10) < cs[0].time) continue;
      const s = stagione(cs, ini, fin, f.long);
      if (!s) continue;
      anni.push({ y, ret: Math.round(s.ret * 100) / 100, dd: Math.round(s.dd * 100) / 100, R: tradeC2(cs, ini, fin, f.long, f.avg) });
    }
    out.push({ id: f.id, asset: f.asset, long: f.long, avg: f.avg, anni });
  });
  return { asset, conDati: cs.length > 0, finestre: out };
}

// ---- Statistiche fuori campione (gira anche nel browser) ----
function osservazioni(finestre) {
  const obs = [];
  finestre.forEach(f => {
    f.anni.forEach((a, k) => {
      if (a.R == null) return;
      const prima = f.anni.slice(0, k);              // solo anni PRECEDENTI
      if (prima.length < 10) return;
      const u10 = prima.slice(-10), tutti = prima.slice(-20);
      const media = arr => arr.reduce((s, x) => s + x, 0) / arr.length;
      const wr = arr => arr.filter(x => x.ret > 0).length / arr.length * 100;
      const avg10 = media(u10.map(x => x.ret));
      const perdenti = u10.filter(x => x.ret <= 0).map(x => -x.ret);
      const ddMed = media(u10.map(x => x.dd)), ddMax = Math.max(...u10.map(x => x.dd));
      const posit = u10.filter(x => x.ret > 0).map(x => x.ret);
      obs.push({ R: a.R,
        "WR 10Y": wr(u10), "WR 20Y": wr(tutti), "WR medio (10Y+20Y)": (wr(u10) + wr(tutti)) / 2,
        "AVG 10Y %": avg10, "AVG opposto %": perdenti.length ? media(perdenti) : 0,
        "DD medio %": ddMed, "DD max %": ddMax,
        "AVG / DD medio": ddMed > 0 ? avg10 / ddMed : null, "AVG / DD max": ddMax > 0 ? avg10 / ddMax : null,
        "AVG ratio (vinti/persi)": perdenti.length ? (posit.length ? media(posit) : 0) / media(perdenti) : null,
        "AVG del Diario %": f.avg });
    });
  });
  return obs;
}

function rho(xs, ys) { // correlazione di Spearman
  const rank = v => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length);
    for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const a = rank(xs), b = rank(ys), n = a.length, ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - ma); da += (a[i] - ma) ** 2; db += (b[i] - ma) ** 2; }
  return num / Math.sqrt(da * db);
}

function riassuntoStat(parti) {
  const finestre = []; parti.forEach(p => finestre.push(...p.finestre));
  const obs = osservazioni(finestre);
  const nomi = ["WR 10Y", "WR 20Y", "WR medio (10Y+20Y)", "AVG 10Y %", "AVG del Diario %", "AVG opposto %", "DD medio %", "DD max %", "AVG / DD medio", "AVG / DD max", "AVG ratio (vinti/persi)"];
  const righe = nomi.map(nome => {
    const v = obs.filter(o => o[nome] != null && isFinite(o[nome])).sort((a, b) => a[nome] - b[nome]);
    const n = v.length, g = [v.slice(0, Math.floor(n / 3)), v.slice(Math.floor(n / 3), Math.floor(2 * n / 3)), v.slice(Math.floor(2 * n / 3))];
    const exp = arr => arr.length ? arr.reduce((s, o) => s + o.R, 0) / arr.length : null;
    const wr = arr => arr.length ? arr.filter(o => o.R > 0).length / arr.length * 100 : null;
    return { nome, n, rho: n > 10 ? rho(v.map(o => o[nome]), v.map(o => o.R)) : null,
      gruppi: g.map(a => ({ da: a.length ? a[0][nome] : null, a: a.length ? a[a.length - 1][nome] : null, exp: exp(a), wr: wr(a), n: a.length })) };
  });
  const tot = obs.length ? obs.reduce((s, o) => s + o.R, 0) / obs.length : null;
  return { trade: obs.length, exp: tot, asset: parti.length, senzaDati: parti.filter(p => !p.conDati).map(p => p.asset), righe };
}

const f2 = n => n == null ? "—" : (n > 0 ? "+" : "") + n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f1 = n => n == null ? "—" : n.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function paginaStat(d) {
  const cella = g => `<td class="${g.exp >= d.exp ? "pos" : "neg"}"><b>${f2(g.exp)}R</b><br><small>${f1(g.da)}–${f1(g.a)}</small></td>`;
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Statistiche fuori campione</title><style>
body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:16px;background:#f6f7f3;color:#1b2433}
h1{font-size:22px;margin:0 0 6px}p{font-size:14px;line-height:1.5;color:#4a5568;margin:6px 0}
.box{background:#fff;border:1px solid #dce1e8;border-radius:12px;padding:10px;margin-top:12px}
table{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}th,td{padding:7px 4px;border-bottom:1px solid #eef0f3;text-align:right;vertical-align:top}
th:first-child,td:first-child{text-align:left}th{color:#4a5568;font-weight:600}small{color:#6b7280;font-weight:400}.pos{color:#15803d}.neg{color:#b91c1c}
</style></head><body>
<h1>Quali statistiche prevedono i risultati?</h1>
<p>Test fuori campione: per ogni anno le statistiche sono calcolate solo sugli anni precedenti, poi si misura il trade C2 di quell'anno (regole attuali, filtri 80%). ${d.trade} trade, ${d.asset} asset, expectancy media <b>${f2(d.exp)}R</b>.</p>
<p>Per ogni statistica i trade sono divisi in tre gruppi uguali (valori bassi, medi, alti). In verde i gruppi sopra la media. ρ = correlazione (oltre ±0,10 è già un segnale).</p>
<div class="box"><table><tr><th>Statistica</th><th>ρ</th><th>Bassi</th><th>Medi</th><th>Alti</th></tr>
${d.righe.map(r => `<tr><td>${r.nome}</td><td>${r.rho == null ? "—" : f2(r.rho)}</td>${r.gruppi.map(cella).join("")}</tr>`).join("")}
</table></div>
<p>Sotto ogni expectancy l'intervallo dei valori della statistica in quel gruppo. Asset senza dati: ${d.senzaDati.join(", ") || "nessuno"}.</p>
</body></html>`;
}

function paginaCaricamento(assets) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Statistiche fuori campione</title><style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:24px 16px;background:#f6f7f3;color:#1b2433}
.bar{height:10px;background:#dce1e8;border-radius:6px;overflow:hidden;margin:14px 0}.bar i{display:block;height:100%;width:0;background:#2563b8}p{font-size:15px;color:#4a5568}</style></head>
<body><h1 style="font-size:22px">Quali statistiche prevedono i risultati?</h1>
<p id="st">Calcolo in corso: 0 / ${assets.length} asset…</p><div class="bar"><i id="pb"></i></div><p>Ci vuole circa un minuto. Lascia la pagina aperta.</p>
<script>
const osservazioni = ${osservazioni.toString()};
const rho = ${rho.toString()};
const riassuntoStat = ${riassuntoStat.toString()};
const f1 = ${f1.toString()};
const f2 = ${f2.toString()};
const paginaStat = ${paginaStat.toString()};
const ASSET = ${JSON.stringify(assets)};
(async () => {
  const parti = []; let fatti = 0, i = 0;
  async function lavora() {
    while (i < ASSET.length) {
      const a = ASSET[i++]; let p = null;
      for (let t = 0; t < 3 && !p; t++) { try { const r = await fetch("/api/analisi-statistiche?asset=" + encodeURIComponent(a)); if (r.ok) p = await r.json(); } catch (e) {} }
      parti.push(p || { asset: a, conDati: false, finestre: [] });
      fatti++;
      document.getElementById("st").textContent = "Calcolo in corso: " + fatti + " / " + ASSET.length + " asset…";
      document.getElementById("pb").style.width = (fatti / ASSET.length * 100) + "%";
    }
  }
  await Promise.all([lavora(), lavora(), lavora(), lavora()]);
  const html = paginaStat(riassuntoStat(parti));
  document.open(); document.write(html); document.close();
})();
</script></body></html>`;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    if (q.asset) {
      res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
      return res.status(200).json(await calcolaAsset(q.asset));
    }
    const assets = [...new Set((await leggiDiario()).map(f => chiave(f.asset)))].sort();
    res.setHeader("Cache-Control", "s-maxage=600");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(paginaCaricamento(assets));
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).send("Errore nell'analisi: " + String((err && err.message) || err));
  }
};
module.exports.riassuntoStat = riassuntoStat;
module.exports.calcolaAsset = calcolaAsset;
