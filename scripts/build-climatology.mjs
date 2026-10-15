// Construit data/climatology.json : la référence « normale » de l'aiguille pour le Puy de Dôme.
//
// Il n'existe pas de station Météo-France au sommet du Puy de Dôme dans les données ouvertes (les postes du
// département 63 sont à 331 m à Clermont-Ferrand, 1 045 m à Vernines, 1 385 m à Chastreix). La référence est donc
// ERA5 (Copernicus / ECMWF, via Open-Meteo, CC BY 4.0) au point du décollage, passée dans le même moteur que les
// prévisions, après recalage du vent sur AROME HD (1,3 km), le seul modèle récent qui résout le cône du Puy.
//
// Étapes :
//  1. recalage : rapports de quantiles ERA5 / ICON-EU contre AROME HD, 1er oct.-5 nov. 2023-2025 (historique des
//     prévisions Open-Meteo) → facteurs BIAS de engine/config.js et relation rafale/vent ;
//  2. climatologie : ERA5 1993-2025 heure par heure, du 1er au 31 octobre, évalué avec evaluateDay() ;
//  3. références d'altitude : analyses GFS 2021-2025 (géopotentiel 500 hPa, T 850 hPa).
//
// Usage : node scripts/build-climatology.mjs   (CLIMATO_CACHE=<dossier> pour réutiliser des fichiers)

import fs from 'node:fs';
import path from 'node:path';
import { POINTS, STAGE, BIAS, VARS } from '../engine/config.js';
import { evaluateDay } from '../engine/process.js';
import { hourMargin, stationEquivalent, round, quantiles, mean, sector8, SECTORS8 } from '../engine/flyability.js';

const CACHE = process.env.CLIMATO_CACHE || '.cache';
const YEARS = [1993, 2025];
const WINDOW = [11, 25]; // jours d'octobre de la climatologie du jour : 11-25, soit ± 7 jours autour du 18
const STRIP = [15, 21]; // colonnes de la frise « mêmes jours, années précédentes »
const CALIB = { alpha: 0.697, beta: 2.301 }; // empruntée à la station de Millau (voir la méthode)
const P = POINTS.deco;

fs.mkdirSync(CACHE, { recursive: true });
const pad = (n) => String(n).padStart(2, '0');

async function openMeteo(url, cacheName) {
  const file = path.join(CACHE, cacheName);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let k = 0; k < 5; k++) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({ error: true, reason: `HTTP ${r.status}` }));
    if (!j.error) {
      fs.writeFileSync(file, JSON.stringify(j));
      return j;
    }
    console.log('Open-Meteo :', j.reason, '→ nouvel essai');
    await new Promise((res) => setTimeout(res, 15000 * (k + 1)));
  }
  throw new Error(`Open-Meteo indisponible : ${url}`);
}

// ---------------------------------------------------------------- 1. recalage sur AROME HD
const base = `latitude=${P.lat}&longitude=${P.lon}&elevation=${P.elevation}`;
const HV = 'wind_speed_10m,wind_gusts_10m';
const pairs = [];
for (const y of [2023, 2024, 2025]) {
  const rng = `start_date=${y}-10-01&end_date=${y}-11-05&hourly=${HV}&wind_speed_unit=kmh&timezone=Europe%2FParis`;
  const [a, e, i] = await Promise.all([
    openMeteo(`https://historical-forecast-api.open-meteo.com/v1/forecast?${base}&${rng}&models=meteofrance_arome_france_hd`, `bias_arome_${y}.json`),
    openMeteo(`https://archive-api.open-meteo.com/v1/archive?${base}&${rng}`, `bias_era5_${y}.json`),
    openMeteo(`https://historical-forecast-api.open-meteo.com/v1/forecast?${base}&${rng}&models=icon_eu`, `bias_iconeu_${y}.json`),
  ]);
  a.hourly.time.forEach((t, k) => {
    const h = +t.slice(11, 13);
    if (h < 9 || h > 17) return;
    const row = [a, e, i].map((x) => [x.hourly.wind_speed_10m[k], x.hourly.wind_gusts_10m[k]]);
    if (row.flat().some((v) => v == null)) return;
    pairs.push(row);
  });
}
const qs = (arr, p) => quantiles(arr, [p])[0];
const ratio = (model, ref, idx) => {
  const ps = [0.75, 0.9, 0.95];
  const r = ps.map((p) => qs(pairs.map((x) => x[ref][idx]), p) / qs(pairs.map((x) => x[model][idx]), p));
  return round(mean(r), 2);
};
const bias = {
  n: pairs.length,
  coarse: { wind: ratio(1, 0, 0), gust: ratio(1, 0, 1) },
  medium: { wind: ratio(2, 0, 0), gust: ratio(2, 0, 1) },
};
const gx = pairs.map((x) => x[0][0]);
const gy = pairs.map((x) => x[0][1]);
const gmx = mean(gx);
const gmy = mean(gy);
const gb = gx.reduce((s, x, k) => s + (x - gmx) * (gy[k] - gmy), 0) / gx.reduce((s, x) => s + (x - gmx) ** 2, 0);
const gustFromWind = { a: round(gmy - gb * gmx, 2), b: round(gb, 2), n: pairs.length };
console.log('Recalage ERA5/ICON-EU → AROME HD :', JSON.stringify(bias), 'rafale/vent', JSON.stringify(gustFromWind), '| config actuelle', JSON.stringify(BIAS));

// ---------------------------------------------------------------- 2. climatologie ERA5
const KEYS = { t: 'temperature_2m', rh: 'relative_humidity_2m', rr: 'precipitation', cc: 'cloud_cover', ccl: 'cloud_cover_low', wc: 'weather_code', ws: 'wind_speed_10m', wd: 'wind_direction_10m', wg: 'wind_gusts_10m', cape: 'cape', p: 'pressure_msl' };
const days = []; // un élément par jour d'octobre et par année
for (let y = YEARS[0]; y <= YEARS[1]; y++) {
  const url = `https://archive-api.open-meteo.com/v1/archive?${base}&start_date=${y}-10-01&end_date=${y}-10-31&hourly=${Object.values(KEYS).join(',')}&wind_speed_unit=kmh&timezone=Europe%2FParis`;
  const H = (await openMeteo(url, `era5_${y}.json`)).hourly;
  const idx = new Map(H.time.map((t, i) => [t, i]));
  for (let d = 1; d <= 31; d++) {
    const date = `${y}-10-${pad(d)}`;
    const get = (k, h) => {
      const i = h >= 24 ? idx.get(`${y}-10-${pad(d + 1)}T${pad(h - 24)}:00`) : idx.get(`${date}T${pad(h)}:00`);
      return i == null ? null : H[KEYS[k]]?.[i] ?? null;
    };
    const e = evaluateDay(get, { bias: 'coarse', calib: CALIB, elevation: P.elevation });
    const col = (k, hs) => hs.map((h) => get(k, h)).filter((x) => x != null);
    const allh = Array.from({ length: 24 }, (_, h) => h);
    days.push({
      y, d, date, e,
      tx: Math.max(...col('t', allh)), tn: Math.min(...col('t', allh)),
      rr: col('rr', allh.map((h) => h + 1)).reduce((s, x) => s + x, 0),
      fxi: Math.max(...col('wg', allh)), ffm: mean(col('ws', allh)),
      fog: allh.slice(6, 13).some((h) => [45, 48].includes(get('wc', h))),
      thunder: allh.some((h) => (get('wc', h) ?? 0) >= 95),
      mslp: mean(col('p', allh.slice(6, 19))),
      rose: allh.slice(10, 18).map((h) => [get('ws', h), get('wd', h), get('wg', h), get('rr', h)]),
      raw: Object.fromEntries(Object.keys(KEYS).map((k) => [k, allh.map((h) => get(k, h))])),
    });
  }
}
const ok = (x) => x.e.cover && x.e.M != null && x.e.M > 0;
const inWin = days.filter((x) => x.d >= WINDOW[0] && x.d <= WINDOW[1] && x.e.cover);
const pDay = inWin.filter(ok).length / inWin.length;

const limCount = {};
for (const x of inWin) if (!ok(x)) limCount[x.e.lim ?? 'autre'] = (limCount[x.e.lim ?? 'autre'] ?? 0) + 1;
const windows = inWin.map((x) => [ok(x) ? 1 : 0]);

// persistance d'un jour à l'autre
let ff = 0, fn = 0, nf = 0, nn = 0;
for (let i = 1; i < days.length; i++) {
  const a = days[i - 1];
  const b = days[i];
  if (a.y !== b.y || a.d < WINDOW[0] || b.d > WINDOW[1] || !a.e.cover || !b.e.cover) continue;
  if (ok(a)) ok(b) ? ff++ : fn++;
  else ok(b) ? nf++ : nn++;
}
const pFF = ff / (ff + fn);
const pNF = nf / (nf + nn);

const strip = [];
for (let y = YEARS[0]; y <= YEARS[1]; y++) {
  strip.push({
    year: y,
    days: days.filter((x) => x.y === y && x.d >= STRIP[0] && x.d <= STRIP[1]).map((x) => (x.e.cover ? { ok: ok(x), lim: ok(x) ? null : x.e.lim } : null)),
  });
}

// rose des vents de la fenêtre de vol et part des heures volables
const rose = Object.fromEntries(SECTORS8.map((s) => [s, { n: 0, ws: 0, fly: 0 }]));
let calm = 0;
let roseTot = 0;
for (const x of inWin) {
  for (const [ws, wd, wg, rr] of x.rose) {
    if (ws == null || wd == null) continue;
    roseTot++;
    const eq = stationEquivalent({ ws, wg, wd, rr }, 'coarse');
    const flyable = (hourMargin({ ...eq, rr: rr ?? 0 }).m ?? -1) > 0;
    if (ws < 6) {
      calm++;
      continue;
    }
    const r = rose[sector8(wd)];
    r.n++;
    r.ws += ws;
    r.fly += flyable ? 1 : 0;
  }
}

// normales
const stats = (arr, d = 1) => {
  const v = arr.filter((x) => x != null && !Number.isNaN(x));
  const m = mean(v);
  const sd = Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
  const [p10, p50, p90] = quantiles(v, [0.1, 0.5, 0.9]);
  return { mean: round(m, d), sd: round(sd, d), p10: round(p10, d), p50: round(p50, d), p90: round(p90, d) };
};
const normals = (y0, y1, [d0, d1], label) => {
  const sel = days.filter((x) => x.y >= y0 && x.y <= y1 && x.d >= d0 && x.d <= d1);
  const n = sel.length;
  return {
    days: label, period: `${y0}-${y1}`, n,
    tx: stats(sel.map((x) => x.tx)), tn: stats(sel.map((x) => x.tn)),
    pRain1: round(sel.filter((x) => x.rr >= 1).length / n, 3), pRain10: round(sel.filter((x) => x.rr >= 10).length / n, 3),
    ffm: round(mean(sel.map((x) => x.ffm)), 0), fxi: round(mean(sel.map((x) => x.fxi)), 0), pGust58: round(sel.filter((x) => x.fxi >= 58).length / n, 3),
    rrMonth: round((sel.reduce((s, x) => s + x.rr, 0) / (y1 - y0 + 1)) * (31 / (d1 - d0 + 1)), 1),
  };
};
const rec = (key, better, scale = 1) => {
  const sel = days.filter((x) => x.d >= STRIP[0] && x.d <= STRIP[1]);
  let best = sel[0];
  for (const x of sel) if (better(x[key], best[key])) best = x;
  return { value: round(best[key] * scale, 1), date: `${pad(best.d)}/10/${best.y}` };
};
const occ = days.filter((x) => x.d >= WINDOW[0] && x.d <= WINDOW[1]);
const capped = inWin.filter((x) => (x.e.hours ?? []).filter((h) => h?.lim === 'nuages' && h.m < 0).length >= 2).length / inWin.length;

// ---------------------------------------------------------------- 3. altitude (analyses GFS)
const z500 = [];
const t850 = [];
for (let y = 2021; y <= 2025; y++) {
  const url = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${P.lat}&longitude=${P.lon}&start_date=${y}-10-01&end_date=${y}-10-25&hourly=geopotential_height_500hPa,temperature_850hPa&models=gfs_global&timezone=Europe%2FParis`;
  const H = (await openMeteo(url, `gfs_upper_${y}.json`)).hourly;
  H.time.forEach((t, i) => {
    if (+t.slice(11, 13) !== 12) return;
    if (H.geopotential_height_500hPa[i] != null) z500.push(H.geopotential_height_500hPa[i]);
    if (H.temperature_850hPa[i] != null) t850.push(H.temperature_850hPa[i]);
  });
}

// ---------------------------------------------------------------- écriture
const dz = P.elevation - POINTS.atterro.elevation;
const out = {
  generatedAt: new Date().toISOString(),
  station: { id: 'era5', name: 'ERA5 au sommet du Puy de Dôme', lat: P.lat, lon: P.lon, alt: P.elevation },
  sources: {
    era5: 'ERA5 (Copernicus Climate Change Service / ECMWF) via Open-Meteo Historical Weather API (CC BY 4.0)',
    arome: 'AROME HD (Météo-France) et ICON-EU (DWD) via Open-Meteo Historical Forecast API',
    gfs: 'Analyses NOAA GFS via Open-Meteo Historical Forecast API',
  },
  bias,
  calibration: {
    alpha: CALIB.alpha, beta: CALIB.beta, n: null, period: 'empruntée à la station de Millau (octobre 1993-2025)', borrowed: true,
    brier: null, brierClim: null, bss: null, agreement: null, pStationGivenModelFly: null, pStationGivenModelNoFly: null, reliability: [],
  },
  windScale: { note: 'Rapports de quantiles 0,75-0,95 contre AROME HD, heures de 9 h à 17 h, 1er oct.-5 nov. 2023-2025', wind: bias.coarse, gust: bias.coarse, corrWind: null },
  gustFromWind,
  mornings: {
    period: `${YEARS[0]}-${YEARS[1]}`,
    window: `${WINDOW[0]}-${WINDOW[1]} oct.`,
    n: inWin.length,
    pMorning: round(pDay, 4),
    limiting: Object.fromEntries(Object.entries(limCount).map(([k, v]) => [k, round(v / inWin.length, 3)])),
    windowsN: windows.length,
    dist4: [round(1 - pDay, 4), round(pDay, 4)],
    pAtLeast: [round(pDay, 4)],
    pFlyAfterFly: round(pFF, 3),
    pFlyAfterNoFly: round(pNF, 3),
    windows,
  },
  strip,
  stripDays: Array.from({ length: STRIP[1] - STRIP[0] + 1 }, (_, i) => STRIP[0] + i),
  windRose: {
    calm: round(calm / roseTot, 3),
    sectors: SECTORS8.map((s) => ({ sector: s, freq: round(rose[s].n / roseTot, 3), ws: round(rose[s].n ? rose[s].ws / rose[s].n : null, 1), fly: round(rose[s].n ? rose[s].fly / rose[s].n : null, 2) })),
  },
  normals: {
    october: normals(1993, 2020, [1, 31], 'octobre'),
    window: normals(1993, 2020, STRIP, `${STRIP[0]}-${STRIP[1]} oct.`),
    windowRecent: normals(1996, 2025, STRIP, `${STRIP[0]}-${STRIP[1]} oct.`),
    records: {
      since: YEARS[0],
      txMax: rec('tx', (a, b) => a > b),
      tnMin: rec('tn', (a, b) => a < b),
      rrMax: rec('rr', (a, b) => a > b),
      fxiMax: rec('fxi', (a, b) => a > b),
    },
  },
  occurrences: {
    period: `${YEARS[0]}-${YEARS[1]} (ERA5)`, window: `${WINDOW[0]}-${WINDOW[1]} oct.`, n: occ.length,
    fog: null, thunder: null, // les codes météo d'ERA5 ne signalent ni brouillard ni orage de façon fiable
    mist: null, capped: round(capped, 3),
  },
  valley: {
    station: 'gradient standard (pas de station au sommet)',
    id: null, years: null, n: null,
    dTx: round(0.0065 * dz, 1), dTn: round(0.0065 * dz * 0.5, 1), pInversion: null,
  },
  era5: { mslp: stats(occ.map((x) => x.mslp)), period: `${YEARS[0]}-${YEARS[1]}`, window: `${WINDOW[0]}-${WINDOW[1]} oct.` },
  upper: { z500: stats(z500, 0), t850: stats(t850, 1), ref: 'analyses GFS de 12 h locale, 1er-25 octobre 2021-2025 (référence courte)' },
  aigoual: { period: '', p50: null, p100: null, mean: null },
};
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/climatology.json', JSON.stringify(out));
console.log('data/climatology.json écrit :', {
  pJour: out.mornings.pMorning,
  limitant: out.mornings.limiting,
  persistance: [out.mornings.pFlyAfterFly, out.mornings.pFlyAfterNoFly],
  normales: out.normals.window.tx,
  cloche: out.occurrences,
});
