const pool = require('../config/database');

const TOKEN_URL = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`;

async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token-Anfrage fehlgeschlagen (${res.status}): ${text}`);
  }
  return (await res.json()).access_token;
}

async function fetchSecureScore() {
  const token = await getToken();
  const res = await fetch(
    'https://graph.microsoft.com/v1.0/security/secureScores?$top=1&$orderby=createdDateTime desc',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Secure Score (${res.status}): ${body.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const s = data.value?.[0];
  if (!s) { console.log('[GraphAPI] Secure Score: keine Daten'); return; }

  const percentage = s.maxScore > 0 ? Math.round(s.currentScore / s.maxScore * 10000) / 100 : 0;
  const avgScore = (s.averageComparativeScores || []).find(x => x.basis === 'AllTenants')?.averageScore ?? 0;

  await pool.execute(
    `INSERT INTO security_scores
       (score_date, current_score, max_score, percentage, avg_comparable_score, licensed_user_count, active_user_count, control_scores)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       current_score=VALUES(current_score), max_score=VALUES(max_score), percentage=VALUES(percentage),
       avg_comparable_score=VALUES(avg_comparable_score), licensed_user_count=VALUES(licensed_user_count),
       active_user_count=VALUES(active_user_count), control_scores=VALUES(control_scores)`,
    [
      s.createdDateTime.substring(0, 10),
      s.currentScore, s.maxScore, percentage, avgScore,
      s.licensedUserCount ?? 0, s.activeUserCount ?? 0,
      JSON.stringify(s.controlScores || []),
    ]
  );
  console.log(`[GraphAPI] Secure Score: ${s.currentScore}/${s.maxScore} (${percentage}%)`);
}

async function fetchMailFlow() {
  const token = await getToken();
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/reports/getMailFlowStatusReport(period='D7')",
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'follow' }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Mail Flow (${res.status}): ${body.error?.message || res.statusText}`);
  }

  const ct = res.headers.get('content-type') || '';
  let rows = [];

  if (ct.includes('application/json')) {
    const data = await res.json();
    rows = data.value || (Array.isArray(data) ? data : []);
  } else {
    const text = await res.text();
    const lines = text.replace(/^﻿/, '').trim().split('\n').filter(Boolean);
    if (lines.length < 2) { console.log('[GraphAPI] Mail Flow: keine CSV-Daten'); return; }
    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      return Object.fromEntries(header.map((h, i) => [h, vals[i] || '0']));
    });
  }

  if (!rows.length) { console.log('[GraphAPI] Mail Flow: keine Daten'); return; }

  let saved = 0;
  for (const r of rows) {
    const date = (r.reportRefreshDate || r['Report Refresh Date'] || r.Date || '').substring(0, 10);
    const direction = r.mailFlowDirection || r['Mail Flow Direction'] || r.Direction || 'Inbound';
    if (!date) continue;
    await pool.execute(
      `INSERT INTO mail_flow_stats
         (report_date, direction, good_mail, spam_mail, malware_mail, phish_mail, spoof_mail, edge_block, quarantine)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         good_mail=VALUES(good_mail), spam_mail=VALUES(spam_mail), malware_mail=VALUES(malware_mail),
         phish_mail=VALUES(phish_mail), spoof_mail=VALUES(spoof_mail), edge_block=VALUES(edge_block), quarantine=VALUES(quarantine)`,
      [
        date, direction,
        parseInt(r.good    || r['Good Mail']    || r.GoodMail    || 0),
        parseInt(r.spam    || r['Spam Mail']    || r.SpamMail    || 0),
        parseInt(r.malware || r['Malware Mail'] || r.MalwareMail || 0),
        parseInt(r.phish   || r['Phish Mail']   || r.PhishMail   || 0),
        parseInt(r.spoof   || r['Spoof Mail']   || r.SpoofMail   || 0),
        parseInt(r.edgeBlock || r['Edge Block'] || r.EdgeBlock   || 0),
        parseInt(r.quarantine || r.Quarantine || 0),
      ]
    );
    saved++;
  }
  console.log(`[GraphAPI] Mail Flow: ${saved} Einträge gespeichert`);
}

// getEmailActivityCounts: gesendete/empfangene/gelesene E-Mails der letzten 7 Tage
// Benötigt: Reports.Read.All
async function fetchEmailActivity() {
  const token = await getToken();
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/reports/getEmailActivityCounts(period='D7')",
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'follow' }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Email Activity (${res.status}): ${body.error?.message || res.statusText}`);
  }

  // Antwort kann CSV oder JSON sein je nach Tenant-Konfiguration
  const ct = res.headers.get('content-type') || '';
  let rows = [];

  if (ct.includes('application/json')) {
    const data = await res.json();
    rows = data.value || (Array.isArray(data) ? data : []);
  } else {
    // CSV-Fallback parsen
    const text = await res.text();
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length < 2) { console.log('[GraphAPI] Email Activity: keine CSV-Daten'); return; }
    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      return Object.fromEntries(header.map((h, i) => [h, vals[i] || '0']));
    });
  }

  if (!rows.length) { console.log('[GraphAPI] Email Activity: keine Daten'); return; }

  for (const r of rows) {
    const date = (r.reportRefreshDate || r.Date || r['Report Refresh Date'] || '').substring(0, 10);
    if (!date) continue;
    await pool.execute(
      `INSERT INTO email_activity (report_date, send_count, receive_count, read_count)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE send_count=VALUES(send_count), receive_count=VALUES(receive_count), read_count=VALUES(read_count)`,
      [
        date,
        parseInt(r.send || r.Send || r['Send'] || 0),
        parseInt(r.receive || r.Receive || r['Receive'] || 0),
        parseInt(r.read || r.Read || r['Read'] || 0),
      ]
    );
  }
  console.log(`[GraphAPI] Email Activity: ${rows.length} Tage gespeichert`);
}

async function fetchAlerts() {
  const token = await getToken();
  const res = await fetch(
    'https://graph.microsoft.com/v1.0/security/alerts_v2?$top=100&$orderby=createdDateTime desc',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Alerts (${res.status}): ${body.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const all = data.value || [];
  const alerts = all.filter(a => a.serviceSource !== 'microsoftDefenderForEndpoint');
  if (!alerts.length) { console.log(`[GraphAPI] Alerts: keine Exchange-Alerts (${all.length} MDE gefiltert)`); return; }

  for (const a of alerts) {
    const toMysql = s => s ? s.replace('T', ' ').replace('Z', '').substring(0, 19) : null;
    await pool.execute(
      `INSERT INTO security_alerts
         (alert_id, title, category, severity, status, alert_created, alert_modified,
          description, product_name, service_source, evidence, user_states, host_states)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), category=VALUES(category), severity=VALUES(severity),
         status=VALUES(status), alert_modified=VALUES(alert_modified),
         description=VALUES(description), service_source=VALUES(service_source)`,
      [
        a.id,
        a.title || null,
        a.category || null,
        a.severity || 'unknown',
        a.status || 'new',
        toMysql(a.createdDateTime),
        toMysql(a.lastModifiedDateTime),
        (a.description || '').substring(0, 2000) || null,
        a.productName || null,
        a.serviceSource || null,
        a.evidence ? JSON.stringify(a.evidence) : null,
        (a.userStates || a.actors) ? JSON.stringify(a.userStates || a.actors) : null,
        (a.hostStates || a.assets) ? JSON.stringify(a.hostStates || a.assets) : null,
      ]
    );
  }
  console.log(`[GraphAPI] Alerts: ${alerts.length} gespeichert`);
}

async function checkUserGroups(userId, groupIds) {
  if (!userId || !groupIds || groupIds.length === 0) return [];
  const token = await getToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${userId}/checkMemberGroups`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ groupIds }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`checkMemberGroups (${res.status}): ${body.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return data.value || [];
}

module.exports = { fetchSecureScore, fetchMailFlow, fetchEmailActivity, fetchAlerts, checkUserGroups };
