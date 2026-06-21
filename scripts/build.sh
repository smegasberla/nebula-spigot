#!/bin/bash
set -euo pipefail

NEBULA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
JAVA_HOME="${JAVA_HOME:-/home/smegasberla/tools/jdk-25.0.3+9}"

cd "$NEBULA_DIR"

case "${1:-build}" in
  apply)
    JAVA_HOME="$JAVA_HOME" ./gradlew applyAllPatches --no-daemon
    ;;
  build)
    JAVA_HOME="$JAVA_HOME" ./gradlew leaf-server:createBundlerJar --no-daemon
    ;;
  rebuild)
    JAVA_HOME="$JAVA_HOME" ./gradlew rebuildAllPatches --no-daemon
    ;;
  jar)
    JAVA_HOME="$JAVA_HOME" ./gradlew leaf-server:createBundlerJar --no-daemon
    ;;
  dev)
    JAVA_HOME="$JAVA_HOME" ./gradlew leaf-server:runServer --no-daemon
    ;;
  clean)
    JAVA_HOME="$JAVA_HOME" ./gradlew clean --no-daemon
    ;;
  *)
    echo "Usage: $0 {apply|build|rebuild|jar|dev|clean}"
    exit 1
    ;;
esac
