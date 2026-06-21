#!/bin/bash
# nebula-spigot server start script with JDK 25 optimized flags
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Config
JAVA_HOME="${JAVA_HOME:-$HOME/tools/jdk-25.0.3+9}"
MEM_MIN="${MEM_MIN:-2G}"
MEM_MAX="${MEM_MAX:-2G}"
JAR="${JAR:-$PROJECT_DIR/leaf-server/build/libs/leaf-bundler-26.2.local-SNAPSHOT.jar}"
SERVER_DIR="${SERVER_DIR:-$(pwd)}"
PROFILER_HOME="${PROFILER_HOME:-$HOME/tools/async-profiler-3.0-linux-x64}"

JAVA="$JAVA_HOME/bin/java"

# JDK 25 optimized flags
# - ZGC (generational by default in JDK 25)
# - Pre-touch heap for stable latency
# - String dedup for memory savings
# - Parallel reference processing
# - Large page support if available
FLAGS=(
  "-Xms${MEM_MIN}"
  "-Xmx${MEM_MAX}"
  "-XX:+UseZGC"
  "-XX:+AlwaysPreTouch"
  "-XX:+UseStringDeduplication"
  "-XX:+ParallelRefProcEnabled"
  "-XX:+DisableExplicitGC"
  "-XX:-OmitStackTraceInFastThrow"
  "-XX:+UnlockExperimentalVMOptions"
  "-XX:+UnlockDiagnosticVMOptions"
  "-XX:+ZUncommit"
  "-XX:ZUncommitDelay=300"
  "-XX:SoftMaxHeapSize=${MEM_MAX}"
  "-XX:-UsePerfData"
  "--add-modules=jdk.incubator.vector"
)

# Aikar's flags
FLAGS+=(
  "-Dfile.encoding=UTF-8"
  "-Duser.timezone=UTC"
)

# Help
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "Usage: $0 [--profiler SECONDS] [--nogui] [extra java args]"
  echo
  echo "Environment variables:"
  echo "  JAVA_HOME    - JDK 25 path (default: $JAVA_HOME)"
  echo "  MEM_MIN      - Initial heap (default: $MEM_MIN)"
  echo "  MEM_MAX      - Max heap (default: $MEM_MAX)"
  echo "  JAR          - Server jar path"
  echo "  SERVER_DIR   - Server working directory"
  echo "  PROFILER_HOME - async-profiler path"
  exit 0
fi

# Parse --profiler flag
PROFILER_SECONDS=""
EXTRA_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --profiler)
      PROFILER_SECONDS="$2"
      shift 2
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

# Ensure server dir exists and has eula
cd "$SERVER_DIR"
if [ ! -f eula.txt ]; then
  echo "eula=true" > eula.txt
  echo "[!] Created eula.txt (agreeing to Minecraft EULA)"
fi
if [ ! -f server.properties ]; then
  cat > server.properties <<'PROPS'
online-mode=false
server-port=25565
view-distance=8
simulation-distance=6
max-players=20
PROPS
  echo "[!] Created default server.properties"
fi

echo "[nebula] Using: $JAVA"
echo "[nebula] Heap:  ${MEM_MIN}/${MEM_MAX}"
echo "[nebula] Flags: ${FLAGS[*]}"
echo "[nebula] JAR:   $JAR"
echo "[nebula] Dir:   $SERVER_DIR"

# Start server
PID_FILE="/tmp/nebula-server.pid"
"$JAVA" "${FLAGS[@]}" "${EXTRA_ARGS[@]}" -jar "$JAR" --nogui &
echo $! > "$PID_FILE"
echo "[nebula] PID $!"

# Optional profiling
if [ -n "$PROFILER_SECONDS" ]; then
  echo "[nebula] Profiling in ${PROFILER_SECONDS}s..."
  sleep 5  # wait for server to start
  "$PROFILER_HOME/bin/asprof" -d "$PROFILER_SECONDS" -f "$SERVER_DIR/profile.html" "$(cat $PID_FILE)"
  echo "[nebula] Profile: $SERVER_DIR/profile.html"
fi

wait
