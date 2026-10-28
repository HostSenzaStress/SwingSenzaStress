// Test "fuori campione" delle statistiche stagionali.
// Per ogni finestra del Diario e ogni anno Y, le statistiche (WR, AVG, AVG opposto, DD medio, DD max, AVG/DD)
// sono calcolate SOLO sugli anni precedenti a Y; poi si guarda l'esito del trade C2 dell'anno Y
// (regole attuali: filtro movimento 80% e timing 80%). Così si vede quali statistiche PREVEDONO i risultati.
// Pagina interna: /api/analisi-statistiche (scarica gli asset uno alla volta: ?asset=NDX)

const T = require("./analisi-timing.js");
const { leggiDiario, storico, chiave, sezioneTiming } = T;
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
  // Contesto di trend alla C2: distanza dalla media a 200 giorni e sua pendenza su 20 giorni, "a favore" della direzione
  let sma = null, pend = null;
  if (iE >= 219) {
    const m = k => { let t = 0; for (let x = k - 199; x <= k; x++) t += cs[x].close; return t / 200; };
    const m0 = m(iE), m20 = m(iE - 20), segno = long ? 1 : -1;
    sma = Math.round(segno * (e / m0 - 1) * 10000) / 100;
    pend = Math.round(segno * (m0 / m20 - 1) * 10000) / 100;
  }
  const esito = (R, u) => ({ R, u, sma, pend });
  const stop = long ? e * (1 - risk / 100) : e * (1 + risk / 100), tgt = long ? e * (1 + avg / 100) : e * (1 - avg / 100);
  let ult = iE;
  for (let j = iE + 1; j < cs.length && dentro(cs[j]); j++) {
    ult = j;
    const b = cs[j], sl = long ? b.low <= stop : b.high >= stop, tp = long ? b.high >= tgt : b.low <= tgt;
    if (sl || tp) return sl ? esito(-1, "SL") : esito(2, "TP");
  }
  const p = cs[ult].close, pct = long ? (p / e - 1) * 100 : (1 - p / e) * 100;
  return esito(Math.round(pct / risk * 100) / 100, "Fine");
}

// Strategia "ordine al DD medio": ordine limite a (DD medio x k) dal prezzo di riferimento
// (chiusura del giorno prima dell'inizio finestra). Se il prezzo apre già oltre il livello si entra all'apertura.
// TP = AVG medio, SL = metà AVG dal prezzo d'ingresso. Sulla candela d'ingresso conta solo lo SL (ipotesi prudente).
// Chiusura all'ultima candela della finestra. Restituisce null se l'ordine non viene eseguito.
function tradeDD(cs, ini, fin, long, avg, ddPct) {
  if (!(ddPct > 0)) return null;
  const primo = cs.findIndex(b => b.time >= ini);
  if (primo < 1 || cs[primo].time > fin) return null;
  const rif = cs[primo - 1].close, lim = long ? rif * (1 - ddPct / 100) : rif * (1 + ddPct / 100);
  for (let i = primo; i < cs.length && cs[i].time <= fin; i++) {
    const b = cs[i];
    const preso = long ? b.low <= lim : b.high >= lim;
    if (!preso) continue;
    const e = long ? Math.min(b.open, lim) : Math.max(b.open, lim), risk = avg / 2;
    const stop = long ? e * (1 - risk / 100) : e * (1 + risk / 100), tgt = long ? e * (1 + avg / 100) : e * (1 - avg / 100);
    const giorni = (ms(fin) - ms(ini)) / 864e5, timing = giorni > 0 ? (ms(b.time) - ms(ini)) / 864e5 / giorni * 100 : 0;
    if (long ? b.low <= stop : b.high >= stop) return { R: -1, u: "SL", timing };
    let ult = i;
    for (let j = i + 1; j < cs.length && cs[j].time <= fin; j++) {
      ult = j;
      const c = cs[j], sl = long ? c.low <= stop : c.high >= stop, tp = long ? c.high >= tgt : c.low <= tgt;
      if (sl || tp) return { R: sl ? -1 : 2, u: sl ? "SL" : "TP", timing };
    }
    const p = cs[ult].close, pct = long ? (p / e - 1) * 100 : (1 - p / e) * 100;
    return { R: Math.round(pct / risk * 100) / 100, u: "Fine", timing };
  }
  return null;
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
      const t = tradeC2(cs, ini, fin, f.long, f.avg);
      // DD medio "fuori campione": media dei drawdown dei 10 anni precedenti (serve uno storico di almeno 5 anni)
      const prec = anni.slice(-10), ddOos = prec.length >= 5 ? prec.reduce((x, a) => x + a.dd, 0) / prec.length : null;
      const dd = {};
      [0.5, 1, 1.5].forEach(k => { dd["d" + k] = tradeDD(cs, ini, fin, f.long, f.avg, f.ddMed * k); });
      dd.oos = ddOos != null ? tradeDD(cs, ini, fin, f.long, f.avg, ddOos) : undefined;
      anni.push({ y, ret: Math.round(s.ret * 100) / 100, dd: Math.round(s.dd * 100) / 100,
        R: t ? t.R : null, u: t ? t.u : null, sma: t ? t.sma : null, pend: t ? t.pend : null, ddS: dd });
    }
    out.push({ id: f.id, asset: f.asset, long: f.long, avg: f.avg, ddMed: f.ddMed, anni });
  });
  const timing = await T.calcolaAsset(asset, { finestre, cs });
  return { asset, conDati: cs.length > 0, finestre: out, timing };
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

// Confronti a gruppi su TUTTI i trade C2 (non serve lo storico di 10 anni)
function riassuntoDD(parti) {
  const fa = []; // una riga per finestra-anno
  parti.forEach(p => p.finestre.forEach(f => f.anni.forEach(a => { if (a.ddS) fa.push(Object.assign({ id: f.id, avg: f.avg, ddMed: f.ddMed }, a)); })));
  const st = (nome, arr, base) => {
    const n = arr.length, somma = arr.reduce((s, o) => s + o.R, 0);
    return { nome, n, base, fill: base ? n / base * 100 : null, wr: n ? arr.filter(o => o.R > 0).length / n * 100 : null, exp: n ? somma / n : null, tot: somma,
      tp: n ? arr.filter(o => o.u === "TP").length / n * 100 : null, sl: n ? arr.filter(o => o.u === "SL").length / n * 100 : null,
      fine: n ? arr.filter(o => o.u === "Fine").length / n * 100 : null,
      tim: n ? arr.reduce((s, o) => s + (o.timing || 0), 0) / n : null };
  };
  const conDD = fa.filter(o => o.ddMed > 0);
  const preso = k => conDD.map(o => o.ddS[k]).filter(Boolean);
  const c2 = conDD.filter(o => o.R != null).map(o => ({ R: o.R, u: o.u }));
  const oosBase = fa.filter(o => o.ddS.oos !== undefined);
  const dd1 = conDD.filter(o => o.ddS.d1), noDD1 = conDD.filter(o => !o.ddS.d1);
  return {
    finestreAnni: conDD.length, finestre: new Set(conDD.map(o => o.id)).size,
    righe: [st("C2 (metodo attuale, filtri 80%)", c2, conDD.length),
      st("Ordine a metà DD medio (0,5×)", preso("d0.5"), conDD.length),
      st("Ordine al DD medio (1×)", preso("d1"), conDD.length),
      st("Ordine a 1,5× il DD medio", preso("d1.5"), conDD.length),
      st("DD medio fuori campione (media 10 anni precedenti)", oosBase.map(o => o.ddS.oos).filter(Boolean), oosBase.length)],
    selezione: [st("C2 negli anni in cui l'ordine al DD medio scatta", dd1.filter(o => o.R != null).map(o => ({ R: o.R, u: o.u })), dd1.length),
      st("C2 negli anni in cui l'ordine NON scatta", noDD1.filter(o => o.R != null).map(o => ({ R: o.R, u: o.u })), noDD1.length)],
    combo: [st("Solo C2", c2, conDD.length),
      st("C2 + ordine al DD medio (due trade separati)", [...c2, ...preso("d1")], conDD.length),
      st("Ordine al DD medio, altrimenti C2", conDD.map(o => o.ddS.d1 || (o.R != null ? { R: o.R, u: o.u } : null)).filter(Boolean), conDD.length)]
  };
}

function riassuntoGruppi(parti) {
  const t = [];
  parti.forEach(p => p.finestre.forEach(f => f.anni.forEach(a => { if (a.R != null) t.push(Object.assign({ avg: f.avg, id: f.id, long: f.long }, a)); })));
  const st = (nome, arr) => {
    const n = arr.length, somma = arr.reduce((s, o) => s + o.R, 0);
    const vinti = arr.filter(o => o.R > 0).map(o => o.R), persi = arr.filter(o => o.R <= 0).map(o => o.R);
    const m = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    return { nome, n, fin: new Set(arr.map(o => o.id)).size, wr: n ? vinti.length / n * 100 : null, exp: n ? somma / n : null, tot: somma,
      tp: n ? arr.filter(o => o.u === "TP").length / n * 100 : null, sl: n ? arr.filter(o => o.u === "SL").length / n * 100 : null,
      mv: m(vinti), mp: m(persi) };
  };
  const conSma = t.filter(o => o.sma != null);
  const terzili = (arr, k) => { const v = arr.filter(o => o[k] != null).sort((a, b) => a[k] - b[k]), n = v.length;
    return [v.slice(0, Math.floor(n / 3)), v.slice(Math.floor(n / 3), Math.floor(2 * n / 3)), v.slice(Math.floor(2 * n / 3))]; };
  const rng = (g, k, u) => g.length ? ` (${f1(g[0][k])}${u} → ${f1(g[g.length - 1][k])}${u})` : "";
  const dist = terzili(conSma, "sma"), pend = terzili(conSma, "pend");
  return {
    tutti: st("Tutti i trade", t),
    avg: [st("AVG sotto il 6%", t.filter(o => o.avg < 6)), st("AVG 6% o più", t.filter(o => o.avg >= 6))],
    avgFine: [st("AVG sotto il 4%", t.filter(o => o.avg < 4)), st("AVG 4–6%", t.filter(o => o.avg >= 4 && o.avg < 6)),
      st("AVG 6–9%", t.filter(o => o.avg >= 6 && o.avg < 9)), st("AVG 9% o più", t.filter(o => o.avg >= 9))],
    sma: [st("A favore del trend (LONG sopra la SMA200, SHORT sotto)", conSma.filter(o => o.sma > 0)),
      st("Contro trend", conSma.filter(o => o.sma <= 0))],
    smaDir: [st("LONG sopra la SMA200", conSma.filter(o => o.long && o.sma > 0)), st("LONG sotto la SMA200", conSma.filter(o => o.long && o.sma <= 0)),
      st("SHORT sotto la SMA200", conSma.filter(o => !o.long && o.sma > 0)), st("SHORT sopra la SMA200", conSma.filter(o => !o.long && o.sma <= 0))],
    pendenza: [st("SMA200 in salita a favore (pendenza 20 gg > 0)", conSma.filter(o => o.pend > 0)), st("SMA200 contro", conSma.filter(o => o.pend <= 0))],
    combo: [st("Prezzo e pendenza entrambi a favore", conSma.filter(o => o.sma > 0 && o.pend > 0)),
      st("Uno solo a favore", conSma.filter(o => (o.sma > 0) !== (o.pend > 0))),
      st("Entrambi contro", conSma.filter(o => o.sma <= 0 && o.pend <= 0))],
    dist: dist.map((g, i) => st(["Distanza bassa", "Distanza media", "Distanza alta"][i] + rng(g, "sma", "%"), g)),
    pendT: pend.map((g, i) => st(["Pendenza bassa", "Pendenza media", "Pendenza alta"][i] + rng(g, "pend", "%"), g)),
    rhoSma: conSma.length > 10 ? rho(conSma.map(o => o.sma), conSma.map(o => o.R)) : null,
    rhoPend: conSma.length > 10 ? rho(conSma.map(o => o.pend), conSma.map(o => o.R)) : null
  };
}

const f2 = n => n == null ? "—" : (n > 0 ? "+" : "") + n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f1 = n => n == null ? "—" : n.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function tabGruppi(titolo, nota, righe, rif) {
  return `<h3>${titolo}</h3>${nota ? `<p>${nota}</p>` : ""}<div class="box"><table><tr><th>Gruppo</th><th>Trade</th><th>Win rate</th><th>Expectancy</th><th>R totali</th><th>TP / SL</th></tr>
${righe.map(r => `<tr><td>${r.nome}<br><small>${r.fin} finestre · media vinti ${f2(r.mv)}R, persi ${f2(r.mp)}R</small></td><td>${r.n}</td><td>${f1(r.wr)}%</td>
<td class="${r.exp >= rif ? "pos" : "neg"}"><b>${f2(r.exp)}R</b></td><td>${f2(r.tot)}R</td><td>${f1(r.tp)}% / ${f1(r.sl)}%</td></tr>`).join("")}</table></div>`;
}
function tabDD(titolo, nota, righe) {
  const rif = righe[0].exp;
  return `<h3>${titolo}</h3>${nota ? `<p>${nota}</p>` : ""}<div class="box"><table><tr><th>Strategia</th><th>Eseguiti</th><th>Win rate</th><th>Expectancy</th><th>R totali</th><th>TP / SL / Fine</th></tr>
${righe.map((r, i) => `<tr><td>${r.nome}${r.tim != null && i ? `<br><small>ingresso medio al ${f1(r.tim)}% della finestra</small>` : ""}</td><td>${r.n}<br><small>${f1(r.fill)}% di ${r.base}</small></td><td>${f1(r.wr)}%</td>
<td class="${i === 0 ? "" : r.exp >= rif ? "pos" : "neg"}"><b>${f2(r.exp)}R</b></td><td>${f2(r.tot)}R</td><td>${f1(r.tp)} / ${f1(r.sl)} / ${f1(r.fine)}%</td></tr>`).join("")}</table></div>`;
}
function paginaStat(d, g, t, x) {
  const cella = g => `<td class="${g.exp >= d.exp ? "pos" : "neg"}"><b>${f2(g.exp)}R</b><br><small>${f1(g.da)}–${f1(g.a)}</small></td>`;
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Analisi statistiche C2</title><style>
body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:16px;background:#f6f7f3;color:#1b2433}
h1{font-size:22px;margin:0 0 6px}h2{font-size:19px;margin:34px 0 6px;padding-top:14px;border-top:2px solid #dce1e8}h3{font-size:15px;margin:20px 0 4px}a{color:#2563b8}
.kpi{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.kpi div{background:#fff;border:1px solid #dce1e8;border-radius:12px;padding:10px;font-size:13px;color:#4a5568}.kpi b{display:block;font-size:20px;color:#1b2433}p{font-size:14px;line-height:1.5;color:#4a5568;margin:6px 0}
.box{background:#fff;border:1px solid #dce1e8;border-radius:12px;padding:10px;margin-top:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}th,td{padding:7px 4px;border-bottom:1px solid #eef0f3;text-align:right;vertical-align:top}
th:first-child,td:first-child{text-align:left;min-width:110px;width:40%}th{color:#4a5568;font-weight:600}small{color:#6b7280;font-weight:400}.pos{color:#15803d}.neg{color:#b91c1c}
</style></head><body>
<h1>Analisi statistiche · Metodo C2</h1>
<p>Tutte le analisi sui backtest delle finestre del Diario in un'unica pagina: <a href="#s1">1 · Timing d'ingresso</a> · <a href="#s2">2 · AVG sotto e sopra il 6%</a> · <a href="#s3">3 · Media a 200 giorni</a> · <a href="#s4">4 · Statistiche stagionali fuori campione</a> · <a href="#s5">5 · Strategia ordine al DD medio</a>.</p>
${t ? `<h2 id="s1">1 · Timing d'ingresso</h2>${sezioneTiming(t, 1)}` : ""}
${g ? `<h2 id="s2">2 · AVG sotto e sopra il 6%</h2><p>Le sezioni 2 e 3 usano <b>tutti</b> i trade C2 dal 2006 con le regole attuali (filtri 80%): ${g.tutti.n} trade, win rate ${f1(g.tutti.wr)}%, expectancy <b>${f2(g.tutti.exp)}R</b>, ${f2(g.tutti.tot)}R totali. Con rischio 1% a trade, 1R = 1% del conto.</p>
${tabGruppi("Due gruppi", "AVG medio del Diario della stagionalità.", g.avg, g.tutti.exp)}
${tabGruppi("AVG più nel dettaglio", "", g.avgFine, g.tutti.exp)}
<h2 id="s3">3 · Media a 200 giorni</h2>
${tabGruppi("Prezzo rispetto alla media a 200 giorni", "Misurato alla chiusura della C2, cioè al momento dell'ingresso. «A favore» = LONG con prezzo sopra la SMA200 oppure SHORT con prezzo sotto.", g.sma, g.tutti.exp)}
${tabGruppi("Divisi per direzione", "", g.smaDir, g.tutti.exp)}
${tabGruppi("Pendenza della SMA200", "Variazione della SMA200 negli ultimi 20 giorni, a favore della direzione del trade.", g.pendenza, g.tutti.exp)}
${tabGruppi("Prezzo e pendenza insieme", "", g.combo, g.tutti.exp)}
${tabGruppi("Distanza dalla SMA200 (terzili)", `Distanza del prezzo dalla SMA200 a favore della direzione. ρ = ${f2(g.rhoSma)}.`, g.dist, g.tutti.exp)}
${tabGruppi("Pendenza della SMA200 (terzili)", `ρ = ${f2(g.rhoPend)}.`, g.pendT, g.tutti.exp)}` : ""}
<h2 id="s4">4 · Quali statistiche stagionali prevedono i risultati?</h2>
<p>Test fuori campione: per ogni anno le statistiche sono calcolate solo sugli anni precedenti, poi si misura il trade C2 di quell'anno (regole attuali, filtri 80%). ${d.trade} trade, ${d.asset} asset, expectancy media <b>${f2(d.exp)}R</b>.</p>
<p>Per ogni statistica i trade sono divisi in tre gruppi uguali (valori bassi, medi, alti). In verde i gruppi sopra la media. ρ = correlazione (oltre ±0,10 è già un segnale).</p>
<div class="box"><table><tr><th>Statistica</th><th>ρ</th><th>Bassi</th><th>Medi</th><th>Alti</th></tr>
${d.righe.map(r => `<tr><td>${r.nome}</td><td>${r.rho == null ? "—" : f2(r.rho)}</td>${r.gruppi.map(cella).join("")}</tr>`).join("")}
</table></div>
<p>Sotto ogni expectancy l'intervallo dei valori della statistica in quel gruppo. Asset senza dati: ${d.senzaDati.join(", ") || "nessuno"}.</p>

${x ? `<h2 id="s5">5 · Strategia alternativa: ordine al DD medio</h2>
<p>Invece di aspettare la C2, si mette un ordine limite a una distanza pari al DD medio della stagionalità (colonna DD Medio del Diario), misurata dalla chiusura del giorno prima dell'inizio finestra. Se il prezzo ci arriva entro la finestra si entra; se apre già oltre il livello si entra all'apertura. TP = AVG medio, SL = metà AVG dal prezzo d'ingresso, chiusura a fine finestra. Sulla candela d'ingresso conta solo lo SL (ipotesi prudente: non sappiamo se il prezzo è sceso ancora dopo l'ingresso). Nessun costo o spread.</p>
<p>${x.finestre} finestre, ${x.finestreAnni} finestre-anno dal 2006. «Eseguiti» = trade fatti e % delle finestre-anno in cui l'ordine è scattato.</p>
${tabDD("Confronto con la C2", "In verde le strategie con expectancy più alta della C2.", x.righe)}
${tabDD("L'ordine scatta negli anni peggiori?", "Come va la C2 negli anni in cui il prezzo scende fino al DD medio e in quelli in cui non ci arriva. Se la C2 rende molto meno negli anni «scatta», l'ordine al DD seleziona proprio gli anni difficili.", x.selezione)}
${tabDD("Usarle insieme", "Per finestra-anno: una sola strategia, entrambe come trade separati, oppure l'ordine al DD con la C2 come riserva quando l'ordine non scatta.", x.combo)}` : ""}
</body></html>`;
}

function paginaCaricamento(assets) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Analisi statistiche C2</title><style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:24px 16px;background:#f6f7f3;color:#1b2433}
.bar{height:10px;background:#dce1e8;border-radius:6px;overflow:hidden;margin:14px 0}.bar i{display:block;height:100%;width:0;background:#2563b8}p{font-size:15px;color:#4a5568}</style></head>
<body><h1 style="font-size:22px">Analisi statistiche · Metodo C2</h1>
<p id="st">Calcolo in corso: 0 / ${assets.length} asset…</p><div class="bar"><i id="pb"></i></div><p>Ci vuole circa un minuto. Lascia la pagina aperta.</p>
<script>
const osservazioni = ${osservazioni.toString()};
const rho = ${rho.toString()};
const riassuntoStat = ${riassuntoStat.toString()};
const f1 = ${f1.toString()};
const f2 = ${f2.toString()};
const tabGruppi = ${tabGruppi.toString()};
const riassuntoGruppi = ${riassuntoGruppi.toString()};
const sezioneTiming = ${T.sezioneTiming.toString()};
const statistiche = ${T.statistiche.toString()};
const riassunto = ${T.riassunto.toString()};
const riassuntoDD = ${riassuntoDD.toString()};
const tabDD = ${tabDD.toString()};
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
  const vuoto = p => ({ asset: p.asset, conDati: p.conDati, finestre: 0, base: [], filtrati: [], confronto: { pari: 0, totale: 0 } });
  const html = paginaStat(riassuntoStat(parti), riassuntoGruppi(parti), riassunto(parti.map(p => p.timing || vuoto(p))), riassuntoDD(parti));
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
module.exports.riassuntoGruppi = riassuntoGruppi;
module.exports.paginaStat = paginaStat;
module.exports.paginaCaricamento = paginaCaricamento;
module.exports.riassuntoDD = riassuntoDD;
module.exports.tradeDD = tradeDD;
