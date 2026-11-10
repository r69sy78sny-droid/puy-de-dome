// Commande tapée dans l'issue d'alertes : « volé », « pas volé » ou « oublie » (jour précisé : « volé 28 » ; sans numéro, le dernier jour commencé).
// Met à jour data/observed.json ; la combinaison fixe alors la journée (1 ou 0) au lieu de la prévoir.

import fs from 'node:fs';
import { STAGE } from '../engine/config.js';

const body = (process.env.BODY ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const file = 'data/observed.json';
const observed = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const re = /\b(pas vole|pas volee|vole|volee|oublie|annule)\b(?:\s+(?:le\s+)?(\d{1,2})\b)?/g;
let changed = [];
for (const [, verb, dayArg] of body.matchAll(re)) {
  let day = dayArg;
  // Sans numéro : le dernier jour commencé (heure de Paris), ou le premier si le stage n'a pas commencé.
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: STAGE.tz });
  const started = STAGE.dates.filter((d) => d <= today);
  const date = day ? STAGE.dates.find((d) => d.endsWith(`-${day.padStart(2, '0')}`)) : started.at(-1) ?? STAGE.dates[0];
  if (!date) continue;
  day = date.slice(8);
  if (verb.startsWith('oublie') || verb.startsWith('annule')) delete observed[date];
  else observed[date] = !verb.startsWith('pas');
  changed.push(`${day} → ${observed[date] === undefined ? 'prévision' : observed[date] ? 'volé' : 'pas volé'}`);
}
if (!changed.length) {
  console.log('Aucune commande reconnue dans le commentaire.');
  process.exit(0);
}
fs.writeFileSync(file, JSON.stringify(observed));
console.log('Journée signalée :', changed.join(', '));
if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `TRIGGER_LABEL=signalé dans l'issue : ${changed.join(', ')}\n`);
