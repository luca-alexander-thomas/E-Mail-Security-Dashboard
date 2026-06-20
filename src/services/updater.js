'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

const APP_DIR = path.resolve(__dirname, '../..');
const VERSION_FILE = path.join(APP_DIR, 'version.json');
const UPDATE_LOG_FILE = path.join(APP_DIR, 'update-log.json');
const RESULT_FILE = path.join(APP_DIR, '.update-result');
const DOWNLOAD_FILE = path.join(APP_DIR, '.update-download.zip');
const PID_FILE = path.join(APP_DIR, '.node-pid');

// Eigene PID speichern damit update.sh den Prozess gezielt beenden kann
try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}
process.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch {} });

let _lastCheck = null;
let _installing = false;

// ─── Version ──────────────────────────────────────────────────────────────────

function getCurrentVersion() {
  try {
    const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    return { version: 'dev', buildDate: '', ...data };
  } catch {
    return { version: 'dev', buildDate: '' };
  }
}

// ─── Log ──────────────────────────────────────────────────────────────────────

function getUpdateLog() {
  try {
    const raw = JSON.parse(fs.readFileSync(UPDATE_LOG_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function appendLog(entry) {
  const log = getUpdateLog();
  log.unshift({ timestamp: new Date().toISOString(), ...entry });
  if (log.length > 100) log.length = 100;
  try {
    fs.writeFileSync(UPDATE_LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
  } catch (e) {
    console.error('[Updater] Log schreiben fehlgeschlagen:', e.message);
  }
}

// ─── Startup: Ergebnis vorigen Updates einlesen ───────────────────────────────

function checkPendingResult() {
  if (!fs.existsSync(RESULT_FILE)) return;
  try {
    const result = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8'));
    fs.unlinkSync(RESULT_FILE);
    if (result.success) {
      console.log(`[Updater] Update erfolgreich abgeschlossen: ${result.version}`);
      appendLog({ type: 'install_complete', success: true, version: result.version });
    } else {
      console.error(`[Updater] Update fehlgeschlagen: ${result.error}`);
      appendLog({ type: 'install_complete', success: false, error: result.error });
    }
  } catch (e) {
    console.error('[Updater] Ergebnis-Datei lesen fehlgeschlagen:', e.message);
  }
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'DMARC-Dashboard-Updater' };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    https.get(url, { headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Ungültige JSON-Antwort von ${url}`)); }
      });
    }).on('error', reject);
  });
}

function compareVersions(a, b) {
  const parse = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n) || 0);
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] || 0) - (bv[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

async function checkForUpdates() {
  const repo = process.env.GITHUB_REPO;
  if (!repo) throw new Error('GITHUB_REPO nicht in .env konfiguriert');

  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);

  if (release.message) {
    throw new Error(`GitHub API: ${release.message}`);
  }

  const current = getCurrentVersion().version;
  const latest = release.tag_name || '';
  const hasUpdate = compareVersions(latest, current);

  const asset = (release.assets || []).find(a => a.name === 'source.zip');

  const result = {
    checked: new Date().toISOString(),
    current,
    latest,
    hasUpdate,
    releaseUrl: release.html_url || '',
    releaseNotes: release.body || '',
    publishedAt: release.published_at || '',
    downloadUrl: asset?.browser_download_url || null,
    assetFound: !!asset,
  };

  _lastCheck = result;
  appendLog({
    type: 'check',
    result: hasUpdate ? 'update_available' : 'up_to_date',
    current,
    latest,
  });

  return result;
}

// ─── Download ────────────────────────────────────────────────────────────────

function downloadFile(url, dest, hops = 0) {
  if (hops > 8) return Promise.reject(new Error('Zu viele Weiterleitungen beim Download'));

  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const headers = { 'User-Agent': 'DMARC-Dashboard-Updater' };
    const token = process.env.GITHUB_TOKEN;
    if (token && url.includes('api.github.com')) headers['Authorization'] = `Bearer ${token}`;

    const req = lib.get(url, { headers }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        downloadFile(res.headers.location, dest, hops + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} beim Download`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
    });
    req.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ─── Install ─────────────────────────────────────────────────────────────────

async function installUpdate(downloadUrl) {
  if (_installing) throw new Error('Ein Update wird bereits installiert');
  if (!downloadUrl) throw new Error('Keine Download-URL verfügbar');

  const updateScript = path.join(APP_DIR, 'update.sh');
  if (!fs.existsSync(updateScript)) throw new Error('update.sh nicht gefunden');

  const pm2App = process.env.PM2_APP_NAME || '';
  const fromVersion = getCurrentVersion().version;
  const toVersion = _lastCheck?.latest || 'unbekannt';

  _installing = true;
  appendLog({ type: 'install_start', from: fromVersion, to: toVersion });

  try {
    console.log(`[Updater] Lade ${toVersion} herunter von ${downloadUrl}`);
    await downloadFile(downloadUrl, DOWNLOAD_FILE);
    console.log(`[Updater] Download abgeschlossen. Starte update.sh ...`);

    const child = spawn('bash', [updateScript, DOWNLOAD_FILE, APP_DIR, pm2App], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, RESTART_METHOD: process.env.RESTART_METHOD || '' },
    });
    child.unref();

    return { started: true, to: toVersion };
  } catch (err) {
    _installing = false;
    appendLog({ type: 'install_error', error: err.message });
    throw err;
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

function getLastCheck() { return _lastCheck; }
function isInstalling() { return _installing; }

// ─── Auto-Check ──────────────────────────────────────────────────────────────

function startAutoCheck() {
  checkPendingResult();

  const mode = process.env.UPDATE_MODE || 'disabled';
  if (mode === 'disabled') {
    console.log('[Updater] Update-Check deaktiviert (UPDATE_MODE=disabled)');
    return;
  }

  const intervalHours = Math.max(1, parseInt(process.env.UPDATE_CHECK_INTERVAL) || 24);
  const intervalMs = intervalHours * 60 * 60 * 1000;

  const runCheck = async () => {
    try {
      console.log('[Updater] Suche nach Updates ...');
      const result = await checkForUpdates();
      if (result.hasUpdate) {
        console.log(`[Updater] Update verfügbar: ${result.current} → ${result.latest}`);
        if (mode === 'auto' && result.downloadUrl) {
          console.log('[Updater] Auto-Install gestartet ...');
          await installUpdate(result.downloadUrl);
        }
      } else {
        console.log(`[Updater] Aktuell (${result.current})`);
      }
    } catch (e) {
      console.error('[Updater] Check fehlgeschlagen:', e.message);
    }
  };

  // Ersten Check 30 Sekunden nach Start
  setTimeout(runCheck, 30_000);
  // Danach periodisch
  setInterval(runCheck, intervalMs);

  console.log(`[Updater] Auto-Check aktiv (Modus: ${mode}, Interval: ${intervalHours}h)`);
}

module.exports = {
  getCurrentVersion,
  getUpdateLog,
  checkForUpdates,
  installUpdate,
  getLastCheck,
  isInstalling,
  startAutoCheck,
};
