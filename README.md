# 🗺 GPX Roadbook App

Générateur de roadbook GPS avec détection automatique des communes et ajout de points personnalisés (secteurs pavés, ravitaillements, rubans, dangers…).

## Fonctionnalités

- **Import GPX** (OpenRunner, Komoot, Strava, Garmin…)
- **Détection automatique des communes** via l'API Claude (géocodage par batch)
- **Ajout de waypoints personnalisés** en cliquant sur la carte :
  - 🏘 Commune
  - 🪨 Secteur pavé
  - 🍌 Ravitaillement
  - 🎗 Ruban / Sprint
  - ⚠️ Danger
  - 🏁 Contrôle
  - 🟢 Départ / 🔴 Arrivée
  - 📍 Point libre
- **Roadbook interactif** avec distances depuis le départ, distance restante, distance jusqu'au prochain point
- **Export GPX enrichi** compatible Garmin (waypoints avec symboles et distances dans le nom)
- **Impression** du roadbook (Ctrl+P / Cmd+P)

## Installation

```bash
# 1. Cloner / copier le projet
cd gpx-roadbook-app

# 2. Installer les dépendances
npm install

# 3. Configurer l'API key
cp .env.example .env
# Éditer .env → ANTHROPIC_API_KEY=sk-ant-...

# 4. Lancer
npm start
# → http://localhost:3000
```

## Utilisation

1. **Ouvrir** `http://localhost:3000`
2. **Glisser un fichier GPX** dans la zone de dépôt
3. **Cliquer "Détecter les communes"** → Claude géocode la trace par batch (quelques secondes)
4. **Ajouter des points** : sélectionnez un type dans le panneau "Ajouter un point", puis cliquez sur la carte. Le point est automatiquement accroché à la trace la plus proche.
5. **Exporter** le GPX enrichi avec le bouton ⬇ GPX

## Configuration Garmin

1. Copier le fichier `*_roadbook.gpx` sur votre Garmin (dossier `GARMIN/GPX/`)
2. Le charger comme **Parcours** (pas comme activité)
3. Les communes et points apparaissent comme **points de passage** avec la distance restante dans leur nom
4. Créer un **écran de données personnalisé** avec les champs :
   - `Prochain point` + `Distance prochain point`
   - `Vitesse` + `Vitesse moyenne`
   - `Heure d'arrivée estimée`

## Structure du projet

```
gpx-roadbook-app/
├── server.js          ← Express + endpoint /api/geocode (Anthropic SDK)
├── .env               ← ANTHROPIC_API_KEY (à créer)
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── gpx.js       ← Parser GPX, sampler, export enrichi
│       ├── map.js       ← Gestion carte Leaflet
│       ├── roadbook.js  ← Store waypoints + rendu table
│       └── app.js       ← Contrôleur principal
└── README.md
```

## Idées d'évolutions

- [ ] Import direct depuis OpenRunner (API)
- [ ] Profil altimétrique sous la carte
- [ ] Estimation du temps de passage basée sur une vitesse cible
- [ ] Export PDF du roadbook (mise en page cyclisme)
- [ ] Couleurs et icônes personnalisables par type de point
- [ ] Sauvegarde locale des sessions (localStorage ou fichier JSON)
- [ ] Mode hors-ligne (service worker + tiles OSM en cache)
