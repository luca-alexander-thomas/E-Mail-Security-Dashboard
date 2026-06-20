#!/bin/bash
# update.sh — Self-update script für DMARC-Analyzer-Dashboard
# Wird vom Node.js-Prozess als detachter Prozess gestartet.
# Args: $1=ZIP-Pfad  $2=App-Verzeichnis  $3=PM2-App-Name (optional)
set -euo pipefail

ZIP_FILE="$1"
APP_DIR="$2"
PM2_APP="${3:-}"
TEMP_DIR="$APP_DIR/.update-temp-$$"
RESULT_FILE="$APP_DIR/.update-result"
LOG="$APP_DIR/.update-run.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

log "=== Update gestartet (PID $$) ==="

# Restart-Methode bestimmen:
#   pm2     → PM2-App neu starten (klassisch)
#   docker  → Node-Prozess killen, Container-Restart-Policy übernimmt
#   signal  → SIGTERM an Node-PID senden (aus .node-pid Datei)
RESTART_METHOD="${RESTART_METHOD:-}"

if [ -z "$RESTART_METHOD" ]; then
  # Auto-Erkennung: wenn PM2 läuft und App-Name gesetzt, PM2 verwenden
  if [ -n "$PM2_APP" ] && command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q "$PM2_APP"; then
    RESTART_METHOD="pm2"
  else
    RESTART_METHOD="docker"
  fi
  log "Restart-Methode auto-erkannt: $RESTART_METHOD"
fi

log "ZIP: $ZIP_FILE | App: $APP_DIR | Methode: $RESTART_METHOD"

# Warten bis Node die HTTP-Antwort gesendet hat
sleep 3

[ -f "$ZIP_FILE" ] || { log "FEHLER: ZIP nicht gefunden: $ZIP_FILE"; exit 1; }

# Entpacken
log "Entpacke ..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"
unzip -q "$ZIP_FILE" -d "$TEMP_DIR"

# Quelldaten bestimmen (flaches ZIP vs. Unterordner)
SOURCE_DIR="$TEMP_DIR"
SUBDIRS=$(find "$TEMP_DIR" -maxdepth 1 -mindepth 1 -type d | wc -l)
FILES=$(find "$TEMP_DIR" -maxdepth 1 -mindepth 1 -type f | wc -l)
if [ "$SUBDIRS" -eq 1 ] && [ "$FILES" -eq 0 ]; then
  SOURCE_DIR=$(find "$TEMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)
  log "Quelle in Unterordner: $SOURCE_DIR"
fi

# Dateien kopieren (sensitive Dateien ausschließen)
log "Kopiere Dateien ..."
rsync -a \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='node_modules/' \
  --exclude='update-log.json' \
  --exclude='.update-*' \
  --exclude='*.log' \
  "$SOURCE_DIR/" "$APP_DIR/"

# Abhängigkeiten installieren
log "npm install ..."
cd "$APP_DIR"
npm install --production --silent

# Neue Version lesen
NEW_VERSION="unknown"
if [ -f "$APP_DIR/version.json" ]; then
  NEW_VERSION=$(node -e "try{process.stdout.write(require('$APP_DIR/version.json').version)}catch(e){process.stdout.write('unknown')}" 2>/dev/null || echo "unknown")
fi
log "Neue Version: $NEW_VERSION"

# Aufräumen (VOR dem Neustart!)
rm -rf "$TEMP_DIR"
rm -f "$ZIP_FILE"

# Ergebnis-Datei schreiben (VOR dem Neustart, damit Node sie beim nächsten Start liest)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "{\"success\":true,\"version\":\"$NEW_VERSION\",\"timestamp\":\"$TS\"}" > "$RESULT_FILE"

log "=== Update abgeschlossen: $NEW_VERSION — starte neu ==="

# Neustart
case "$RESTART_METHOD" in
  pm2)
    PM2_CMD=$(command -v pm2 2>/dev/null || echo "/usr/local/bin/pm2")
    log "PM2-Neustart: $PM2_CMD restart $PM2_APP"
    "$PM2_CMD" restart "$PM2_APP"
    ;;
  docker)
    # Node-Prozess beenden → Docker/1Panel Restart-Policy startet ihn neu
    # Versuche zuerst .node-pid Datei, dann PID 1 (main container process)
    NODE_PID=""
    [ -f "$APP_DIR/.node-pid" ] && NODE_PID=$(cat "$APP_DIR/.node-pid" 2>/dev/null)
    if [ -z "$NODE_PID" ]; then
      NODE_PID=$(pgrep -f "node" | head -1 2>/dev/null || echo "1")
    fi
    log "SIGTERM an Node-PID: $NODE_PID"
    kill -SIGTERM "$NODE_PID" 2>/dev/null || kill -SIGTERM 1 2>/dev/null || true
    ;;
  signal)
    NODE_PID=$(cat "$APP_DIR/.node-pid" 2>/dev/null || echo "")
    if [ -n "$NODE_PID" ]; then
      log "SIGTERM an PID: $NODE_PID"
      kill -SIGTERM "$NODE_PID" 2>/dev/null || true
    else
      log "WARNUNG: .node-pid nicht gefunden, sende SIGTERM an PID 1"
      kill -SIGTERM 1 2>/dev/null || true
    fi
    ;;
  *)
    log "Unbekannte Restart-Methode: $RESTART_METHOD — sende SIGTERM an PID 1"
    kill -SIGTERM 1 2>/dev/null || true
    ;;
esac
