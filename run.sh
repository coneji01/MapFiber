#!/bin/bash
# run.sh — Start MapFiber
# Usage: ./run.sh [dev|prod|docker]

set -e

cd "$(dirname "$0")"

MODE="${1:-dev}"

case "$MODE" in
  dev)
    echo "🚀 Starting MapFiber (development mode)..."
    echo "   Open: http://localhost:3010"
    node backend/server.js
    ;;

  prod)
    echo "🚀 Starting MapFiber (production mode)..."
    echo "   Open: http://localhost:3010"
    NODE_ENV=production node backend/server.js &
    echo "   PID: $!"
    echo "   Run 'kill $!' to stop"
    ;;

  docker)
    echo "🐳 Starting MapFiber with Docker..."
    echo "   Open: http://localhost:3010"
    docker compose up --build -d
    echo "   Run 'docker compose down' to stop"
    ;;

  docker-stop)
    echo "🛑 Stopping Docker containers..."
    docker compose down
    ;;

  logs)
    docker compose logs -f
    ;;

  install)
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Done! Run './run.sh dev' to start"
    ;;

  *)
    echo "Usage: $0 [dev|prod|docker|docker-stop|logs|install]"
    echo ""
    echo "  dev         Start in development mode (terminal)"
    echo "  prod        Start in production mode (background)"
    echo "  docker      Start with Docker Compose"
    echo "  docker-stop Stop Docker containers"
    echo "  logs        Follow Docker logs"
    echo "  install     Install npm dependencies"
    exit 1
    ;;
esac
