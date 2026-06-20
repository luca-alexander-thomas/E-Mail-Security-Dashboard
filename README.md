# Email Security Dashboard

Ein selbst gehostetes Dashboard zur zentralen Überwachung der E-Mail-Sicherheit für Microsoft 365-Umgebungen. Kombiniert DMARC-Auswertung, Microsoft Secure Score, Mail-Flow-Analyse, Sicherheitswarnungen, DNS-Gesundheitsprüfungen und TLS-Reporting in einer modernen Oberfläche.

![Version](https://img.shields.io/github/v/release/your-username/DMARC-Analyzer-Dashboard?label=Version&color=blue)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![License](https://img.shields.io/badge/Lizenz-MIT-lightgrey)
![Platform](https://img.shields.io/badge/Platform-Docker%20%7C%20Linux-blue)

---

## Inhaltsverzeichnis

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Voraussetzungen](#voraussetzungen)
- [Schnellstart (lokal)](#schnellstart-lokal)
- [Konfiguration](#konfiguration)
- [Azure App Registration](#azure-app-registration)
- [Datenbankschema](#datenbankschema)
- [Produktiv-Deployment (Docker / 1Panel)](#produktiv-deployment-docker--1panel)
- [Auto-Update System](#auto-update-system)
- [Entwicklung](#entwicklung)

---

## Features

### E-Mail-Authentifizierung (DMARC)
- **DMARC-Berichte** analysieren und auswerten — kompatibel, weitergeleitet, fehlgeschlagen
- **Quell-IP-Analyse** mit Pass-Rate, rDNS-Auflösung und Disposition
- **DMARC Score** als Gütegrad (A–F) mit konkreten Empfehlungen
- **Domain-Übersicht** mit Zeitreihen und Trendauswertung
- CSV-Export aller gefilterten Berichte

### TLS-Reporting (TLSRPT)
- Auswertung von RFC-8460-Berichten (MTA-STS, DANE)
- Erfolgs-/Fehler-Rate über Zeit
- Fehlertypen-Aufschlüsselung nach Policy

### Microsoft 365 Integration (Graph API)
- **Secure Score** mit Prozentsatz, Kategorie-Aufschlüsselung, Verlaufsgraph und Vergleich mit ähnlichen Organisationen
- **Mail Flow Analyse** — Spam, Phishing, Malware, Spoofing, Edge Blocks, Quarantäne
- **Sicherheitswarnungen** (Microsoft Defender for Office 365, EOP) mit Schweregrad-Filterung
- **E-Mail-Aktivität** aus Exchange Online

### DNS-Gesundheit
- Automatische tägliche Prüfung von SPF, DKIM, DMARC, MTA-STS, TLSRPT und BIMI
- Ergebnisse pro Domain mit Rohdaten-Anzeige
- Problemzähler und Score (0–6 Checks)

### System
- **Auto-Update** — prüft GitHub Releases und installiert Updates mit einem Klick
- **Dark Mode** mit persistenter Einstellung
- **Mobil-optimiert** — vollständig responsives Design
- **Authentifizierung** via Microsoft Entra ID (OIDC) — kein separates Passwort nötig

---

## Tech Stack

| Bereich | Technologie |
|---|---|
| Backend | Node.js + Express |
| Templates | EJS |
| CSS | Tailwind CSS (CDN) |
| Datenbank | MySQL 8 |
| Auth | OpenID Connect (Microsoft Entra ID) |
| API | Microsoft Graph API |
| Charts | Chart.js |
| Deployment | Docker + 1Panel |

---

## Voraussetzungen

- **Node.js** ≥ 18
- **MySQL** ≥ 8.0 (lokal oder remote)
- **Microsoft 365** Tenant mit Administrator-Zugang
- **Azure App Registration** (App-Berechtigungen, kein Benutzer-Login nötig für Graph-Daten)
- Optional: Docker + 1Panel für Produktivbetrieb

---

## Schnellstart (lokal)

```bash
# 1. Repository klonen
git clone https://github.com/your-username/DMARC-Analyzer-Dashboard.git
cd DMARC-Analyzer-Dashboard

# 2. Abhängigkeiten installieren
npm install

# 3. Konfiguration anlegen
cp .env.example .env
# .env nach eigenen Daten befüllen (siehe Konfiguration)

# 4. Datenbank migrieren (Schema liegt in /dmarc-schema.sql)
mysql -u root -p dmarc < dmarc-schema.sql

# 5. Starten
npm run dev
```

Öffne `http://localhost:3000` — der Login erfolgt über Microsoft Entra ID.

---

## Konfiguration

Alle Einstellungen erfolgen über eine `.env`-Datei (Vorlage: `.env.example`).

### Server

```env
PORT=3000
NODE_ENV=production
BASE_URL=https://dein-dashboard.example.com
SESSION_SECRET=mindestens-32-zeichen-langer-zufallsstring
```

### Datenbank

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=dmarc_user
DB_PASSWORD=sicheres-passwort
DB_NAME=dmarc
```

### Microsoft Entra ID

```env
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=dein-client-secret
AZURE_REDIRECT_URI=https://dein-dashboard.example.com/auth/callback
```

### DNS-Gesundheitsprüfung

```env
# Kommagetrennte Domains die täglich geprüft werden
DNS_CHECK_DOMAINS=example.com,example.de

# DKIM-Selector (Microsoft 365 Standard: selector1)
DNS_CHECK_DKIM_SELECTOR=selector1
```

### Auto-Update

```env
# GitHub-Repository (öffentlich)
GITHUB_REPO=your-username/DMARC-Analyzer-Dashboard

# Modus: disabled | check | auto
UPDATE_MODE=check

# Prüfintervall in Stunden (Standard: 24)
UPDATE_CHECK_INTERVAL=24

# Restart-Methode: docker | pm2 | signal
RESTART_METHOD=docker
```

---

## Azure App Registration

### App anlegen

1. [Azure Portal](https://portal.azure.com) → **Entra ID** → **App-Registrierungen** → **Neue Registrierung**
2. Name vergeben, Kontotyp: *Nur diese Organisation*
3. Redirect URI: `https://dein-dashboard.example.com/auth/callback` (Web)

### API-Berechtigungen (Application, nicht Delegated)

| Berechtigung | Zweck |
|---|---|
| `Reports.Read.All` | Mail-Flow-Berichte, E-Mail-Aktivität |
| `SecurityAlert.Read.All` | Sicherheitswarnungen |
| `SecurityEvents.Read.All` | Microsoft Secure Score |

Alle drei als **Application Permission** hinzufügen und **Admin-Zustimmung erteilen**.

### Client Secret

**Zertifikate & Geheimnisse** → **Neuer geheimer Clientschlüssel** → Wert in `.env` eintragen.

---

## Datenbankschema

Die DMARC-Berichte werden per externem Prozess (z. B. n8n, Postfix-Hook, eigenes Script) in die Datenbank geschrieben. Das Schema erwartet mindestens folgende Tabellen:

- `dmarc_reports` — Einzelberichte mit DKIM/SPF-Ergebnissen, Quell-IP, Disposition
- `tlsrpt_reports` — TLS-Reporting-Berichte (RFC 8460)
- `dns_health_checks` — Tagesaktuell geprüfte DNS-Records je Domain
- `secure_scores` — Snapshots des Microsoft Secure Score
- `mail_flow_stats` — Aggregierte Mail-Flow-Daten
- `email_activity` — E-Mail-Aktivitätsstatistiken
- `security_alerts` — Sicherheitswarnungen aus der Graph API

> Das vollständige Schema inklusive aller Indices und Constraints liegt in `dmarc-schema.sql`.

### Daten abrufen (Graph API)

Der integrierte Scheduler (`src/services/scheduler.js`) ruft täglich automatisch neue Daten ab:

```
Secure Score     → täglich 02:00 Uhr
Mail Flow        → täglich 02:15 Uhr
E-Mail-Aktivität → täglich 02:30 Uhr
Alerts           → täglich 02:45 Uhr
DNS-Health       → täglich 03:00 Uhr
```

Im Dev-Modus (`SHOW_DEV_TOOLS=true`) gibt es in der Sidebar Buttons für manuellen Abruf.

---

## Produktiv-Deployment (Docker / 1Panel)

### Dockerfile (Beispiel)

```dockerfile
FROM node:20-slim

WORKDIR /app

# Systemabhängigkeiten für update.sh
RUN apt-get update && apt-get install -y --no-install-recommends \
    rsync unzip procps \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000
CMD ["node", "src/server.js"]
```

### 1Panel Setup

1. **Container erstellen** mit Restart-Policy `Unless stopped`
2. Port `3000` nach außen mappen (oder über 1Panel Reverse Proxy)
3. Volume für persistente `.env`-Datei
4. Umgebungsvariablen aus `.env` in den Container eintragen

### Reverse Proxy (Nginx / 1Panel)

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## Auto-Update System

Das Dashboard kann sich selbst aktualisieren sobald ein neues GitHub Release veröffentlicht wird.

### Wie es funktioniert

```
Release erstellen (GitHub)
       ↓
GitHub Actions: version.json befüllen + source.zip bauen + hochladen
       ↓
Dashboard: prüft GitHub API (automatisch oder manuell)
       ↓
Update verfügbar → Button "Update installieren"
       ↓
Download → Dateien ersetzen → npm install → Neustart
```

### GitHub Actions einrichten

Die Workflow-Datei liegt bereits unter `.github/workflows/release.yml`. Sie wird automatisch ausgelöst wenn ein Release veröffentlicht wird.

Benötigte Repository-Berechtigung: `contents: write` (ist Standard bei `GITHUB_TOKEN`).

### Release erstellen

1. Im GitHub-Repository: **Releases** → **Draft a new release**
2. Tag nach [Semantic Versioning](https://semver.org) vergeben: `v1.0.0`, `v1.2.3`, …
3. Release **publizieren** → Actions-Workflow erstellt automatisch `source.zip` und hängt es ans Release

### Update-Modi

| `UPDATE_MODE` | Verhalten |
|---|---|
| `disabled` | Kein automatischer Check |
| `check` | Prüft nach Updates, zeigt Badge — manueller Install per Klick |
| `auto` | Prüft und installiert automatisch (empfohlen nur in kontrollierten Umgebungen) |

### Neustart nach Update

| `RESTART_METHOD` | Wann verwenden |
|---|---|
| `docker` | Container-Betrieb (1Panel, Docker Compose) — sendet SIGTERM, Docker startet neu |
| `pm2` | Direktbetrieb mit PM2 als Prozessmanager |
| `signal` | Wie `docker`, liest PID aus `.node-pid`-Datei |

---

## Entwicklung

```bash
# Dev-Server mit Auto-Reload
npm run dev

# Dev-Tools in der Sidebar aktivieren (manuelle Daten-Abruf-Buttons)
SHOW_DEV_TOOLS=true
```

### Projektstruktur

```
├── .github/workflows/    # GitHub Actions (Release-Workflow)
├── public/               # Statische Dateien (CSS, JS, Icons)
├── src/
│   ├── config/           # OIDC-Konfiguration
│   ├── db/               # Datenbankverbindung & Queries
│   ├── middleware/        # Auth-Middleware
│   ├── routes/           # Express-Router
│   ├── services/         # Scheduler, Graph API, Updater
│   └── server.js         # Einstiegspunkt
├── views/
│   ├── dashboard/        # EJS-Templates je Seite
│   └── partials/         # Sidebar, Head-Partial
├── update.sh             # Self-Update-Script (Bash)
├── .env.example          # Konfigurationsvorlage
└── version.json          # Wird von GitHub Actions gesetzt (nicht im Git)
```

### Neue Graph-API-Daten einbinden

1. Fetch-Funktion in `src/services/graphApi.js` ergänzen
2. Scheduler-Eintrag in `src/services/scheduler.js`
3. DB-Query in `src/db/queries.js`
4. Route in `src/routes/dashboard.js`
5. EJS-Template unter `views/dashboard/`

---

## Lizenz

MIT — Details siehe [LICENSE](LICENSE).
