const express = require('express');
const dns     = require('dns').promises;
const { requireAuth } = require('../middleware/auth');
const q = require('../db/queries');
const { runNow } = require('../services/scheduler');

const router = express.Router();
router.use(requireAuth);

// ─── DMARC ────────────────────────────────────────────────────────────────────

router.get('/stats', async (req, res, next) => {
  try { res.json(await q.getOverview(parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

router.get('/timeline', async (req, res, next) => {
  try { res.json(await q.getTimeline(parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

router.get('/sources', async (req, res, next) => {
  try {
    const days  = parseInt(req.query.days)  || 30;
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    res.json(await q.getTopSources(limit, days));
  } catch (err) { next(err); }
});

router.get('/organizations', async (req, res, next) => {
  try { res.json(await q.getTopOrganizations(20, parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

router.get('/records', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 25));
    const filters = {
      dkim: req.query.dkim || '', spf: req.query.spf || '',
      disposition: req.query.disposition || '', days: parseInt(req.query.days) || 30,
      search: req.query.search || '', category: req.query.category || '',
    };
    res.json(await q.getRecords({ page, limit, ...filters }));
  } catch (err) { next(err); }
});

router.get('/categories', async (req, res, next) => {
  try { res.json(await q.getSourceCategories(parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

router.get('/score', async (req, res, next) => {
  try { res.json(await q.getSecurityScore(parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

router.get('/trend', async (req, res, next) => {
  try { res.json(await q.getTrend(parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

router.get('/export', async (req, res, next) => {
  if (req.session?.user?.role !== 'admin') return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const filters = {
      dkim: req.query.dkim || '', spf: req.query.spf || '',
      disposition: req.query.disposition || '', days: parseInt(req.query.days) || 30,
      search: req.query.search || '', category: req.query.category || '',
    };
    const rows = await q.getExportData(filters);
    const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
    const header = ['ID', 'Organisation', 'Domain', 'Quell-IP', 'Datum von', 'Datum bis', 'Anzahl', 'DKIM', 'SPF', 'Disposition'];
    const csv = [
      header.join(','),
      ...rows.map(r => [
        r.id, escape(r.org_name), escape(r.domain), r.source_ip,
        r.date_range_begin instanceof Date ? r.date_range_begin.toISOString() : r.date_range_begin,
        r.date_range_end   instanceof Date ? r.date_range_end.toISOString()   : r.date_range_end,
        r.mail_count, r.evaluated_dkim, r.evaluated_spf, r.evaluated_disposition,
      ].join(',')),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dmarc-export.csv"');
    res.send('﻿' + csv);
  } catch (err) { next(err); }
});

// ─── TLSRPT ───────────────────────────────────────────────────────────────────

router.get('/tlsrpt/stats', async (req, res, next) => {
  try { res.json(await q.getTlsrptStats(parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

router.get('/tlsrpt/timeline', async (req, res, next) => {
  try { res.json(await q.getTlsrptTimeline(parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

router.get('/tlsrpt/records', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    res.json(await q.getTlsrptRecords({ page, limit, days: parseInt(req.query.days) || 30, domain: req.query.domain || '' }));
  } catch (err) { next(err); }
});

router.get('/tlsrpt/failure-types', async (req, res, next) => {
  try { res.json(await q.getTlsrptFailureTypes(parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

// ─── Security Score ────────────────────────────────────────────────────────────

router.get('/security-score', async (req, res, next) => {
  try { res.json(await q.getLatestSecurityScore()); } catch (err) { next(err); }
});

router.get('/security-score/history', async (req, res, next) => {
  try { res.json(await q.getSecurityScoreHistory(parseInt(req.query.days) || 90)); } catch (err) { next(err); }
});

// ─── Mail Flow ─────────────────────────────────────────────────────────────────

router.get('/mail-flow', async (req, res, next) => {
  try { res.json(await q.getMailFlowStats(parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

router.get('/mail-flow/timeline', async (req, res, next) => {
  try { res.json(await q.getMailFlowTimeline(parseInt(req.query.days) || 30)); } catch (err) { next(err); }
});

// ─── Alerts ────────────────────────────────────────────────────────────────────

router.get('/alerts/stats', async (req, res, next) => {
  try { res.json(await q.getAlertStats()); } catch (err) { next(err); }
});

router.get('/alerts', async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const limit    = Math.min(100, parseInt(req.query.limit) || 25);
    res.json(await q.getAlerts({
      page, limit,
      severity: req.query.severity || '',
      status:   req.query.status   || '',
      category: req.query.category || '',
    }));
  } catch (err) { next(err); }
});

// ─── DNS Health ───────────────────────────────────────────────────────────────

router.get('/dns-health', async (req, res, next) => {
  try { res.json(await q.getLatestDnsHealth()); } catch (err) { next(err); }
});

router.get('/dns-health/history', async (req, res, next) => {
  try {
    const domain = req.query.domain || '';
    if (!domain) return res.json([]);
    res.json(await q.getDnsHealthHistory(domain, parseInt(req.query.days) || 30));
  } catch (err) { next(err); }
});

// ─── Admin / Manueller Refresh ────────────────────────────────────────────────

router.post('/admin/refresh', async (req, res) => {
  if (req.session?.user?.role !== 'admin') return res.status(403).json({ error: 'Kein Zugriff' });
  const service = req.query.service || req.body?.service || 'all';
  const valid = ['all', 'securescore', 'mailflow', 'emailactivity', 'alerts', 'dns'];
  if (!valid.includes(service)) return res.status(400).json({ error: 'Ungültiger Service' });
  runNow(service).catch(e => console.error('[Refresh]', e.message));
  res.json({ started: true, service });
});

// ─── Reverse DNS ──────────────────────────────────────────────────────────────

const rdnsCache = new Map();
router.get('/rdns/:ip', async (req, res) => {
  const ip = req.params.ip;
  if (!/^[\d.a-fA-F:]+$/.test(ip)) return res.json({ hostname: null });
  if (rdnsCache.has(ip)) return res.json({ hostname: rdnsCache.get(ip) });
  try {
    const hostnames = await dns.reverse(ip);
    const hostname  = hostnames[0] || null;
    rdnsCache.set(ip, hostname);
    if (rdnsCache.size > 500) rdnsCache.delete(rdnsCache.keys().next().value);
    res.json({ hostname });
  } catch {
    rdnsCache.set(ip, null);
    res.json({ hostname: null });
  }
});

module.exports = router;
