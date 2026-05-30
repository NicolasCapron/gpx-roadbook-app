# GPX Roadbook App

Generateur de roadbook GPS pour cyclistes avec detection automatique des communes et des montees.

## Fonctionnalites

- **Import GPX** (OpenRunner, Komoot, Strava, Garmin...)
- **Detection automatique des communes** via Nominatim / OpenStreetMap
- **Detection automatique des montees** (algorithme type ClimbPro)
- **Points depart/arrivee** ajoutes automatiquement
- **Ajout de waypoints personnalises** en cliquant sur la carte :
  - Commune, Montee, Secteur pave, Ravitaillement, Sprint, Danger, Controle, Depart, Arrivee, Point libre
- **Sauvegarde des parcours** en localStorage avec page "Mes Parcours"
- **Export GPX enrichi** compatible Garmin (sans emoji, tags texte)
- **Bandelette print** 2cm pour sticker cadre velo
- **Guides** : alertes Garmin + ecran roadbook Edge 830

## Installation

```bash
npm install
```

## Lancement

```bash
npm run dev
```

L'application est accessible sur http://localhost:3000

## Utilisation

1. Ouvrir http://localhost:3000
2. Glisser un fichier GPX dans la zone de depot
3. Les montees et points depart/arrivee sont detectes automatiquement
4. Cliquer "Detecter les communes" pour geocoder la trace via Nominatim
5. Ajouter des points manuels si besoin (paves, ravitos, dangers...)
6. Sauvegarder avec le bouton "Sauver" pour retrouver le parcours plus tard
7. Exporter le GPX enrichi avec le bouton "GPX"

## Configuration Garmin

1. Copier le fichier `*_roadbook.gpx` dans le dossier `Garmin/NewFiles/` de votre GPS
2. Le charger comme **Parcours**
3. Activer les **Alertes de parcours** dans les parametres de navigation
4. Voir le [guide complet](http://localhost:3000/tuto.html) et le [guide Edge 830](http://localhost:3000/guide-830.html)

## Structure du projet

```
gpx-roadbook-app/
├── server.js             <- Express + endpoint /api/geocode (Nominatim)
├── public/
│   ├── index.html
│   ├── tuto.html         <- Guide alertes Garmin
│   ├── guide-830.html    <- Guide ecran roadbook Edge 830
│   ├── css/style.css
│   └── js/
│       ├── gpx.js        <- Parser GPX, detection montees, export enrichi
│       ├── map.js        <- Gestion carte Leaflet
│       ├── roadbook.js   <- Store waypoints + rendu table + bandelette print
│       ├── routes.js     <- Sauvegarde localStorage + page Mes Parcours
│       └── app.js        <- Controleur principal
└── README.md
```

## Technologies

- Node.js + Express
- Leaflet (carte)
- Nominatim / OpenStreetMap (geocodage)
- Aucune base de donnees, aucune cle API requise
