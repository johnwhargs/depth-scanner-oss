#!/bin/bash
# Depth Scanner OSS — Launch backend + Tauri app
DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$DIR/../backend"

# Start Python backend in background
source "$BACKEND/.venv/bin/activate"
cd "$BACKEND"
uvicorn server:app --host 127.0.0.1 --port 7843 --log-level warning &
BACKEND_PID=$!

# Wait for backend to be ready
echo "[Depth Scanner] Starting backend..."
for i in $(seq 1 30); do
  curl -s http://127.0.0.1:7843/health > /dev/null 2>&1 && break
  sleep 0.5
done
echo "[Depth Scanner] Backend ready"

# Run Tauri app
cd "$DIR/src-tauri"
source "$HOME/.cargo/env"
cargo tauri dev 2>&1

# Cleanup: kill backend when Tauri closes
kill $BACKEND_PID 2>/dev/null
echo "[Depth Scanner] Shutdown complete"
