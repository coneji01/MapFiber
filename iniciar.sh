#!/bin/bash
# Iniciar ambos servidores MapFiber
# Admin tool en puerto 3020, Sitio web en puerto 3010

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "🔄 Iniciando servidores MapFiber..."

# Matar instancias previas
lsof -ti :3010 -ti :3020 2>/dev/null | xargs kill -9 2>/dev/null
sleep 1

# Admin tool (mapa, cables, mangas)
nohup node backend/server-admin.js > /tmp/ftth-admin.log 2>&1 &
echo "✅ Admin MapFiber → http://localhost:3020"

# Sitio web público
nohup node backend/server.js > /tmp/ftth-website.log 2>&1 &
echo "✅ Sitio Web MapFiber → http://localhost:3010/web"

sleep 2
echo "📡 Admin: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3020)"
echo "🌐 Web:   $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3010/web)"
