// Animation de fin de journée : chaîne des Puys, parapentes qui planent, confettis si le vol
// a eu lieu. Rien ne bouge si l'utilisateur a demandé moins d'animations.

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const COLORS = ['#eb6834', '#eda100', '#1baf7a', '#2a78d6', '#e87ba4', '#c62f22'];
const WINGS = [
  // [hauteur, échelle, durée (s), retard (s), couleur]
  [70, 1.25, 26, -4, 0],
  [118, 0.8, 34, -17, 2],
  [48, 0.62, 40, -29, 3],
  [140, 1.0, 30, -9, 1],
  [92, 0.7, 38, -22, 4],
];

/** Parapente vu de face : voile en arc, suspentes, pilote. Origine au pilote. */
function wing(parent, color) {
  const g = el('g', {}, parent);
  el('path', { d: 'M-26 -34 Q0 -50 26 -34 Q0 -41 -26 -34 Z', fill: color, stroke: 'rgba(0,0,0,.35)', 'stroke-width': 1, 'stroke-linejoin': 'round' }, g);
  el('path', { d: 'M-24 -35 L0 -4 M-8 -42 L0 -4 M8 -42 L0 -4 M24 -35 L0 -4', stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.7, fill: 'none' }, g);
  el('rect', { x: -2.4, y: -5, width: 4.8, height: 8, rx: 2, fill: '#2b2518' }, g);
  return g;
}

function scene(container) {
  const svg = el('svg', { viewBox: '0 0 800 220', preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': 'Des parapentes planent devant le Puy de Dôme au coucher du soleil.', class: 'finale-scene' });
  const defs = el('defs', {}, svg);
  const sky = el('linearGradient', { id: 'fin-sky', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0', 'stop-color': '#7fb0ea' }, sky);
  el('stop', { offset: '0.62', 'stop-color': '#f7d9a8' }, sky);
  el('stop', { offset: '1', 'stop-color': '#f3a46a' }, sky);
  el('rect', { width: 800, height: 220, fill: 'url(#fin-sky)' }, svg);
  const sun = el('g', { class: 'fin-sun' }, svg);
  el('circle', { cx: 590, cy: 150, r: 46, fill: 'rgba(255,240,200,.35)' }, sun);
  el('circle', { cx: 590, cy: 150, r: 26, fill: '#fff4cf' }, sun);
  const clouds = el('g', { fill: 'rgba(255,255,255,.7)', class: 'fin-clouds' }, svg);
  for (const [x, y, w] of [[90, 38, 70], [380, 24, 90], [660, 52, 60]]) el('ellipse', { cx: x, cy: y, rx: w, ry: 9 }, clouds);
  const flock = el('g', {}, svg);
  WINGS.forEach(([y, s, dur, delay, ci], i) => {
    const outer = el('g', { transform: `translate(0 ${y}) scale(${s})` }, flock);
    const fly = el('g', { class: 'fin-fly', style: `--dur:${dur}s;--delay:${delay}s` }, outer);
    const bob = el('g', { class: 'fin-bob', style: `--bob:${3.5 + i * 0.7}s` }, fly);
    wing(bob, COLORS[ci]);
  });
  // Chaîne des Puys : au fond les cônes voisins, devant le Puy de Dôme et son antenne.
  el('path', { d: 'M0 176 L60 160 C90 150 110 156 140 168 C175 150 215 148 250 164 C300 176 340 160 380 170 L430 178 C480 184 520 176 560 178 L620 168 C690 160 740 168 800 172 V220 H0 Z', fill: '#6b7358', opacity: 0.6 }, svg);
  el('path', { d: 'M180 220 C230 200 285 150 322 96 L330 90 L333 70 L336 90 L344 96 C384 150 440 200 500 220 Z', fill: '#4a5a3a' }, svg);
  el('path', { d: 'M0 204 C80 198 150 200 230 196 C330 192 420 204 520 200 C620 196 700 198 800 202 V220 H0 Z', fill: '#34402c' }, svg);
  container.replaceChildren(svg);
  return svg;
}

/** Confettis plein écran, une seule salve. */
export function confetti({ count = 140, ms = 4200 } = {}) {
  if (reducedMotion()) return;
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 60 });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const bits = Array.from({ length: count }, (_, i) => {
    const left = i % 2 === 0;
    const a = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
    const v = 9 + Math.random() * 9;
    return {
      x: left ? 0 : innerWidth, y: innerHeight * 0.85, vx: Math.cos(a) * v * (left ? 1 : 1), vy: Math.sin(a) * v,
      w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  });
  const t0 = performance.now();
  const tick = (now) => {
    const t = now - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += 0.22;
      b.vx *= 0.992;
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, (ms - t) / 900));
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (t < ms) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}

/**
 * Remplit la carte de fin de stage. `days` : [{ label, observed (true/false/null), p }] ;
 * `outcome` : résultat de stageOutcome ; `issueUrl` : où signaler les matinées ; `onReplay` : bouton « revoir ».
 */
export function renderFinale(box, { days, outcome, issueUrl, onReplay }) {
  const h = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v);
    n.append(...kids.filter((x) => x != null));
    return n;
  };
  const { kind } = outcome;
  const texts = {
    reussi: ['Tu as volé au Puy de Dôme', 'Bravo : le brevet initial sert à ça. Merci d’avoir suivi l’aiguille.'],
    rate: ['Pas de vol cette fois', 'La météo n’a pas suivi. Le sommet sera toujours là : guette la prochaine fenêtre calme.'],
    attente: ['La journée est passée', 'Dis-moi comment ça s’est passé : écris « volé » ou « pas volé » dans l’issue GitHub, et l’aiguille donnera le verdict.'],
  };
  const [title, sub] = texts[kind];
  const sc = h('div', { class: 'finale-sky' });
  const chips = h('div', { class: 'finale-days' }, ...days.map((d) => {
    const state = d.observed === true ? 'ok' : d.observed === false ? 'ko' : 'inc';
    const text = d.observed === true ? 'volé ✔' : d.observed === false ? 'pas volé' : `prévu ${Math.round(d.p * 100)} %`;
    return h('div', { class: `fday ${state}` }, h('b', {}, d.label), h('span', {}, text));
  }));
  const actions = h('div', { class: 'finale-actions' },
    kind === 'attente' ? Object.assign(h('a', { href: issueUrl, rel: 'noopener', class: 'btn' }, 'Signaler mon vol'), {}) : null,
    Object.assign(h('button', { type: 'button', class: 'btn ghost' }, 'Revoir l’animation'), { onclick: onReplay }));
  box.replaceChildren(sc, h('div', { class: 'finale-body' }, h('h2', {}, title), h('p', {}, sub), chips, actions));
  box.dataset.kind = kind;
  box.hidden = false;
  scene(sc);
}
