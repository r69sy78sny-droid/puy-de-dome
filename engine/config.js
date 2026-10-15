// Réglages centraux : la journée suivie, les points de prévision, le site du Puy de Dôme, les limites de vol
// et les systèmes de prévision interrogés. Tout choix « métier » est ici, pas dans le code.

/** Change ce numéro quand le traitement des données change : les résumés par système sont alors recalculés. */
export const ENGINE_VERSION = 1;

/**
 * L'événement suivi : un vol du dimanche 18 octobre 2026 au Puy de Dôme pour un pilote titulaire du brevet
 * initial (FFVL, niveau vert). Une seule journée ; le nom STAGE est gardé pour tout le moteur.
 */
export const STAGE = {
  title: 'Brevet initial · Puy de Dôme',
  kind: 'vol',
  dates: ['2026-10-18'],
  dayLabel: 'dimanche 18 octobre',
  sessionsNeeded: 1, // un seul jour : il suffit qu'il soit volable
  tz: 'Europe/Paris',
  // Créneaux d'une heure notés par leur heure de fin (convention Open-Meteo : cumul sur l'heure écoulée).
  // 11 … 18 = 10 h-11 h … 17 h-18 h, heure locale : la fenêtre de vol d'une journée d'octobre.
  morningSlots: [11, 12, 13, 14, 15, 16, 17, 18],
  windowHours: [10, 18],
  minConsecutiveSlots: 2, // il faut 2 h volables d'affilée (montée en train, préparation, vol, retour)
  targetUtcHour: 10, // 12 h locale (UTC+2) : milieu de la fenêtre, sert à calculer l'échéance
  endUtcHour: 16, // 18 h locale : fin de la fenêtre de vol
  fetchStart: '2026-10-17', // la veille, pour les cumuls et le brouillard du matin
  fetchEnd: '2026-10-19', // jusqu'au lendemain 0 h pour le cumul de la journée
};

export const POINTS = {
  deco: { id: 'deco', name: 'Décollage du Puy de Dôme', lat: 45.7728, lon: 2.9625, elevation: 1417 },
  atterro: { id: 'atterro', name: 'Atterrissage au pied du Puy', lat: 45.7733, lon: 2.986, elevation: 896 },
  station: { id: 'station', name: 'Clermont-Ferrand (Aulnat)', lat: 45.7868, lon: 3.1493, elevation: 331 },
};

/** Le site : huit aires de décollage au sommet, une par orientation, donc aucune direction n'est exclue. */
export const SITES = [
  { id: 'sommet', name: 'Puy de Dôme (sommet)', alt: 1417, orient: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], note: 'huit aires de décollage au sommet, une par orientation ; accès par le train Panoramique des Dômes ou le sentier des Muletiers' },
];

/**
 * Limites de vol d'un pilote titulaire du brevet initial, au décollage du sommet (valeurs prudentes du profil
 * « débutant » de Déco Radar, à faire valider par un moniteur). Les vents sont ceux d'un modèle qui voit le
 * relief : les modèles grossiers sont d'abord recalés sur AROME HD (voir BIAS).
 */
export const LIMITS = {
  wind: 20, // km/h, vent moyen
  gust: 25, // km/h, rafale
  gustSpread: null, // écart rafales − vent moyen : non utilisé, les rafales d'AROME au sommet valent ~2,5 × le vent moyen (voir la méthode)
  rain: 0.2, // mm/h
  calm: 6, // km/h : sans objet ici (aucune direction exclue)
  wind850: 35, // km/h vers 1 500 m (altitude du sommet) : au-delà, vent météo trop fort, rotors sous le vent
  cloudRh: [80, 12], // le sommet est souvent dans le nuage (chapeau) : nuage dès 80 % d'humidité si les nuages bas couvrent le ciel
  forbidden: null, // huit aires de décollage : aucune direction n'est exclue
  cape: 800, // J/kg, avec pluie : risque orageux
};

/**
 * Facteurs pour passer du vent d'un modèle à ce que voit AROME HD (1,3 km, qui résout le cône du Puy) au sommet :
 * rapport des quantiles 0,75-0,95 des heures de 9 h à 17 h, 1er octobre-5 novembre 2023-2025, au point du déco.
 * ERA5 (≈ 30 km) sert de modèle grossier, ICON-EU (7 km) de modèle moyen. Les modèles fins sont déjà à l'échelle.
 */
export const BIAS = {
  coarse: { wind: 1.05, gust: 1.13 }, // ≥ 20 km
  medium: { wind: 1.0, gust: 0.87 }, // 7-13 km
  fine: { wind: 1.0, gust: 1.0 }, // ≤ 2,5 km
};

/** Poids de la prévision face à la climatologie selon l'échéance L (jours) : a(L) = 1 / (1 + e^((L − L50)/s)). */
export const LEAD = { l50: 10, scale: 2.5 };

/** Alertes GitHub : commentaire sur l'issue quand l'aiguille a bougé d'au moins ce nombre de points. */
export const ALERT = { threshold: 30, issueTitle: "🎯 Alertes de l'aiguille (Puy de Dôme, dimanche 18 oct.)" };

const V = {
  t: 'temperature_2m',
  rh: 'relative_humidity_2m',
  rr: 'precipitation',
  sh: 'showers',
  cc: 'cloud_cover',
  ccl: 'cloud_cover_low',
  wc: 'weather_code',
  vis: 'visibility',
  ws: 'wind_speed_10m',
  wd: 'wind_direction_10m',
  wg: 'wind_gusts_10m',
  cape: 'cape',
  p: 'pressure_msl',
  t850: 'temperature_850hPa',
  ws850: 'wind_speed_850hPa',
  wd850: 'wind_direction_850hPa',
  z500: 'geopotential_height_500hPa',
};
export const VARS = V;

/**
 * Ensembles interrogés via l'API Ensemble d'Open-Meteo. `weight` = poids total du système (pas par membre),
 * `meta` = domaines Open-Meteo dont l'heure de run déclenche une mise à jour.
 */
export const ENSEMBLES = [
  {
    id: 'ecmwf_ens', horizonHours: 360, model: 'ecmwf_ifs025', meta: ['ecmwf_ifs025_ensemble'], label: 'ECMWF IFS ENS', short: 'ECMWF ENS',
    provider: 'ECMWF (Centre européen)', res: '0,25° (~25 km)', horizon: '15 j', bias: 'coarse', weight: 3.0,
    vars: ['t', 'rh', 'rr', 'sh', 'cc', 'ccl', 'wc', 'ws', 'wd', 'wg', 'cape', 'p', 't850', 'ws850', 'wd850', 'z500'],
  },
  {
    id: 'ecmwf_aifs', horizonHours: 360, model: 'ecmwf_aifs025', meta: ['ecmwf_aifs025_ensemble'], label: 'ECMWF AIFS ENS (IA)', short: 'AIFS ENS',
    provider: 'ECMWF (modèle IA)', res: '0,25°', horizon: '15 j', bias: 'coarse', weight: 2.5,
    vars: ['t', 'rh', 'rr', 'sh', 'cc', 'ccl', 'wc', 'ws', 'wd', 'p', 't850', 'ws850', 'wd850', 'z500'],
  },
  {
    id: 'ecmwf_ec46', horizonHours: 1104, model: 'ecmwf_ec46', meta: ['ecmwf_ec46'], label: 'ECMWF ENS étendu (EC46)', short: 'EC46',
    provider: 'ECMWF', res: '~36 km, pas de 6 h', horizon: '46 j', bias: 'coarse', weight: 2.5, weightWhenCovered: 0.5, coveredBy: 'ecmwf_ens',
    vars: ['t', 'rh', 'rr', 'sh', 'cc', 'wc', 'ws', 'wd', 'wg', 'p'],
  },
  {
    id: 'google_wn2', horizonHours: 360, model: 'google_weathernext2_ensemble', meta: ['google_weathernext2_ensemble'], label: 'Google WeatherNext 2 (IA)', short: 'WeatherNext 2',
    provider: 'Google DeepMind', res: '0,25°, pas de 6 h', horizon: '15 j', bias: 'coarse', weight: 1.8,
    vars: ['t', 'rr', 'sh', 'cc', 'ccl', 'wc', 'ws', 'wd', 'p', 't850', 'ws850', 'wd850', 'z500'],
  },
  {
    id: 'gefs', horizonHours: 840, model: 'gfs05', meta: ['ncep_gefs05'], label: 'NOAA GEFS', short: 'GEFS',
    provider: 'NOAA / NCEP (États-Unis)', res: '0,5° (~50 km)', horizon: '35 j', bias: 'coarse', weight: 1.8,
    vars: ['t', 'rh', 'rr', 'sh', 'cc', 'wc', 'vis', 'ws', 'wd', 'wg', 'cape', 'p', 't850', 'ws850', 'wd850', 'z500'],
  },
  {
    id: 'aigefs', horizonHours: 384, model: 'ncep_aigefs025', meta: ['ncep_aigefs025'], label: 'NOAA AI-GEFS (IA)', short: 'AI-GEFS',
    provider: 'NOAA (modèle IA)', res: '0,25°', horizon: '16 j', bias: 'coarse', weight: 1.0,
    vars: ['t', 'rr', 'sh', 'cc', 'ccl', 'wc', 'ws', 'wd', 'p', 't850', 'ws850', 'wd850', 'z500'],
  },
  {
    id: 'geps', horizonHours: 384, model: 'gem_global', meta: ['cmc_gem_geps'], label: 'ECCC GEPS', short: 'GEPS',
    provider: 'Environnement Canada', res: '~25 km', horizon: '16 j (32 j le jeudi)', bias: 'coarse', weight: 1.3,
    vars: ['t', 'rh', 'rr', 'cc', 'wc', 'ws', 'wd', 'cape', 'p', 't850', 'z500'],
  },
  {
    id: 'icon_eps', horizonHours: 180, model: 'icon_seamless', meta: ['dwd_icon_eps', 'dwd_icon_eu_eps', 'dwd_icon_d2_eps'], label: 'DWD ICON-EPS (+ EU, D2)', short: 'ICON-EPS',
    provider: 'DWD (Allemagne)', res: '26 km → 13 km → 2 km', horizon: '7,5 j', bias: 'coarse', weight: 1.8,
    vars: ['t', 'rh', 'rr', 'sh', 'cc', 'wc', 'ws', 'wd', 'wg', 'cape', 'p'],
  },
  {
    id: 'mogreps', horizonHours: 168, model: 'ukmo_global_ensemble_20km', meta: ['ukmo_global_ensemble_20km'], label: 'UKMO MOGREPS-G', short: 'MOGREPS-G',
    provider: 'Met Office (Royaume-Uni)', res: '20 km', horizon: '7 j', bias: 'coarse', weight: 1.5,
    vars: ['t', 'rh', 'rr', 'sh', 'cc', 'wc', 'vis', 'ws', 'wd', 'wg', 'cape', 'p'],
  },
  {
    id: 'icon_ch2', horizonHours: 120, model: 'meteoswiss_icon_ch2', meta: ['meteoswiss_icon_ch2_ensemble'], label: 'MeteoSwiss ICON-CH2-EPS', short: 'ICON-CH2',
    provider: 'MeteoSwiss', res: '2,1 km', horizon: '5 j', bias: 'fine', weight: 1.5,
    vars: ['t', 'rh', 'rr', 'sh', 'cc', 'ccl', 'wc', 'ws', 'wd', 'wg', 'cape', 'p'],
  },
  {
    id: 'icon_ch1', horizonHours: 33, model: 'meteoswiss_icon_ch1', meta: ['meteoswiss_icon_ch1_ensemble'], label: 'MeteoSwiss ICON-CH1-EPS', short: 'ICON-CH1',
    provider: 'MeteoSwiss', res: '1 km', horizon: '33 h', bias: 'fine', weight: 1.2,
    vars: ['t', 'rh', 'rr', 'sh', 'cc', 'ccl', 'wc', 'ws', 'wd', 'wg', 'cape', 'p'],
  },
];

/** Modèles déterministes (API Forecast d'Open-Meteo), une seule trajectoire chacun. */
export const DETERMINISTIC = [
  { id: 'arome_hd', horizonHours: 42, model: 'meteofrance_arome_france_hd', meta: 'meteofrance_arome_france_hd', label: 'AROME HD', provider: 'Météo-France', res: '1,3 km', horizon: '42 h', bias: 'fine', weight: 2.0 },
  { id: 'arome', horizonHours: 42, model: 'meteofrance_arome_france', meta: 'meteofrance_arome_france0025', label: 'AROME', provider: 'Météo-France', res: '2,5 km', horizon: '42 h', bias: 'fine', weight: 1.5 },
  { id: 'arpege', horizonHours: 102, model: 'meteofrance_arpege_europe', meta: 'meteofrance_arpege_europe', label: 'ARPEGE Europe', provider: 'Météo-France', res: '0,1° (~11 km)', horizon: '4 j', bias: 'medium', weight: 1.0 },
  { id: 'icon_d2', horizonHours: 48, model: 'icon_d2', meta: 'dwd_icon_d2', label: 'ICON-D2', provider: 'DWD', res: '2,2 km', horizon: '48 h', bias: 'fine', weight: 1.0 },
  { id: 'icon_eu', horizonHours: 120, model: 'icon_eu', meta: 'dwd_icon_eu', label: 'ICON-EU', provider: 'DWD', res: '7 km', horizon: '5 j', bias: 'medium', weight: 0.7 },
  { id: 'ifs', horizonHours: 360, model: 'ecmwf_ifs', meta: 'ecmwf_ifs', label: 'ECMWF IFS HRES', provider: 'ECMWF', res: '9 km', horizon: '15 j', bias: 'medium', weight: 0.8 },
  { id: 'aifs', horizonHours: 360, model: 'ecmwf_aifs025_single', meta: 'ecmwf_aifs025_single', label: 'ECMWF AIFS', provider: 'ECMWF (IA)', res: '0,25°', horizon: '15 j', bias: 'coarse', weight: 0.4 },
  { id: 'gfs', horizonHours: 384, model: 'gfs_seamless', meta: 'ncep_gfs013', label: 'NOAA GFS', provider: 'NOAA', res: '0,11-0,25°', horizon: '16 j', bias: 'coarse', weight: 0.4 },
  { id: 'gem', horizonHours: 240, model: 'gem_seamless', meta: null, label: 'ECCC GEM', provider: 'Environnement Canada', res: '15-25 km', horizon: '10 j', bias: 'coarse', weight: 0.3 },
  { id: 'ukmo', horizonHours: 168, model: 'ukmo_seamless', meta: 'ukmo_global_deterministic_10km', label: 'UKMO Global', provider: 'Met Office', res: '10 km', horizon: '7 j', bias: 'medium', weight: 0.4 },
  { id: 'jma', horizonHours: 264, model: 'jma_seamless', meta: 'jma_gsm', label: 'JMA GSM', provider: 'JMA (Japon)', res: '~20-55 km', horizon: '11 j', bias: 'coarse', weight: 0.2 },
];

/**
 * Avis « IA » qui ne donnent pas de météo mais directement une probabilité de vol par journée.
 * Paraglidable (Antoine Meler, GPL-3) : réseau de neurones nourri par GFS 0,25°, entraîné sur les vols
 * réellement déclarés par les pilotes. Sa cible n'est pas la nôtre (journée entière, pilotes de tous
 * niveaux, maille de 25 km) et un seul run de GFS donne des avis trop tranchés à 7-9 jours : sa
 * probabilité est rapprochée de la normale en logit (facteur `shrink`) avant d'entrer dans le mélange.
 * La clé d'API est un secret GitHub (PARAGLIDABLE_KEY), jamais écrite dans le dépôt ; elle doit comporter un point
 * à moins de 5 km du décollage (sinon l'avis est ignoré).
 */
export const EXPERTS = [
  {
    id: 'paraglidable', label: 'Paraglidable (IA de volabilité)', short: 'Paraglidable',
    provider: 'Antoine Meler · réseau de neurones entraîné sur les vols déclarés', res: 'GFS 0,25°, journée entière', horizon: '10 j',
    weight: 1.5, shrink: 0.6, horizonDays: 9, minFetchMinutes: 55,
    url: 'https://api.paraglidable.com/', site: 'https://paraglidable.com/', repo: 'https://github.com/AntoineMeler/Paraglidable',
  },
];

export const DET_VARS = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'precipitation', 'showers', 'cloud_cover', 'cloud_cover_low',
  'cloud_cover_mid', 'cloud_cover_high', 'weather_code', 'visibility', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  'cape', 'pressure_msl', 'boundary_layer_height', 'temperature_925hPa', 'temperature_850hPa', 'temperature_700hPa',
  'relative_humidity_925hPa', 'relative_humidity_850hPa', 'relative_humidity_700hPa', 'geopotential_height_925hPa',
  'geopotential_height_850hPa', 'geopotential_height_700hPa', 'geopotential_height_500hPa', 'wind_speed_850hPa',
  'wind_direction_850hPa', 'wind_speed_925hPa', 'wind_direction_925hPa',
];
export const DET_VARS_VALLEY = ['temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'wind_speed_10m', 'visibility', 'cloud_cover_low', 'weather_code'];

export const API = {
  ensemble: 'https://ensemble-api.open-meteo.com/v1/ensemble',
  forecast: 'https://api.open-meteo.com/v1/forecast',
  meta: (host, domain) => `https://${host}/data/${domain}/static/meta.json`,
};

/** Régimes météo (classement de chaque membre, chaque jour). */
export const REGIMES = {
  cevenol: { label: 'Flux de sud-est pluvieux (épisode méditerranéen, retour d’est)', color: '#7b3fa0', fly: 'non volable : pluie, plafond bas' },
  perturbe: { label: 'Passage perturbé (pluie)', color: '#3f6fb5', fly: 'rarement volable' },
  instable: { label: 'Instable, averses', color: '#4f9fb0', fly: 'créneaux possibles entre les averses' },
  sud: { label: 'Flux de sud-est (vent du Midi)', color: '#d0873a', fly: 'aire de sud-est, si le vent reste modéré' },
  nord: { label: 'Flux de nord à nord-ouest', color: '#5d7f99', fly: 'aire de nord, vent souvent soutenu en altitude' },
  ouest: { label: "Flux d'ouest à sud-ouest (flux atlantique)", color: '#6c9a5b', fly: 'aire d’ouest : le vent dominant, souvent fort au sommet' },
  est: { label: "Vent d'est à nord-est (bise)", color: '#a05a5a', fly: 'aire d’est, air sec, vent modéré' },
  anticyclone: { label: 'Anticyclonique, vent faible', color: '#e0b640', fly: 'volable ; brouillard possible au fond de la vallée' },
  marais: { label: 'Marais barométrique', color: '#9c9c7a', fly: 'souvent volable, vigilance nuages bas' },
};
