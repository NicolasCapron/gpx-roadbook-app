#!/bin/sh
# Stoppe un serveur déjà lancé puis relance en mode watch.
# Sous `node --watch`, le port est tenu par un process enfant : il faut aussi tuer le watcher parent,
# sinon il survit et relance un serveur concurrent à la prochaine modif de fichier.
PORT=${PORT:-3000}

pkill -f -- '--watch-path=server.js' 2>/dev/null
lsof -ti:"$PORT" | xargs kill 2>/dev/null

# Attendre la libération du port (max ~5s, puis kill -9)
i=0
while lsof -ti:"$PORT" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 25 ] && lsof -ti:"$PORT" | xargs kill -9 2>/dev/null
  sleep 0.2
done

exec node --watch-path=server.js --watch-path=public server.js
