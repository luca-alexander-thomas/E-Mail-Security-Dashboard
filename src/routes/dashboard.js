const express = require('express');
const { requireAuth } = require('../middleware/auth');
const q = require('../db/queries');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const [
      overview, timeline, topSources, topOrgs, domains, categories, trend, score,
      secureScore, dnsHealth, alertStats, emailActivity, tlsrptStats, mailFlowStats,
    ] = await Promise.all([
      q.getOverview(days), q.getTimeline(days), q.getTopSources(10, days),
      q.getTopOrganizations(10, days), q.getDomains(days), q.getSourceCategories(days),
      q.getTrend(days), q.getSecurityScore(days),
      q.getLatestSecurityScore().catch(() => null),
      q.getLatestDnsHealth().catch(() => []),
      q.getAlertStats().catch(() => ({ total: 0, bySeverity: {} })),
      q.getEmailActivityStats(7).catch(() => null),
      q.getTlsrptStats(days).catch(() => null),
      q.getMailFlowStats(days).catch(() => null),
    ]);
    res.render('dashboard/index', {
      user: req.session.user, overview, timeline: JSON.stringify(timeline),
      topSources, topOrgs, domains, categories, trend, score, days,
      secureScore, dnsHealth, alertStats, emailActivity, tlsrptStats, mailFlowStats,
      activePage: 'dashboard',
    });
  } catch (err) { next(err); }
});

router.get('/reports', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 25));
    const filters = {
      dkim: req.query.dkim || '', spf: req.query.spf || '',
      disposition: req.query.disposition || '', days: parseInt(req.query.days) || 30,
      search: req.query.search || '', category: req.query.category || '',
    };
    const [{ records, total }, categories] = await Promise.all([
      q.getRecords({ page, limit, ...filters }),
      q.getSourceCategories(filters.days),
    ]);
    res.render('dashboard/reports', {
      user: req.session.user, records, total, page, limit,
      totalPages: Math.ceil(total / limit), filters, categories, activePage: 'reports',
    });
  } catch (err) { next(err); }
});

router.get('/reports/:id', async (req, res, next) => {
  try {
    const report = await q.getReportById(parseInt(req.params.id));
    if (!report) return res.status(404).render('error', { message: 'Bericht nicht gefunden', user: req.session.user });
    res.render('dashboard/report-detail', { user: req.session.user, report, activePage: 'reports' });
  } catch (err) { next(err); }
});

router.get('/sources', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const [sources, timeline] = await Promise.all([q.getTopSources(50, days), q.getTimeline(days)]);
    res.render('dashboard/sources', {
      user: req.session.user, sources, sourcesTimeline: JSON.stringify(timeline), days, activePage: 'sources',
    });
  } catch (err) { next(err); }
});

router.get('/tlsrpt', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const [stats, timeline, { records, total }, failureTypes] = await Promise.all([
      q.getTlsrptStats(days),
      q.getTlsrptTimeline(days),
      q.getTlsrptRecords({ page, limit, days, domain: req.query.domain || '' }),
      q.getTlsrptFailureTypes(days),
    ]);
    res.render('dashboard/tlsrpt', {
      user: req.session.user, stats, timeline: JSON.stringify(timeline),
      records, total, page, limit, totalPages: Math.ceil(total / limit),
      failureTypes, days, domain: req.query.domain || '', activePage: 'tlsrpt',
    });
  } catch (err) { next(err); }
});

router.get('/security-score', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const [latest, history] = await Promise.all([
      q.getLatestSecurityScore(),
      q.getSecurityScoreHistory(days),
    ]);
    res.render('dashboard/security-score', {
      user: req.session.user, latest, history: JSON.stringify(history), days, activePage: 'security-score',
    });
  } catch (err) { next(err); }
});

router.get('/mail-flow', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const [stats, timeline, emailActivity] = await Promise.all([
      q.getMailFlowStats(days),
      q.getMailFlowTimeline(days),
      q.getEmailActivityStats(days),
    ]);
    res.render('dashboard/mail-flow', {
      user: req.session.user, stats, timeline: JSON.stringify(timeline),
      emailActivity, days, activePage: 'mail-flow',
    });
  } catch (err) { next(err); }
});

router.get('/alerts', async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const limit    = 25;
    const severity = req.query.severity || '';
    const status   = req.query.status   || '';
    const category = req.query.category || '';
    const [alertStats, { records, total }] = await Promise.all([
      q.getAlertStats(),
      q.getAlerts({ page, limit, severity, status, category }),
    ]);
    res.render('dashboard/alerts', {
      user: req.session.user, alertStats, records, total, page, limit,
      totalPages: Math.ceil(total / limit),
      filters: { severity, status, category }, activePage: 'alerts',
    });
  } catch (err) { next(err); }
});

router.get('/dns-health', async (req, res, next) => {
  try {
    const latest = await q.getLatestDnsHealth();
    res.render('dashboard/dns-health', {
      user: req.session.user, latest, activePage: 'dns-health',
    });
  } catch (err) { next(err); }
});

module.exports = router;
