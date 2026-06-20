'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const updater = require('../services/updater');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.render('dashboard/updates', {
    user: req.session.user,
    current: updater.getCurrentVersion(),
    lastCheck: updater.getLastCheck(),
    log: updater.getUpdateLog(),
    mode: process.env.UPDATE_MODE || 'disabled',
    repo: process.env.GITHUB_REPO || '',
    installing: updater.isInstalling(),
    activePage: 'updates',
  });
});

router.post('/check', async (req, res) => {
  try {
    const result = await updater.checkForUpdates();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/install', async (req, res) => {
  try {
    const check = updater.getLastCheck();
    if (!check) return res.json({ ok: false, error: 'Bitte zuerst nach Updates suchen.' });
    if (!check.hasUpdate) return res.json({ ok: false, error: 'Kein Update verfügbar.' });
    if (!check.downloadUrl) return res.json({ ok: false, error: 'Keine source.zip im Release gefunden. GitHub Actions konfigurieren.' });
    const result = await updater.installUpdate(check.downloadUrl);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
