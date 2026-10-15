# VU-mètre · premier vol au Puy de Dôme (brevet initial)

Site : https://r69sy78sny-droid.github.io/puy-de-dome/

Une aiguille de **−180** (impossible) à **+180** (tu pourras voler) répond à une seule question :
*un pilote titulaire du brevet initial pourra-t-il voler au Puy de Dôme dimanche 18 octobre 2026 ?*
Elle vaut `360 × P − 180`, où P est la probabilité d'avoir au moins 2 h volables d'affilée entre 10 h et 18 h.
Site dérivé du VU-mètre du stage Fly Millau, même moteur, autre site et autres limites.

## Comment l'aiguille est calculée

1. **Journée volable** : au moins 2 h d'affilée volables entre 10 h et 18 h. Heure volable : pluie < 0,2 mm,
   vent ≤ 20 km/h, rafales ≤ 25 km/h, vent à 850 hPa (≈ altitude du sommet) ≤ 35 km/h, pas de nuage au
   décollage, pas d'orage. Aucune direction n'est exclue (huit aires de décollage). Seuils dans
   `engine/config.js` (profil « débutant » de Déco Radar), à faire valider par un moniteur.
2. **Prévisions** : 11 ensembles et 11 modèles déterministes via [Open-Meteo](https://open-meteo.com/).
3. **Recalage du vent** : pas d'anémomètre ouvert au sommet. Les modèles grossiers sont recalés sur AROME HD
   (1,3 km, qui résout le cône) par rapports de quantiles, octobre-novembre 2023-2025 : ERA5 vent ×1,05 /
   rafales ×1,13 ; ICON-EU ×1,00 / ×0,87.
4. **Pas de calibration locale** : les coefficients de la courbe marge → probabilité sont empruntés à la
   station de Millau. La probabilité est plausible mais pas calibrée au Puy de Dôme.
5. **Échéance** : au-delà d'une dizaine de jours, mélange avec la climatologie (ERA5 1993-2025, 11-25 octobre).
6. **Paraglidable** (facultatif) : actif si le secret `PARAGLIDABLE_KEY` correspond à une clé dont un point est
   à moins de 5 km du décollage.

Tout est détaillé sur le site, onglet « Méthode & sources ».

## Mises à jour

Le workflow `.github/workflows/aiguille.yml` tourne toutes les 20 minutes (chaque passage programme le suivant ;
le cron de GitHub sert de filet) : il lit l'heure du dernier run de chaque modèle, ne retélécharge que ceux qui
ont changé, recalcule, committe `data/` et republie. Si l'aiguille bouge d'au moins 30 points depuis la dernière
alerte, un commentaire est posté sur l'issue « 🎯 Alertes de l'aiguille ».

**Après le vol**, réponds dans cette issue : `volé` (la journée compte comme volée), `pas volé`, ou `oublie`
(retour à la prévision). Une carte de fin avec animation s'affiche après 18 h le 18 octobre
(aperçu : `?finale=succes`, `?finale=rate` ou `?finale=attente`).

## En local

```bash
npm test                                   # tests du moteur
node scripts/update.mjs --dry              # mise à jour sans alerte
node scripts/build-climatology.mjs         # reconstruit data/climatology.json (ERA5, ~50 requêtes Open-Meteo)
python3 -m http.server 8801                # puis http://localhost:8801
```

## Sources et licences

- Prévisions : Open-Meteo (CC BY 4.0) ; ECMWF (CC BY 4.0), NOAA (domaine public), DWD, ECCC, Met Office,
  Météo-France (Licence Ouverte 2.0), MeteoSwiss, Google DeepMind, JMA.
- Réanalyse : ERA5, Copernicus Climate Change Service / ECMWF.
- Site de vol : [ParaglidingEarth](https://www.paraglidingearth.com/?site=2896), Panoramique des Dômes.

Outil d'aide personnel, pas une autorisation de voler : un moniteur FFVL et les conditions sur place décident.
