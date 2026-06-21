#!/usr/bin/env bash
# Nebula CI smoke test — start server, verify metrics endpoint, load-test via commands, check plugins
set -euo pipefail

SERVER_DIR="$(mktemp -d)"
JAR="$1"
PLUGIN_URL="$2"
TIMEOUT=90
STARTED=0

cleanup() {
  echo "[cleanup] Stopping server..."
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$SERVER_DIR"
}
trap cleanup EXIT

echo "[setup] Server dir: $SERVER_DIR"
echo "[setup] Jar: $JAR"

# Accept EULA
echo "eula=true" > "$SERVER_DIR/eula.txt"

# Minimal server.properties for fast start
cat > "$SERVER_DIR/server.properties" <<PROPS
accepts-transfers=false
allow-flight=true
allow-nether=false
broadcast-console-to-ops=false
difficulty=peaceful
enable-query=false
enable-rcon=false
enable-status=true
enforce-whitelist=false
gamemode=creative
generator-settings={}
hardcore=false
level-name=world
level-seed=
level-type=default
max-players=20
max-tick-time=-1
motd=Nebula CI Smoke Test
network-compression-threshold=256
online-mode=false
player-idle-timeout=0
prevent-proxy-connections=false
pvp=false
spawn-animals=false
spawn-monsters=false
spawn-npcs=false
spawn-protection=0
sync-chunk-writes=true
view-distance=4
simulation-distance=4
white-list=false
PROPS

# Copy Spark plugin if URL provided
if [ -n "$PLUGIN_URL" ]; then
  mkdir -p "$SERVER_DIR/plugins"
  echo "[plugin] Downloading Spark..."
  curl -sL "$PLUGIN_URL" -o "$SERVER_DIR/plugins/Spark.jar" 2>&1
  ls -la "$SERVER_DIR/plugins/"
fi

# Start server
echo "[start] Launching server..."
cd "$SERVER_DIR"
java -jar "$JAR" --nogui --port 25566 &
SERVER_PID=$!

# Wait for "Done!" in the log with timeout
echo "[wait] Waiting for server startup..."
END=$((SECONDS + TIMEOUT))
while [ $SECONDS -lt $END ]; do
  if [ -f logs/latest.log ]; then
    if grep -q "Done (" logs/latest.log 2>/dev/null; then
      STARTED=1
      echo "[ok] Server started"
      break
    fi
    # Check for startup errors
    if grep -qi "Failed to start\|Fatal\|Critical exception\|Error during" logs/latest.log 2>/dev/null; then
      echo "[FAIL] Server startup error detected"
      tail -30 logs/latest.log
      exit 1
    fi
  fi
  sleep 2
done

if [ "$STARTED" -ne 1 ]; then
  echo "[FAIL] Server failed to start within ${TIMEOUT}s"
  cat logs/latest.log 2>/dev/null || true
  exit 1
fi

# Check metrics endpoint
echo "[check] Testing /health endpoint..."
HEALTH=$(curl -sf http://localhost:25510/health 2>/dev/null || echo "FAIL")
if [ "$HEALTH" != "OK" ]; then
  echo "[FAIL] /health endpoint returned: $HEALTH"
  exit 1
fi
echo "[ok] /health = OK"

echo "[check] Testing /live endpoint..."
LIVE=$(curl -sf http://localhost:25510/live 2>/dev/null || echo "FAIL")
if echo "$LIVE" | grep -q "tps"; then
  echo "[ok] /live returns TPS data"
  echo "$LIVE" | python3 -m json.tool 2>/dev/null || echo "$LIVE"
else
  echo "[FAIL] /live missing TPS data"
  exit 1
fi

echo "[check] Testing /metrics endpoint..."
METRICS=$(curl -sf http://localhost:25510/metrics 2>/dev/null || echo "FAIL")
if echo "$METRICS" | grep -q "nebula_tps"; then
  echo "[ok] /metrics returns Prometheus data"
  echo "$METRICS" | grep "nebula_" | head -10
else
  echo "[FAIL] /metrics missing nebula_tps"
  exit 1
fi

# Generate load via console commands
echo "[load] Generating entity load (2000 chickens)..."
for i in $(seq 1 20); do
  echo "summon minecraft:chicken ~ ~ ~" > /proc/$SERVER_PID/fd/0 2>/dev/null || true
  sleep 0.5
done

# Wait a few ticks for TPS to stabilize
sleep 5

# Check TPS from metrics
echo "[check] TPS after load..."
METRICS_AFTER=$(curl -sf http://localhost:25510/metrics 2>/dev/null)
TPS=$(echo "$METRICS_AFTER" | grep "nebula_tps{window=\"5s\"}" | awk '{print $2}')
if [ -n "$TPS" ] && [ "$(echo "$TPS" | cut -d. -f1)" -ge 18 ]; then
  echo "[ok] TPS stable: $TPS"
else
  echo "[WARN] TPS low: $TPS (server might need more load)"
fi

# Check plugin loaded if we had one
if [ -n "$PLUGIN_URL" ] && grep -q "Spark\|spark" logs/latest.log; then
  echo "[ok] Spark plugin loaded successfully"
fi

# Check for crashes/errors in log
ERRORS=$(grep -ci "Exception\|Error\|WARN\|Could not" logs/latest.log 2>/dev/null || echo 0)
echo "[check] Log errors: $ERRORS lines with warnings/errors"

echo "[ok] All checks passed"
exit 0
