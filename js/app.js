// Page du VU-mètre : lit data/latest.json et data/history.json, dessine l'aiguille et le détail,
// puis revérifie toutes les 5 minutes pour faire bouger l'aiguille dès qu'une mise à jour est publiée.

import { createGauge } from './gauge.js';
import { renderFinale, confetti } from './finale.js';
import { stageOver, stageOutcome } from '../engine/finale.js';
import { h, heat, fmtPct, fmtScore, historyChart, hourFlyChart, regimeBars, windRose } from './charts.js';
import { REGIMES, LIMITS, SITES, ENSEMBLES, DETERMINISTIC, EXPERTS, LEAD, BIAS } from '../engine/config.js';

const POLL_MS = 5 * 60 * 1000;
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* stockage indisponible : sans conséquence */
    }
  },
};

/** Familles de régimes pour les barres empilées (5 teintes validées pour le daltonisme, ordre fixe). */
const FAMILIES = {
  pluie: { label: 'Pluie, perturbation ou épisode méditerranéen', short: 'Pluie', color: '--reg-1', ink: '#fff', members: ['cevenol', 'perturbe', 'instable'] },
  sud: { label: 'Flux de sud-est (vent du Midi, marin)', short: 'Sud-est', color: '--reg-2', ink: '#fff', members: ['sud'] },
  nord: { label: 'Flux de nord à ouest (tramontane, flux atlantique)', short: 'Nord-ouest', color: '--reg-3', ink: '#0b0b0b', members: ['nord', 'ouest'] },
  calme: { label: 'Calme : anticyclone ou marais barométrique', short: 'Calme', color: '--reg-4', ink: '#0b0b0b', members: ['anticyclone', 'marais'] },
  est: { label: "Vent d'est à nord-est", short: 'Est', color: '--reg-5', ink: '#0b0b0b', members: ['est'] },
};
const FAMILY_OF = Object.fromEntries(Object.entries(FAMILIES).flatMap(([f, v]) => v.members.map((m) => [m, f])));
const LIM_LABEL = {
  pluie: 'pluie',
  vent: 'vent moyen trop fort',
  rafales: 'rafales',
  direction: 'direction du vent',
  turbulence: 'turbulence (rafales fortes)',
  nuages: 'nuages bas ou brouillard au déco',
  orage: 'orage',
  ventMeteo: 'vent fort en altitude',
};
const LIM_SHORT = { pluie: 'pluie', vent: 'vent', rafales: 'raf.', direction: 'dir.', turbulence: 'turb.', nuages: 'nuages', orage: 'orage', ventMeteo: 'vent alt.' };
const CONF_LABEL = { faible: 'Fiabilité faible', moyenne: 'Fiabilité moyenne', bonne: 'Bonne fiabilité' };

const $ = (id) => document.getElementById(id);
const fr = (x, d = 0) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d).replace('.', ',').replace('-', '−'));
const fmtWhen = (iso, opts = {}) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...opts }) : '—');
const shortDay = (label) => label.replace(' octobre', '');
const q = (arr, d = 0, unit = '') => (arr ? `${fr(arr[1], d)}${unit}` : '—');
const qr = (arr, d = 0, unit = '') => (arr ? `${fr(arr[1], d)}${unit} (${fr(arr[0], d)} à ${fr(arr[2], d)})` : '—');
const fmtDay = (date, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...opts });
const PG = EXPERTS.find((e) => e.id === 'paraglidable');
const REPO = 'r69sy78sny-droid/puy-de-dome';
const REPO_URL = `https://github.com/${REPO}`;
const SECT = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const sector = (deg) => (deg == null ? '—' : SECT[Math.floor(((deg + 22.5) % 360) / 45)]);

let report = null;
let history = [];
let selectedDay = null;
let gauge = null;

// ---------------------------------------------------------------- chargement
async function load() {
  const bust = `?t=${Date.now()}`;
  const [r, hist] = await Promise.all([
    fetch(`data/latest.json${bust}`, { cache: 'no-store' }).then((x) => x.json()),
    fetch(`data/history.json${bust}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => []),
  ]);
  return { r, hist };
}

async function refresh(initial = false) {
  let data;
  try {
    data = await load();
  } catch (e) {
    if (initial) $('verdict').textContent = 'Données indisponibles pour le moment';
    return;
  }
  const changed = !report || data.r.generatedAt !== report.generatedAt;
  if (!changed) return;
  const previous = report;
  report = data.r;
  history = data.hist;
  if (selectedDay == null) {
    const firstFuture = report.days.findIndex((d) => !d.past);
    selectedDay = firstFuture < 0 ? 0 : firstFuture;
  }
  renderAll({ previous, initial });
}

// ---------------------------------------------------------------- fin de la journée
// ?finale=succes | rate | attente force la carte de fin (aperçu) ; sans paramètre, elle apparaît toute seule
// à 18 h le dimanche 18, quand la fenêtre de vol est passée.
const FORCED = new URLSearchParams(location.search).get('finale');
const FORCED_OBSERVED = { succes: [true], rate: [false], attente: [null] };
const isOver = () => FORCED in FORCED_OBSERVED || (report ? stageOver(Date.now(), report.stage.dates) : false);
const ISSUES_URL = `${REPO_URL}/issues`;
let finalePlayed = false;

function showFinale({ celebrate }) {
  const box = $('finale');
  const observed = FORCED in FORCED_OBSERVED ? FORCED_OBSERVED[FORCED] : report.days.map((d) => d.observed);
  const outcome = stageOutcome(observed, report.stage.sessionsNeeded);
  renderFinale(box, {
    days: report.days.map((d, i) => ({ label: shortDay(d.label), observed: observed[i], p: d.p })),
    outcome,
    issueUrl: ISSUES_URL,
    onReplay: () => {
      showFinale({ celebrate: true });
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });
  if (celebrate && outcome.kind === 'reussi') confetti();
}

function renderFinaleCard() {
  if (!isOver()) {
    $('finale').hidden = true;
    return;
  }
  // Les confettis ne partent qu'une fois par visite ; les mises à jour suivantes ne font que rafraîchir la carte.
  showFinale({ celebrate: !finalePlayed });
  finalePlayed = true;
}

function renderAll({ previous, initial }) {
  renderHero(previous, initial);
  renderFinaleCard();
  renderDays();
  renderDist();
  renderHistory();
  renderDayDetail();
  renderAnalysis();
  renderModels();
  renderClimatology();
  renderMethod();
}

// ---------------------------------------------------------------- héros
function renderHero(previous, initial) {
  const r = report;
  if (!gauge) gauge = createGauge($('gauge'));
  const lastSeen = Number(store.get('lastScore'));
  const from = previous ? previous.score : initial && !Number.isNaN(lastSeen) && store.get('lastScore') != null ? lastSeen : -180;
  gauge.setClimatology(r.climatology.scoreClim);
  gauge.setTrail(history.slice(-13, -1).map((e) => e.score));
  gauge.set(r.score, { from });
  gauge.setLabel(`Aiguille à ${fmtScore(r.score)} sur une échelle de −180 (impossible) à +180 (tu pourras voler) : ${r.verdict.label}.`);
  $('score').textContent = fmtScore(r.score);
  $('verdict').textContent = r.verdict.label;
  $('proba').replaceChildren('Probabilité de pouvoir voler ', h('b', {}, r.stage.dayLabel), ' : ', h('b', {}, fmtPct(r.p)));
  $('proba2').replaceChildren(`Il faut au moins 2 h volables d'affilée entre ${r.stage.windowHours[0]} h et ${r.stage.windowHours[1]} h.`);
  $('clim').textContent = `Normale à cette date (${r.climatology.period}) : ${fmtPct(r.climatology.pAtLeast[0])}, soit ${fmtScore(r.climatology.scoreClim)} sur l'aiguille.`;
  $('summary').textContent = r.analysis.summary.slice(1).join(' ');
  const ageH = (Date.now() - Date.parse(r.generatedAt)) / 3600e3;
  const over = isOver();
  const delta = previous ? r.score - previous.score : lastSeenDelta(lastSeen, r.score);
  $('updated').replaceChildren(...[
    h('span', { class: `badge ${!over && ageH < 12 ? 'live' : ''}` }, h('i', { class: 'dot' }), over ? 'Stage terminé' : ageH < 12 ? 'Suivi en direct' : 'Suivi en pause'),
    h('span', {}, `Données modifiées ${fmtWhen(r.generatedAt)}`),
    r.triggers?.length ? h('span', {}, `après ${r.triggers.join(', ')}`) : null,
    delta ? h('span', {}, `${fmtScore(delta)} depuis ta dernière visite`) : null,
    h('span', { id: 'lastcheck' }),
  ].filter(Boolean));
  showLastCheck();
  store.set('lastScore', String(r.score));
  if (previous && previous.score !== r.score) toast(`Nouvelle mise à jour : ${fmtScore(previous.score)} → ${fmtScore(r.score)}`);
}
const lastSeenDelta = (lastSeen, score) => (store.get('lastScore') == null || Number.isNaN(lastSeen) ? 0 : score - lastSeen);

// Dernière vérification du robot (même sans nouveauté) : lue dans l'API publique de GitHub Actions.
let lastCheck = null;
async function fetchLastCheck() {
  // Heure de fin du dernier job « update » réussi (le passage reste « en cours » pendant l'attente de la relance).
  const base = `https://api.github.com/repos/${REPO}/actions`;
  const get = async (url) => (await fetch(url, { cache: 'no-store' })).json();
  try {
    const runs = (await get(`${base}/workflows/aiguille.yml/runs?per_page=4`)).workflow_runs ?? [];
    for (const run of runs.slice(0, 3)) {
      const job = ((await get(`${base}/runs/${run.id}/jobs`)).jobs ?? []).find((j) => j.name === 'update' && j.conclusion === 'success');
      if (job) {
        lastCheck = job.completed_at;
        break;
      }
    }
  } catch {
    /* API indisponible ou quota atteint : on garde la dernière valeur */
  }
  showLastCheck();
}
function showLastCheck() {
  const el = $('lastcheck');
  if (!el || !report) return;
  if (!lastCheck) return (el.textContent = '');
  const newer = Date.parse(lastCheck) > Date.parse(report.generatedAt) + 60000;
  el.textContent = newer
    ? `Dernière vérification ${fmtWhen(lastCheck)} (pas de modification depuis ${fmtWhen(report.generatedAt)})`
    : `Dernière vérification ${fmtWhen(lastCheck)}`;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 6000);
}

// ---------------------------------------------------------------- cartes des jours
function familyShares(regimes) {
  const out = {};
  for (const reg of regimes ?? []) {
    const f = FAMILY_OF[reg.id] ?? 'calme';
    out[f] = out[f] ?? { p: 0, fly: 0, w: 0 };
    out[f].p += reg.p;
    if (reg.pFly != null) {
      out[f].fly += reg.p * reg.pFly;
      out[f].w += reg.p;
    }
  }
  return Object.keys(FAMILIES).map((id) => ({ id, p: out[id]?.p ?? 0, pFly: out[id]?.w ? out[id].fly / out[id].w : null }));
}

function topRisk(day) {
  const entries = Object.entries(day.limiting ?? {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  return { label: LIM_LABEL[entries[0][0]] ?? entries[0][0], p: entries[0][1] };
}

function renderDays() {
  const box = $('days');
  box.replaceChildren();
  report.days.forEach((d, i) => {
    const s = d.stats;
    const risk = topRisk(d);
    const fams = familyShares(d.regimes).filter((f) => f.p >= 0.08).sort((a, b) => b.p - a.p).slice(0, 3);
    const card = h('button', { class: 'card day', type: 'button', 'aria-pressed': String(i === selectedDay), onclick: () => selectDay(i) },
      h('div', { class: 'dname' }, shortDay(d.label), d.observed != null ? h('span', { class: 'muted' }, d.observed ? ' · volée ✔' : ' · pas volée') : d.past ? h('span', { class: 'muted' }, ' · passée') : null),
      h('div', { class: 'dp' }, fmtPct(d.p), h('small', {}, ' volable')),
      h('div', { class: 'meter', title: `Normale : ${fmtPct(d.pClim)}` },
        h('i', { style: `width:${Math.round(d.p * 100)}%` }),
        h('b', { style: `left:calc(${Math.round(d.pClim * 100)}% - 1px)` })),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Vent 10-18 h'), h('dd', {}, s.window?.ws ? `${fr(s.window.ws[1])} km/h, raf. ${fr(s.window.wg[1])}` : '—'),
        h('dt', {}, 'Pluie 10-18 h'), h('dd', {}, fmtPct(s.pRainMorning)),
        h('dt', {}, 'Décollage'), h('dd', {}, s.tMin ? `${fr(s.tMin[1])} → ${fr(s.tMax[1])} °C` : '—'),
        h('dt', {}, 'Risque n°1'), h('dd', {}, risk ? `${risk.label} ${fmtPct(risk.p)}` : '—'),
        ...(report.paraglidable ? [h('dt', { title: 'Réseau de neurones entraîné sur les vols réels : chance que des pilotes volent au Puy de Dôme ce jour-là' }, 'IA Paraglidable'),
          h('dd', {}, d.paraglidable.fly != null ? `${fmtPct(d.paraglidable.fly)} (journée)` : `dès le ${fmtDay(d.paraglidable.from, { day: 'numeric', month: 'short' })}`)] : [])),
      fams.length ? h('div', { class: 'chips' }, fams.map((f) => h('span', { class: 'chip' }, h('i', { style: `background:var(${FAMILIES[f.id].color})` }), `${FAMILIES[f.id].short} ${fmtPct(f.p)}`))) : null,
      h('div', { class: 'conf' }, `${CONF_LABEL[d.confidence]} · modèles ${fmtPct(d.a)} / normale ${fmtPct(1 - d.a)}`),
    );
    box.appendChild(card);
  });
}

function selectDay(i) {
  selectedDay = i;
  renderDays();
  renderDayDetail();
  activateTab('t-jour');
  $('p-jour').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- heures volables, historique
function renderDist() {
  const r = report;
  const d = r.days[selectedDay ?? 0];
  const hr = d.hourly;
  $('dist-cap').replaceChildren(h('b', {}, 'Quelles heures sont volables ?'), ` ${cap(d.label)} : part des trajectoires où chaque créneau d'une heure respecte les limites (vent ≤ ${LIMITS.wind} km/h, rafales ≤ ${LIMITS.gust} km/h, ni pluie ni nuage au décollage).`);
  if (!hr?.hours?.length || !hr.pFly?.some((x) => x != null)) {
    $('dist').replaceChildren(h('p', { class: 'muted' }, 'Aucun ensemble ne couvre encore cette journée heure par heure.'));
    $('dist-table').replaceChildren();
    return;
  }
  hourFlyChart($('dist'), hr, r.stage.windowHours);
  $('dist-table').replaceChildren(table(['Créneau (heure de fin)', 'Volable', 'Vent médian', 'Rafales médianes'], hr.hours.map((hh, k) => [`${hh} h`, fmtPct(hr.pFly[k]), hr.ws[k] ? `${fr(hr.ws[k][1])} km/h` : '—', hr.wg[k] ? `${fr(hr.wg[k][1])} km/h` : '—']), [false, true, true, true]));
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function renderHistory() {
  const r = report;
  historyChart($('history'), history, { climScore: r.climatology.scoreClim, stageStart: `${r.stage.dates[0]}T${String(r.stage.windowHours[0] - 2).padStart(2, '0')}:00:00Z`, stageEnd: `${r.stage.dates.at(-1)}T${String(r.stage.endUtcHour).padStart(2, '0')}:00:00Z` });
  const rows = [...history].reverse().map((e) => [fmtWhen(e.t), fmtScore(e.score), fmtPct(e.p), e.pDays.map((p) => fmtPct(p)).join(' · '), (e.trigger ?? []).join(', ')]);
  $('history-table').replaceChildren(table(['Date', 'Aiguille', 'Proba', 'Dimanche 18', 'Déclencheur'], rows, [false, true, true, false, false]));
}

function table(headers, rows, numeric = []) {
  return h('table', {},
    h('thead', {}, h('tr', {}, headers.map((x, i) => h('th', { class: numeric[i] ? 'n' : null }, x)))),
    h('tbody', {}, rows.map((row) => h('tr', {}, row.map((c, i) => (c instanceof Node ? h('td', { class: numeric[i] ? 'n' : null }, c) : h('td', { class: numeric[i] ? 'n' : null }, String(c ?? '—'))))))));
}

// ---------------------------------------------------------------- onglets
function activateTab(id) {
  for (const b of document.querySelectorAll('#tabs [role=tab]')) {
    const on = b.id === id;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $(b.getAttribute('aria-controls')).hidden = !on;
  }
  // Les graphiques d'un onglet caché ont été dessinés à largeur nulle : on les redessine.
  if (report) {
    if (id === 't-modeles') renderModels();
    if (id === 't-clim') renderClimatology();
    if (id === 't-methode') renderMethod();
  }
}
function setupTabs() {
  const tabs = [...document.querySelectorAll('#tabs [role=tab]')];
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => activateTab(b.id));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      activateTab(n.id);
      n.focus();
    });
  });
}

// ---------------------------------------------------------------- jour par jour
function statCard(title, rows, note) {
  return h('div', { class: 'card' },
    h('h3', {}, title),
    h('dl', { class: 'kv', style: 'margin-top:8px' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    note ? h('p', { class: 'small muted' }, note) : null);
}

function cellClass(value, limit) {
  if (value == null) return null;
  if (value > limit) return 'bad-cell';
  if (value > limit * 0.8) return 'warn-cell';
  return null;
}

function meteogram(d) {
  const hr = d.hourly;
  if (!hr?.hours?.length || !hr.pFly?.some((x) => x != null)) return h('p', { class: 'muted' }, 'Aucun ensemble ne couvre encore cette journée heure par heure.');
  const win = (hh) => hh > report.stage.windowHours[0] && hh <= report.stage.windowHours[1];
  const head = h('tr', {}, h('th', {}, 'Heure'), hr.hours.map((hh) => h('th', { class: `h ${win(hh) ? 'win' : ''}` }, `${hh} h`)));
  const row = (label, cells, title) => h('tr', {}, h('th', { title }, label), cells);
  const rows = [
    row('Heure volable', hr.hours.map((hh, j) => {
      const p = hr.pFly[j];
      const c = heat(p);
      return h('td', { class: 'heat', style: `background:${c.bg};color:${c.fg}` }, p == null ? '—' : fr(p * 100));
    }), 'Part des trajectoires où l’heure est volable (%)'),
    row('Vent moyen', hr.hours.map((hh, j) => h('td', { class: `${cellClass(hr.ws[j]?.[1], LIMITS.wind) ?? ''} ${win(hh) ? 'win' : ''}`, title: hr.ws[j] ? `P10 ${fr(hr.ws[j][0])} · P90 ${fr(hr.ws[j][2])} km/h` : null }, fr(hr.ws[j]?.[1]))), 'Médiane, km/h, échelle AROME HD'),
    row('Rafales', hr.hours.map((hh, j) => h('td', { class: `${cellClass(hr.wg[j]?.[1], LIMITS.gust) ?? ''} ${win(hh) ? 'win' : ''}`, title: hr.wg[j] ? `P90 ${fr(hr.wg[j][2])} km/h` : null }, fr(hr.wg[j]?.[1]))), 'Médiane, km/h'),
    row('Direction', hr.hours.map((hh, j) => {
      const dir = hr.wd[j];
      return h('td', { class: win(hh) ? 'win' : null, title: dir == null ? null : `vent de ${sector(dir)} (${dir}°)` }, dir == null ? '—' : h('span', { class: 'arrow', style: `transform:rotate(${dir}deg)` }, '↓'));
    }), 'Flèche = sens vers lequel souffle le vent'),
    row('Pluie', hr.hours.map((hh, j) => h('td', { class: win(hh) ? 'win' : null }, hr.pRain[j] == null ? '—' : `${fr(hr.pRain[j] * 100)}`)), 'Probabilité de pluie ≥ 0,2 mm (%)'),
    row('Nuages', hr.hours.map((hh, j) => h('td', { class: win(hh) ? 'win' : null }, fr(hr.cc[j]?.[1]))), 'Nébulosité totale médiane (%)'),
    row('Nuages bas', hr.hours.map((hh, j) => h('td', { class: win(hh) ? 'win' : null }, fr(hr.ccl[j]?.[1]))), 'Médiane (%) — modèles qui la fournissent'),
    row('Température', hr.hours.map((hh, j) => h('td', { class: win(hh) ? 'win' : null }, fr(hr.t[j]?.[1]))), '°C au décollage (1 417 m)'),
    row('Ressenti', hr.hours.map((hh, j) => h('td', { class: win(hh) ? 'win' : null }, fr(hr.at[j]?.[1]))), '°C'),
    row('Vent 850 hPa', hr.hours.map((hh, j) => h('td', { class: `${cellClass(hr.ws850[j]?.[1], LIMITS.wind850) ?? ''} ${win(hh) ? 'win' : ''}` }, fr(hr.ws850[j]?.[1]))), 'Vers 1 500 m, km/h'),
  ];
  return h('div', { class: 'scroll-x' }, h('table', { class: 'meteogram' }, h('thead', {}, head), h('tbody', {}, rows)));
}

function detTable(d) {
  const rows = d.det.filter((m) => m.cover || m.tMax != null);
  if (!rows.length) return h('p', { class: 'muted' }, 'Aucun modèle déterministe n’atteint encore cette journée (AROME : 42 h, ICON-D2 : 48 h, ARPEGE : 4 j, ICON-EU : 5 j, ECMWF et GFS : 15-16 j).');
  return h('div', { class: 'scroll-x' }, table(
    ['Modèle', 'Run', 'Journée volable', 'T mini / maxi', 'Vent 10-18 h', 'Rafales', 'Pluie fenêtre / jour', 'Nuages bas', 'Base', 'Sommet couche humide', 'Couche limite 14 h', 'Pression', 'Z500', 'T850', 'Vent 850', 'Gradient 9 h', 'Brouillard au pied', 'Cause'],
    rows.map((m) => [
      `${m.label} (${m.res})`,
      m.run ? fmtWhen(m.run, { weekday: undefined, hour: '2-digit' }) : '—',
      m.P == null ? 'hors portée' : fmtPct(m.P),
      `${fr(m.tMin, 1)} / ${fr(m.tMax, 1)} °C`,
      m.window?.ws == null ? '—' : `${fr(m.window.ws)} km/h ${sector(m.window.wd)}`,
      m.window?.wg == null ? '—' : `${fr(m.window.wg)} km/h`,
      `${fr(m.rrMorning, 1)} / ${fr(m.rrDay, 1)} mm`,
      m.cclMorning == null ? '—' : `${fr(m.cclMorning)} %`,
      m.base10 == null ? '—' : `${fr(m.base10)} m`,
      m.moistTop == null ? '—' : `${fr(m.moistTop)} m`,
      m.blh14 == null ? '—' : `${fr(m.blh14)} m sol`,
      m.mslp == null ? '—' : `${fr(m.mslp)} hPa`,
      m.z500 == null ? '—' : `${fr(m.z500)} m`,
      m.t850 == null ? '—' : `${fr(m.t850, 1)} °C`,
      m.ws850 == null ? '—' : `${fr(m.ws850)} km/h ${sector(m.wd850)}`,
      m.lapse9 == null ? '—' : `${fr(m.lapse9, 2)} °C/100 m${m.lapse9 > 0 ? ' (inversion)' : ''}`,
      m.valleyFogHours == null ? '—' : `${m.valleyFogHours} h`,
      m.lim ? LIM_LABEL[m.lim] : m.P == null ? '—' : 'volable',
    ]),
    [false, false, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false],
  ));
}

function renderDayDetail() {
  const r = report;
  const d = r.days[selectedDay];
  const s = d.stats;
  const c = r.climatology;
  const n = c.normals.window;
  const box = $('p-jour');
  const risks = Object.entries(d.limiting ?? {}).sort((a, b) => b[1] - a[1]);
  const fams = familyShares(d.regimes).filter((f) => f.p > 0).sort((a, b) => b.p - a.p);
  box.replaceChildren(
    h('div', { class: 'chips', style: 'margin-bottom:12px' }, r.days.map((x, i) => h('button', { class: 'theme-btn', type: 'button', 'aria-pressed': String(i === selectedDay), style: i === selectedDay ? 'border-color:var(--accent);color:var(--ink)' : '', onclick: () => selectDay(i) }, shortDay(x.label)))),
    h('h3', { style: 'font-size:1.25rem' }, `${cap(d.label)} — ${fmtPct(d.p)} de chances de pouvoir voler`),
    h('p', { class: 'ink2' }, d.observed != null
      ? `Journée signalée dans l'issue d'alertes : ${d.observed ? 'volée' : 'pas volée'}. Elle compte pour ${d.observed ? '1' : '0'} dans le calcul.`
      : d.pModel == null
      ? `Aucun modèle ne couvre encore cette journée : c'est la climatologie (${fmtPct(d.pClim)}) qui parle.`
      : `Modèles ${fmtPct(d.pModel)} (poids ${fmtPct(d.a)}, échéance ${fr(d.lead, 1)} j) combinés à la normale ${fmtPct(d.pClim)}. ${d.contrib.length} système(s) : ${d.contrib.map((x) => `${x.label} ${fmtPct(x.p)}`).join(', ')}.`),
    h('div', { class: 'grid-3', style: 'margin-top:12px' },
      statCard('Températures', [
        ['Décollage mini / maxi', s.tMin ? `${qr(s.tMin, 1, ' °C')} / ${qr(s.tMax, 1, ' °C')}` : '—'],
        ['Normales ERA5 au sommet', `${fr(d.anom.normTn, 1)} / ${fr(d.anom.normTx, 1)} °C`],
        ['Écart à la normale', d.anom.tMax == null ? '—' : `${d.anom.tMin > 0 ? '+' : ''}${fr(d.anom.tMin, 1)} / ${d.anom.tMax > 0 ? '+' : ''}${fr(d.anom.tMax, 1)} °C`],
        ['Pied du Puy (900 m)', d.valley.tMin == null ? '—' : `${fr(d.valley.tMin, 1)} / ${fr(d.valley.tMax, 1)} °C`],
        ['Gradient pied → sommet', d.valley.gradient15 == null ? '—' : `${fr(d.valley.gradient15, 2)} °C/100 m l'après-midi`],
        ['Ressenti 10 h / 15 h', `${q(s.at10, 1, ' °C')} / ${q(s.at15, 1, ' °C')}`],
        ['Sous voile à 35 km/h', q(s.chill10, 1, ' °C')],
      ], `Vallée : ${d.valley.source}.`),
      statCard('Nuages et brouillard', [
        ['Nébulosité 10-18 h', q(s.ccMorning, 0, ' %')],
        ['Nuages bas 10-18 h', q(s.cclMorning, 0, ' %')],
        ['Base des nuages à 10 h', s.base10 ? `${qr(s.base10, 0, ' m')}` : '—'],
        ['Brouillard dans la plaine', fmtPct(s.fog)],
        ['Sommet dans le nuage (normale)', fmtPct(c.occurrences.capped)],
      ], 'Base = altitude du niveau de condensation calculé au décollage (125 m par degré d’écart T − Td). Le sommet est souvent coiffé d’un chapeau de nuages : décollage impossible même par beau temps en plaine.'),
      statCard('Précipitations', [
        ['Pluie pendant la fenêtre de vol', fmtPct(s.pRainMorning)],
        ['Journée ≥ 1 mm / ≥ 10 mm', `${fmtPct(s.pRain1)} / ${fmtPct(s.pRain10)}`],
        ['Cumul du jour', s.rrDay ? `${fr(s.rrDay[1], 1)} mm (P90 ${fr(s.rrDay[2], 1)})` : '—'],
        ['Part convective', s.shShare == null ? '—' : fmtPct(s.shShare)],
        ['CAPE max (médiane / P90)', s.capeMax ? `${fr(s.capeMax[1])} / ${fr(s.capeMax[2])} J/kg` : '—'],
        ['Normale : jours ≥ 1 mm', fmtPct(n.pRain1)],
      ], 'Octobre : retour de pluie atlantique ou épisode méditerranéen en flux de sud-est.'),
    ),
    h('div', { class: 'grid-2', style: 'margin-top:12px' },
      h('div', { class: 'card' },
        h('h3', {}, 'Vent par période'),
        h('div', { class: 'scroll-x' }, table(['Période', 'Vent moyen', 'Rafales (méd. / P90)', 'Direction', 'Pluie'],
          [['Matin 10-13 h', 'morning'], ['Après-midi 14-18 h', 'afternoon'], ['Soir 19-21 h', 'evening']].map(([lab, key]) => {
            const p = s[key];
            return [lab, p?.ws ? `${fr(p.ws[1])} km/h (${fr(p.ws[0])}-${fr(p.ws[2])})` : '—', p?.wg ? `${fr(p.wg[1])} / ${fr(p.wg[2])} km/h` : '—', p?.wd == null ? '—' : `${sector(p.wd)}${p.R != null && p.R < 0.5 ? ' (dispersé)' : ''}`, p?.rr ? `${fr(p.rr[1], 1)} mm (P90 ${fr(p.rr[2], 1)})` : '—'];
          }), [false, true, true, false, true])),
        h('p', { class: 'small muted' }, `Rose de la fenêtre de vol : ${Object.entries(d.rose ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmtPct(v)}`).join(' · ') || '—'}. Vent à 850 hPa (≈ altitude du sommet) : ${q(s.ws850, 0, ' km/h')} du ${sector(s.wd850)}.`),
        h('p', { class: 'small muted' }, `Limites « brevet initial » (échelle AROME HD au sommet) : vent ≤ ${LIMITS.wind} km/h, rafales ≤ ${LIMITS.gust} km/h, vent à 1 500 m ≤ ${LIMITS.wind850} km/h, ni pluie ni nuage au décollage. Aucune direction exclue : huit aires de décollage.`)),
      h('div', { class: 'card' },
        h('h3', {}, 'Ce qui peut empêcher de voler'),
        risks.length ? h('dl', { class: 'kv', style: 'margin-top:8px' }, risks.flatMap(([k, v]) => [h('dt', {}, LIM_LABEL[k] ?? k), h('dd', {}, fmtPct(v))])) : h('p', { class: 'muted' }, 'Aucune trajectoire non volable.'),
        h('p', { class: 'small muted' }, 'Part des trajectoires où la journée est non volable, par cause principale.'),
        h('h3', { style: 'margin-top:12px' }, 'Situations possibles'),
        h('div', { class: 'chips', style: 'margin-top:6px' }, fams.map((f) => h('span', { class: 'chip' }, h('i', { style: `background:var(${FAMILIES[f.id].color})` }), `${FAMILIES[f.id].label} ${fmtPct(f.p)}${f.pFly != null ? ` · vol ${fmtPct(f.pFly)}` : ''}`)))),
    ),
    h('h3', { style: 'margin:20px 0 8px' }, 'Heure par heure — ensembles combinés'),
    h('p', { class: 'small muted' }, 'Médianes pondérées de tous les ensembles qui couvrent la journée ; vent et rafales ramenés à l’échelle d’AROME HD. Colonnes teintées : la fenêtre de vol. Survole une case pour les quantiles.'),
    meteogram(d),
    h('h3', { style: 'margin:20px 0 8px' }, 'Modèles déterministes'),
    detTable(d),
  );
}

// ---------------------------------------------------------------- analyse
const STATIC_AEROLOGY = [
  ['Relief', "Le Puy de Dôme est un cône volcanique de 1 465 m, le plus haut de la chaîne des Puys, à l'ouest de la plaine de la Limagne (330 m à Clermont-Ferrand). Le décollage, au sommet vers 1 420 m, domine la plaine de plus de 1 000 m ; l'atterrissage, au pied du cône (vers 900 m), laisse environ 500 m de dénivelé."],
  ['Huit aires de décollage', "Le sommet compte huit aires, une par orientation : on décolle face au vent quelle que soit sa direction, ce qui est rare. Seule la force du vent (et les nuages) décide. Le sommet est accessible par le train Panoramique des Dômes ou à pied par le sentier des Muletiers (350 m de dénivelé) : vérifie les horaires du train, c'est lui qui rythme la journée."],
  ['Un sommet exposé', "Isolé, le cône accélère le vent : celui du sommet dépasse souvent de beaucoup celui de la plaine, et les rafales y valent facilement deux fois et demie le vent moyen dans les modèles à 1,3 km. D'où des limites strictes (vent moyen 20 km/h, rafales 25 km/h) et un vent à 850 hPa, qui correspond à l'altitude du sommet, limité à 35 km/h. Sous le vent du cône, rotors et turbulence à l'atterrissage."],
  ['Flux d\'ouest à sud-ouest (flux atlantique)', "Le régime dominant en octobre : vent établi, souvent fort au sommet, avec nuages et pluie à l'approche des perturbations. Le sommet est fréquemment coiffé d'un chapeau de nuages (nuage orographique) qui rend le décollage impossible alors qu'il fait beau en plaine."],
  ['Anticyclone et mer de nuages', "Sous anticyclone, l'air froid s'accumule dans la Limagne : brouillard ou stratus qui persistent parfois jusqu'à l'après-midi. Le décollage, au-dessus de la couche, est au soleil, mais l'atterrissage au pied du cône peut rester bouché : surveille la base de la couche et sa dissipation. C'est le scénario le plus favorable pour un débutant : vent faible, air stable le matin."],
  ['Flux de nord et bise', "Flux de nord à nord-est : air sec, bonne visibilité, vent modéré à fort et parfois turbulent sur les crêtes. L'aire du nord ou de l'est est alors utilisée tant que le vent reste sous la limite."],
  ['Flux de sud-est pluvieux', "Retour d'est ou épisode méditerranéen en octobre : nuages bas, pluie, vent de sud-est : journée perdue."],
];

function renderAnalysis() {
  const a = report.analysis;
  const sec = (title, paras) => (paras?.length ? [h('h3', {}, title), ...paras.map((p) => h('p', {}, p))] : []);
  $('p-analyse').replaceChildren(h('div', { class: 'prose' },
    h('p', { class: 'small muted' }, `Analyse rédigée automatiquement à partir des données de la dernière mise à jour (${fmtWhen(report.generatedAt)}).`),
    ...sec('Synthèse', a.summary),
    ...sec('Situation synoptique et anomalies', a.synoptic),
    ...sec('Vent', a.wind),
    ...sec('Précipitations', a.rain),
    ...sec('Nuages, plafonds et brouillard', a.clouds),
    ...sec('Températures et gradient vallée-plateau', a.temps),
    ...sec('Dispersion et écarts entre centres', a.spread),
    ...sec('Deuxième avis : l’IA Paraglidable', a.ia),
    ...sec('Ce qui fera bouger l’aiguille', a.next),
    h('h3', {}, 'Aérologie locale : Causses et vallée du Tarn'),
    ...STATIC_AEROLOGY.map(([t, p]) => h('p', {}, h('b', {}, `${t}. `), p)),
  ));
}

// ---------------------------------------------------------------- ensembles et modèles
function coverNote(s) {
  const day = (iso) => fmtWhen(iso, { hour: undefined, minute: undefined });
  const future = (iso) => iso && Date.parse(iso) > Date.now();
  if (s.cover.every(Boolean)) {
    if (!s.nextUpdate) return 'couvre la journée';
    return future(s.nextUpdate) ? `prochain run vers ${fmtWhen(s.nextUpdate, { weekday: undefined })}` : 'nouveau run attendu';
  }
  if (!s.entry) return '';
  if (!s.cover[0] && future(s.entry.first)) return `atteindra le 18 vers le ${day(s.entry.first)}`;
  return 'couverture imminente';
}

function renderModels() {
  const r = report;
  const box = $('p-modeles');
  const ens = r.systems.filter((s) => s.kind === 'ens');
  const det = r.systems.filter((s) => s.kind === 'det');
  const sysTable = (list) => h('div', { class: 'scroll-x' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Système', 'Membres', 'Dernier run utile', ...r.days.map((d) => shortDay(d.label)), 'Journée volable (seul)', 'Poids', 'Suite'].map((x, i) => h('th', { class: i >= 3 && i < 7 ? 'n' : null }, x)))),
    h('tbody', {}, list.map((s) => h('tr', {},
      h('td', {}, h('b', {}, s.label), h('br'), h('span', { class: 'small muted' }, `${s.provider} · ${s.res} · ${s.horizon}`)),
      h('td', { class: 'n' }, String(s.members ?? 1)),
      h('td', {}, s.run?.init ? fmtWhen(s.run.init, { weekday: undefined }) : '—'),
      ...s.pDays.map((p, i) => {
        if (!s.cover[i] || p == null) return h('td', { class: 'heat muted' }, '·');
        const c = heat(p);
        return h('td', { class: 'heat', style: `background:${c.bg};color:${c.fg}` }, fmtPct(p));
      }),
      h('td', { class: 'n' }, s.pStage == null ? '—' : fmtPct(s.pStage)),
      h('td', { class: 'n' }, s.weight ? fr(s.weight, 2) : '—'),
      h('td', { class: 'small' }, coverNote(s))),
    ))));
  const regimeRows = r.days.map((d) => ({ label: shortDay(d.label), parts: d.regimes.length ? familyShares(d.regimes) : [] }));
  const regBox = h('div');
  const clusters = r.scenarios.map((sc, i) => h('div', { class: 'card cluster' },
    h('div', { class: 'small muted' }, `Trajectoire ${'ABCD'[i]}`),
    h('div', { class: 'cw' }, fmtPct(sc.p), h('span', { class: 'small muted', style: 'font-weight:400' }, ' des membres')),
    h('div', { class: 'cells4' }, sc.days.map((x, j) => {
      const c = heat(x.p);
      return h('div', { style: `background:${c.bg};color:${c.fg}`, title: `${REGIMES[x.regime]?.label} · ${x.mslp} hPa · ${x.ws} km/h ${sector(x.wd)} · ${x.rr} mm` }, h('b', {}, shortDay(r.days[j].label).split(' ')[0].slice(0, 3)), h('br'), fmtPct(x.p));
    })),
    h('div', { class: 'small' }, sc.days.map((x) => REGIMES[x.regime]?.label ?? x.regime).join(' → ')),
    h('div', { class: 'small ink2' }, `journée volable : ${fmtPct(sc.pStage)} · ${Object.entries(sc.systems).map(([k, v]) => `${r.systems.find((s) => s.id === k)?.short ?? k} ${fmtPct(v)}`).join(', ')}`),
  ));
  box.replaceChildren(
    h('p', { class: 'ink2' }, `${ens.filter((s) => s.cover.some(Boolean)).length} ensembles et ${det.filter((s) => s.cover.some(Boolean)).length} modèles déterministes couvrent la journée. Chaque case donne la probabilité de journée volable selon ce système seul, avant mélange avec la climatologie.`),
    h('h3', { style: 'margin:14px 0 8px' }, 'Ensembles'),
    sysTable(ens),
    h('h3', { style: 'margin:18px 0 8px' }, 'Modèles déterministes'),
    sysTable(det),
    ...paraglidableBlock(),
    h('div', { class: 'card chart', style: 'margin-top:18px' },
      h('figure', {},
        h('figcaption', {}, h('b', {}, 'Régimes météo par journée'), ' — part pondérée des trajectoires de tous les systèmes.'),
        regBox,
        h('div', { class: 'legend' }, Object.values(FAMILIES).map((f) => h('span', {}, h('i', { style: `background:var(${f.color})` }), f.label))),
        h('details', { class: 'table-view' }, h('summary', {}, 'Voir en tableau'), table(['Journée', ...Object.values(FAMILIES).map((f) => f.label)], regimeRows.map((row) => [row.label, ...Object.keys(FAMILIES).map((id) => fmtPct(row.parts.find((p) => p.id === id)?.p ?? null))]))))),
    h('h3', { style: 'margin:18px 0 6px' }, 'Trajectoires (regroupement des membres)'),
    h('p', { class: 'small muted' }, 'Membres des ensembles couvrant la journée, regroupés par k-moyennes sur la pression, le vent et la pluie. Couleur des cases = probabilité de journée volable.'),
    r.scenarios.length ? h('div', { class: 'grid-2' }, clusters) : h('p', { class: 'muted' }, 'Pas encore assez d’ensembles couvrant la journée.'),
  );
  regimeBars(regBox, regimeRows, FAMILIES);
}

/** Deuxième avis : Paraglidable, réseau de neurones entraîné sur les vols déclarés par les pilotes. */
function paraglidableBlock() {
  const r = report;
  const pg = r.paraglidable;
  const title = h('h3', { style: 'margin:18px 0 6px' }, 'Deuxième avis : Paraglidable (IA de volabilité)');
  const intro = h('p', { class: 'small muted' },
    'Paraglidable ne prévoit pas la météo : un réseau de neurones lit le modèle GFS et donne directement la probabilité que des pilotes volent ce jour-là, appris sur des centaines de milliers de vols réellement déclarés. ',
    'Sa cible est plus large que la nôtre (journée entière, pilotes de tous niveaux, maille de 25 km) et il repose sur un seul run de GFS : son avis est rapproché de la normale ',
    `(facteur ${fr(PG.shrink, 1)} en logit) puis pèse ${fr(PG.weight, 1)} dans le mélange, autant qu'un bon modèle déterministe.`);
  if (!pg) return [title, intro, h('p', { class: 'muted' }, 'Désactivé : aucune clé d’API Paraglidable avec un point au Puy de Dôme n’est configurée (secret PARAGLIDABLE_KEY).')];
  const dates = Object.keys(pg.series ?? {}).sort();
  const strip = h('div', { class: 'pg-strip' }, dates.map((date) => {
    const v = pg.series[date];
    const c = heat(v.fly);
    const inStage = r.stage.dates.includes(date);
    return h('div', { class: inStage ? 'stage' : null, style: `background:${c.bg};color:${c.fg}`, title: `${fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long' })} · vol ${fmtPct(v.fly)} · cross ${fmtPct(v.XC)}` },
      h('b', {}, fmtDay(date, { weekday: 'short' }).replace('.', '')), h('br'), fmtDay(date, { day: 'numeric' }), h('br'), fmtPct(v.fly));
  }));
  const rows = r.days.map((d) => {
    const g = d.paraglidable;
    return [shortDay(d.label), g.fly == null ? `dès le ${fmtDay(g.from, { day: 'numeric', month: 'short' })}` : fmtPct(g.fly), fmtPct(g.XC), fmtPct(g.p), fmtPct(g.pMeteo), fmtPct(d.p)];
  });
  const hist = r.days.flatMap((d) => d.paraglidable.history.map(([t, v]) => ({ t, v, day: shortDay(d.label) })))
    .sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  return [
    title,
    intro,
    h('div', { class: 'card', style: 'padding:12px' },
      h('div', { class: 'small muted', style: 'margin-bottom:6px' }, `Puy de Dôme, ${dates.length} prochains jours · encadré : le 18 · avis modifié ${fmtWhen(pg.changedAt)}, vérifié ${fmtWhen(pg.fetchedAt)}`),
      h('div', { class: 'scroll-x' }, strip)),
    h('div', { class: 'scroll-x', style: 'margin-top:10px' },
      table(['Jour', 'IA, journée', 'Cross', 'IA → brevet initial', 'Modèles météo', 'Mélange final'], rows, [false, true, true, true, true, true])),
    hist.length ? h('details', { class: 'table-view' }, h('summary', {}, `Évolution de son avis (${hist.length})`),
      table(['Publié', 'Journée', 'Vol'], hist.map((e) => [fmtWhen(e.t), e.day, fmtPct(e.v)]), [false, false, true])) : null,
  ];
}

// ---------------------------------------------------------------- climatologie
function renderClimatology() {
  const c = report.climatology;
  const box = $('p-clim');
  const norm = (x) => [x.days === 'octobre' ? `Octobre ${x.period}` : `${x.days} ${x.period}`, `${fr(x.tx.mean, 1)} °C (σ ${fr(x.tx.sd, 1)})`, `${fr(x.tn.mean, 1)} °C (σ ${fr(x.tn.sd, 1)})`, `${fr(x.tx.p10, 1)} / ${fr(x.tx.p90, 1)}`, fmtPct(x.pRain1), fmtPct(x.pRain10), `${fr(x.ffm)} km/h`, `${fr(x.fxi)} km/h`, fmtPct(x.pGust58)];
  const roseBox = h('div');
  const cols = c.stripDays.length;
  const strip = h('div', { class: 'strip', role: 'table', 'aria-label': `Journées du ${c.stripDays[0]} au ${c.stripDays.at(-1)} octobre, ${c.period}`, style: `grid-template-columns:44px repeat(${cols}, 1fr);max-width:${44 + cols * 44}px` },
    h('div', { class: 'y' }), ...c.stripDays.map((d) => h('div', { class: d === 18 ? '' : 'muted', style: d === 18 ? 'font-weight:700' : null }, String(d))),
    ...[...c.strip].reverse().flatMap((row) => [
      h('div', { class: 'y' }, String(row.year)),
      ...row.days.map((x) => (x == null ? h('div', { class: 'na' }, '?') : h('div', { class: x.ok ? 'ok' : 'ko', title: x.ok ? 'volable' : `non volable : ${LIM_LABEL[x.lim] ?? x.lim}` }, x.ok ? '✔' : LIM_SHORT[x.lim] ?? '✘'))),
    ]));
  const col18 = c.stripDays.indexOf(18);
  const yearsOk = c.strip.filter((r) => r.days[col18]?.ok).length;
  box.replaceChildren(
    h('p', { class: 'ink2' }, `Il n'y a pas de station Météo-France au sommet du Puy de Dôme dans les données ouvertes. La référence est donc la réanalyse ERA5 au point du décollage (1 417 m), évaluée avec exactement les mêmes critères et le même moteur que les prévisions, après recalage du vent sur AROME HD. Journée volable = au moins 2 h d'affilée volables entre ${report.stage.windowHours[0]} h et ${report.stage.windowHours[1]} h. Sur ${c.period}, ${c.window} : ${fmtPct(c.pMorning)} des journées sont volables pour un pilote brevet initial. Le temps persiste : après une journée volable, la suivante l'est à ${fmtPct(c.pFlyAfterFly)}, contre ${fmtPct(c.pFlyAfterNoFly)} après une journée perdue.`),
    h('div', { class: 'grid-2', style: 'margin-top:12px' },
      h('div', { class: 'card' },
        h('h3', {}, `Les ${c.stripDays[0]}-${c.stripDays.at(-1)} octobre de ${c.strip[0].year} à ${c.strip.at(-1).year}`),
        h('p', { class: 'small muted' }, `Le 18 octobre aurait été volable ${yearsOk} années sur ${c.strip.length}. Case bleue = journée volable ; sinon, la cause principale.`),
        strip),
      h('div', { class: 'card chart' },
        h('figure', {},
          h('figcaption', {}, h('b', {}, 'Rose des vents de la fenêtre de vol'), ` (${report.stage.windowHours[0]}-${report.stage.windowHours[1]} h, ${c.window}, ${c.period}) : longueur = fréquence du secteur, partie foncée = heures volables.`),
          roseBox,
          h('details', { class: 'table-view' }, h('summary', {}, 'Voir en tableau'), table(['Secteur', 'Fréquence', 'Vent moyen', 'Volables'], c.windRose.sectors.map((s) => [s.sector, fmtPct(s.freq), `${fr(s.ws)} km/h`, fmtPct(s.fly)]), [false, true, true, true]))))),
    h('h3', { style: 'margin:18px 0 8px' }, 'Normales au sommet (ERA5, données quotidiennes)'),
    h('div', { class: 'scroll-x' }, table(['Période', 'T maxi', 'T mini', 'T maxi P10 / P90', 'Jours ≥ 1 mm', 'Jours ≥ 10 mm', 'Vent moyen', 'Rafale max moy.', 'Rafales ≥ 58 km/h'], [norm(c.normals.october), norm(c.normals.window), norm(c.normals.windowRecent)], [false, true, true, true, true, true, true, true, true])),
    h('p', { class: 'small muted' }, `Octobre ${c.normals.october.period} : ${fr(c.normals.october.rrMonth, 1)} mm en moyenne. Records du ${c.stripDays[0]} au ${c.stripDays.at(-1)} octobre depuis ${c.normals.records.since} : ${fr(c.normals.records.txMax.value, 1)} °C (${c.normals.records.txMax.date}), ${fr(c.normals.records.tnMin.value, 1)} °C (${c.normals.records.tnMin.date}), ${fr(c.normals.records.rrMax.value, 1)} mm en 24 h (${c.normals.records.rrMax.date}), rafale ${fr(c.normals.records.fxiMax.value)} km/h (${c.normals.records.fxiMax.date}). Valeurs de réanalyse à 30 km de maille : les extrêmes sont sous-estimés.`),
    h('div', { class: 'grid-3', style: 'margin-top:12px' },
      statCard('Sommet ou pied du Puy', [
        ['Pied du Puy', 'atterrissage vers 900 m'],
        ['Maxi pied − sommet', `+${fr(c.valley.dTx, 1)} °C`],
        ['Mini pied − sommet', `+${fr(c.valley.dTn, 1)} °C`],
      ], 'Estimation par le gradient standard (−0,65 °C/100 m), sans station pour la vérifier ; le matin, une inversion peut annuler l’écart.'),
      statCard('Nuages', [
        ['Sommet dans le nuage (fenêtre de vol)', fmtPct(c.occurrences.capped)],
        ['Journée sans 2 h consécutives', fmtPct(1 - c.pMorning)],
      ], `ERA5, ${c.occurrences.period}. Le critère de nuage sur le sommet est une estimation (humidité ≥ 80 % avec nuages bas couvrants) : le chapeau réel est probablement plus fréquent.`),
      statCard('Références d’altitude', [
        ['Pression mer (ERA5)', `${fr(c.era5.mslp.mean, 1)} hPa (σ ${fr(c.era5.mslp.sd, 1)})`],
        ['Géopotentiel 500 hPa', `${fr(c.upper.z500.mean)} m (σ ${fr(c.upper.z500.sd)})`],
        ['T 850 hPa', `${fr(c.upper.t850.mean, 1)} °C (σ ${fr(c.upper.t850.sd, 1)})`],
      ], `Pression : ${c.era5.window} ${c.era5.period}. Altitude : ${c.upper.ref}.`),
    ),
  );
  windRose(roseBox, c.windRose.sectors, c.windRose.calm);
}

// ---------------------------------------------------------------- méthode et sources
function renderMethod() {
  const c = report.climatology;
  const cal = c.calibration;
  const bias = c.bias ?? BIAS;
  const weights = [...ENSEMBLES, ...DETERMINISTIC, ...EXPERTS].map((s) => [s.label, s.provider, s.res, s.horizon, fr(s.weight, 1) + (s.weightWhenCovered ? ` (${fr(s.weightWhenCovered, 1)} quand l'ENS couvre)` : '')]);
  const aRows = [1, 3, 5, 7, 9, 10, 11, 13, 15, 17].map((L) => [`${L} j`, fmtPct(1 / (1 + Math.exp((L - LEAD.l50) / LEAD.scale)))]);
  const link = (href, text) => h('a', { href, rel: 'noopener' }, text);
  $('p-methode').replaceChildren(h('div', { class: 'prose' },
    h('h3', {}, '1. Qu’est-ce qu’une journée volable ?'),
    h('p', {}, `Un pilote titulaire du brevet initial (niveau vert) vole seul sur un site facile, avec des limites prudentes. Le décollage du sommet est évalué entre ${report.stage.windowHours[0]} h et ${report.stage.windowHours[1]} h, heure locale. La journée compte si au moins 2 heures d'affilée (montée en train, préparation, vol, retour) sont volables. Une heure est volable si : pluie < ${fr(LIMITS.rain, 1)} mm, vent moyen ≤ ${LIMITS.wind} km/h, rafales ≤ ${LIMITS.gust} km/h, vent à 850 hPa (≈ 1 500 m, l'altitude du sommet) ≤ ${LIMITS.wind850} km/h, ni nuage ni brouillard au décollage, pas d'orage. Aucune direction du vent n'est exclue : le sommet a huit aires de décollage. Ces seuils reprennent le profil « débutant » de Déco Radar ; ils sont à valider avec un moniteur, et c'est ton jugement sur place qui prime.`),
    h('p', {}, `Le site : ${SITES[0].name}, ${SITES[0].alt} m, ${SITES[0].note}.`),
    h('h3', {}, '2. Des vents de modèles aux vents du sommet'),
    h('p', {}, `Un modèle de 25 km voit le Puy de Dôme comme une colline de la plaine et sous-estime le vent du sommet. Il n'y a pas d'anémomètre ouvert au sommet : les vents des modèles grossiers sont donc recalés sur AROME HD (1,3 km), qui résout le cône. Rapport des quantiles 0,75-0,95 de ERA5 (30 km) à AROME HD sur ${bias.n ?? '972'} heures d'octobre-novembre 2023-2025 : vent ×${fr(BIAS.coarse.wind, 2)}, rafales ×${fr(BIAS.coarse.gust, 2)} ; ICON-EU (7 km) : vent ×${fr(BIAS.medium.wind, 2)}, rafales ×${fr(BIAS.medium.gust, 2)} ; les modèles fins (≤ 2,5 km) ne sont pas corrigés. Sans rafale fournie (AIFS, WeatherNext, AI-GEFS), elle est estimée à ${fr(c.gustFromWind.a, 1)} + ${fr(c.gustFromWind.b, 2)} × vent (régression d'AROME HD au point du décollage). Au sommet, ses rafales valent environ 2,5 fois le vent moyen ; c'est pourquoi la limite de rafales (${LIMITS.gust} km/h) pèse plus que celle du vent moyen, et pourquoi l'écart rafales − vent n'est pas utilisé en plus.`),
    h('p', { class: 'small muted' }, 'Limite connue : AROME HD n’est lui-même pas validé contre un anémomètre au sommet. Tout le décalage de niveau entre « vent du modèle » et « vent ressenti au décollage » est dans ce recalage.'),
    h('h3', {}, '3. Pas de calibration locale'),
    h('p', {}, `Chaque trajectoire reçoit une « marge de vol » (0 = à la limite). Une courbe logistique la transforme en probabilité que la journée soit réellement volable : α = ${fr(cal.alpha, 3)}, β = ${fr(cal.beta, 3)}. Faute d'observations au sommet, ces deux coefficients sont ceux appris sur 33 ans à la station de Millau (${cal.period}) : ils décrivent l'incertitude d'une prévision de 25 km par rapport à ce qu'on vole réellement, qui n'est pas la même ici. La probabilité affichée est donc plausible mais non calibrée localement.`),
    h('h3', {}, '4. Mélange avec la climatologie selon l’échéance'),
    h('p', {}, `Au-delà d'une dizaine de jours, les modèles n'ont presque plus de compétence pour un jour donné. Probabilité = a(L) × modèles + (1 − a(L)) × normale, avec a(L) = 1 / (1 + e^((L − ${LEAD.l50}) / ${LEAD.scale})), L = échéance du run le plus récent.`),
    table(['Échéance', 'Poids des modèles'], aRows, [false, true]),
    h('h3', {}, '5. Pondération des systèmes'),
    h('div', { class: 'scroll-x' }, table(['Système', 'Centre', 'Résolution', 'Portée', 'Poids'], weights, [false, false, false, false, true])),
    h('p', { class: 'small muted' }, 'Poids réduit de 15 % sans rafales fournies et de 10 % sans humidité. Un système ne pèse que les jours où il couvre toute la fenêtre de vol.'),
    h('h3', {}, '5 bis. Un avis d’une autre nature : Paraglidable'),
    h('p', {}, `Tous les systèmes ci-dessus donnent de la météo que ce site traduit en journée volable avec ses propres seuils. Paraglidable fait l'inverse : son réseau de neurones a appris, sur les vols déclarés par les pilotes, quelles situations GFS font voler. Ses erreurs ne sont pas les mêmes que les nôtres. Sa probabilité p, rapprochée de la normale c : logit(p') = logit(c) + ${fr(PG.shrink, 1)} × (logit(p) − logit(c)), entre dans le mélange avec un poids de ${fr(PG.weight, 1)}. Il n'est actif que si une clé d'API dont un point est au Puy de Dôme est configurée.`),
    h('h3', {}, '6. Des heures à la journée'),
    h('p', {}, `${report.samples.toLocaleString('fr-FR')} trajectoires sont tirées : un système (au prorata de son poids), un de ses membres, et une journée réellement observée dans la réanalyse (11-25 octobre, 1993-2025). Un seul tirage décide si l'on suit le modèle ou la climatologie. L'aiguille vaut 360 × P − 180, où P est la part des trajectoires dont la journée est volable.`),
    h('h3', {}, '7. Mises à jour et alertes'),
    h('p', {}, `Toutes les 20 minutes, GitHub Actions lit l'heure du dernier run de chaque modèle sur Open-Meteo. Dès qu'un nouveau run atteint le 18 octobre, le système est retéléchargé, tout est recombiné, l'aiguille bouge et un point s'ajoute à l'historique. Si l'aiguille a bougé d'au moins ${report.stage.alertThreshold} points depuis la dernière alerte, un commentaire est posté sur l'issue d'alertes du dépôt (notification GitHub). Après le vol, écris « volé » ou « pas volé » dans cette issue : l'aiguille donne alors le verdict. Cette page revérifie toute seule toutes les 5 minutes.`),
    h('h3', {}, 'Sources'),
    h('ul', {},
      h('li', {}, link('https://open-meteo.com/en/docs/ensemble-api', 'Open-Meteo Ensemble API'), ' : ECMWF IFS ENS et AIFS ENS, ECMWF EC46, NOAA GEFS et AI-GEFS, ECCC GEPS, DWD ICON-EPS, UKMO MOGREPS-G, MeteoSwiss ICON-CH1/CH2-EPS, Google WeatherNext 2.'),
      h('li', {}, link(PG.site, 'Paraglidable'), ' (API gratuite, ', link(PG.repo, 'code source GPL-3'), ') : réseau de neurones d’Antoine Meler entraîné sur les vols déclarés.'),
      h('li', {}, link('https://open-meteo.com/en/docs', 'Open-Meteo Forecast API'), ' : AROME HD et AROME, ARPEGE (Météo-France), ICON-D2 et ICON-EU (DWD), ECMWF IFS HRES et AIFS, GFS, GEM, UKMO, JMA.'),
      h('li', {}, link('https://open-meteo.com/en/docs/historical-weather-api', 'ERA5 (Copernicus / ECMWF)'), ' via Open-Meteo : climatologie du jour ; ', link('https://open-meteo.com/en/docs/historical-forecast-api', 'historique des prévisions'), ' (AROME HD, ICON-EU, analyses GFS) pour le recalage du vent.'),
      h('li', {}, link('https://www.paraglidingearth.com/?site=2896', 'ParaglidingEarth : Puy de Dôme'), ' (altitude, orientations, aire d’atterrissage ; base collaborative sans garantie d’exactitude).'),
      h('li', {}, link('https://www.panoramiquedesdomes.fr/', 'Panoramique des Dômes'), ' : horaires du train du sommet.'),
    ),
    h('h3', {}, 'Pour vérifier d’un coup d’œil'),
    h('ul', {},
      h('li', {}, link('https://www.balisemeteo.com/', 'Balises FFVL'), ' (cherche « Puy de Dôme ») · ', link('https://meteofrance.com/previsions-meteo-france/orcines/63870', 'Météo-France Orcines'), '.'),
      h('li', {}, link('https://www.windy.com/45.773/2.963?45.773,2.963,11', 'Windy'), ' · ', link('https://www.ventusky.com/?p=45.77;2.96;9&l=wind-10m', 'Ventusky'), ' · ', link('https://www.meteoblue.com/fr/meteo/semaine/puy-de-d%C3%B4me_france_2985244', 'Meteoblue'), '.'),
      h('li', {}, 'ECMWF : ', link('https://charts.ecmwf.int/products/medium-z500-t850', 'Z500 et T850'), ' · ', link('https://charts.ecmwf.int/products/medium-t500-mean-spread', 'moyenne et dispersion de l’ENS'), '.'),
    ),
    h('p', { class: 'small muted' }, 'Code, données et historique de chaque mise à jour : ', link(REPO_URL, 'dépôt GitHub'), '.'),
  ));
}

// ---------------------------------------------------------------- thème, démarrage
function setupTheme() {
  const btn = $('theme');
  const current = () => document.documentElement.dataset.theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const label = () => (btn.textContent = current() === 'dark' ? 'Mode clair' : 'Mode sombre');
  label();
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
    label();
    rerender();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    label();
    rerender();
  });
}
function rerender() {
  if (!report) return;
  gauge?.repaint();
  renderDist();
  renderHistory();
  renderModels();
  renderClimatology();
  renderMethod();
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => report && (renderDist(), renderHistory(), renderModels(), renderClimatology(), renderMethod()), 200);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

setupTheme();
setupTabs();
refresh(true).then(fetchLastCheck);
setInterval(() => refresh().then(fetchLastCheck), POLL_MS);
