#!/bin/bash
set -euo pipefail

# Nebula Profiling Harness
# Usage: ./profile.sh [output_dir] [duration_seconds]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NEBULA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
JAVA_HOME="${JAVA_HOME:-/home/smegasberla/tools/jdk-25.0.3+9}"
ASPROF="/home/smegasberla/tools/async-profiler-3.0-linux-x64/bin/asprof"

OUTDIR="${1:-profiling-output}"
DURATION="${2:-120}"
mkdir -p "$OUTDIR"

# Kill any leftover server
pkill -f "leaf-bundler" 2>/dev/null || true
sleep 1

echo "=== Building server ==="
cd "$NEBULA_DIR"
JAVA_HOME="$JAVA_HOME" ./gradlew leaf-server:createBundlerJar --no-daemon -q

JAR="$(ls leaf-server/build/libs/leaf-bundler-*.jar | head -1)"
echo "=== Using: $JAR ==="

# Setup server
rm -rf "$OUTDIR/server"
mkdir -p "$OUTDIR/server"
cd "$OUTDIR/server"
echo "eula=true" > eula.txt

# Start with profiling JVM flags
JAVA_FLAGS="-Xms4G -Xmx4G -XX:+UseZGC -XX:+ZGenerational -XX:+AlwaysPreTouch"
JAVA_FLAGS="$JAVA_FLAGS -Dorg.gradle.jvmargs=-Xmx4G"
JAVA_FLAGS="$JAVA_FLAGS -Dpaper.maxChunkGenThreads=4 -Dpaper.watchdog=true"

echo "=== Starting server with ZGC ==="
$JAVA_HOME/bin/java $JAVA_FLAGS -jar "$JAR" --nogui &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to start
echo "=== Waiting for server to finish loading ==="
for i in {1..60}; do
  if grep -q "Done (" logs/latest.log 2>/dev/null; then
    echo "Server ready after ${i}s"
    break
  fi
  sleep 1
done

# Give it a moment to settle
sleep 3

echo "=== Running load test ==="
cd "$SCRIPT_DIR"
node loadtest.js 5 &
LOAD_PID=$!

# Wait for bots to connect and start moving
sleep 10

echo "=== Profiling for ${DURATION}s ==="
# Profile CPU
$ASPROF -d "$DURATION" -f "$OUTDIR/cpu-profile.svg" -e cpu -i 1ms "$SERVER_PID" 2>&1 | tail -5
echo "CPU profile: $OUTDIR/cpu-profile.svg"

# Profile allocations
$ASPROF -d 30 -f "$OUTDIR/alloc-profile.svg" -e alloc -i 1ms "$SERVER_PID" 2>&1 | tail -5
echo "Allocation profile: $OUTDIR/alloc-profile.svg"

# Profile lock contention
$ASPROF -d 30 -f "$OUTDIR/lock-profile.svg" -e lock -i 1ms "$SERVER_PID" 2>&1 | tail -5
echo "Lock profile: $OUTDIR/lock-profile.svg"

# Compare with JFR too
$JAVA_HOME/bin/jcmd "$SERVER_PID" JFR.start name=nebula duration=${DURATURE}s filename="$OUTDIR/flight.jfr" settings=profile 2>&1 || true

echo "=== Stopping ==="
kill "$LOAD_PID" 2>/dev/null || true
kill "$SERVER_PID" 2>/dev/null || true
wait 2>/dev/null || true

echo "=== Done ==="
echo "=== Profiles in: $OUTDIR ==="
ls -lh "$OUTDIR"/*.svg 2>/dev/null
