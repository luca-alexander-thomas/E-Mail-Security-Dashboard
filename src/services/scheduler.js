const cron = require('node-cron');
const { fetchSecureScore, fetchMailFlow, fetchEmailActivity, fetchAlerts } = require('./graphApi');
const { runDnsHealthChecks } = require('./dnsHealth');

function wrap(name, fn) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[Scheduler] ${name} fehlgeschlagen:`, err.message);
    }
  };
}

async function runNow(service = 'all') {
  const jobs = {
    securescore:   () => wrap('Secure Score (manuell)',    fetchSecureScore)(),
    mailflow:      () => wrap('Mail Flow (manuell)',       fetchMailFlow)(),
    emailactivity: () => wrap('Email Activity (manuell)', fetchEmailActivity)(),
    alerts:        () => wrap('Alerts (manuell)',          fetchAlerts)(),
    dns:           () => wrap('DNS Health (manuell)',      runDnsHealthChecks)(),
  };
  if (service === 'all') {
    return Promise.all(Object.values(jobs).map(fn => fn()));
  }
  if (jobs[service]) return jobs[service]();
  throw new Error(`Unbekannter Service: ${service}`);
}

function startScheduler() {
  // Täglich 06:00 — Secure Score, Mail Flow, Email Activity
  cron.schedule('0 6 * * *', wrap('Secure Score',    fetchSecureScore));
  cron.schedule('0 6 * * *', wrap('Mail Flow',       fetchMailFlow));
  cron.schedule('0 6 * * *', wrap('Email Activity',  fetchEmailActivity));

  // Stündlich — Security Alerts (erfordert SecurityAlert.Read.All)
  cron.schedule('0 * * * *', wrap('Security Alerts', fetchAlerts));

  // Täglich 07:00 — DNS Health (kein API-Key nötig, Cloudflare DoH)
  cron.schedule('0 7 * * *', wrap('DNS Health', runDnsHealthChecks));

  console.log('[Scheduler] Jobs gestartet: Secure Score & Mail Flow 06:00, Alerts stündlich, DNS Health 07:00');
}

module.exports = { startScheduler, runNow };
