'use strict';

const express = require('express');
const { verifyPin } = require('../store');
const { rateLimit } = require('../middleware');
const { LANGUAGES } = require('../config');

/** Routes that need no session: health, login, anonymous report tracking, shared passports. */
module.exports = function publicRoutes({ config, store, tokens }) {
  const router = express.Router();
  const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'login' });

  router.get('/health', (req, res) => res.json({ ok: true }));

  router.get('/config', (req, res) => {
    res.json({ demoMode: config.demoMode, languages: LANGUAGES });
  });

  router.post('/login', loginLimiter, (req, res) => {
    const { id, pin, demo } = req.body || {};
    let user = null;
    let role = null;

    if (config.demoMode && (demo === 'worker' || demo === 'admin')) {
      // One-tap demo access for reviewers. Only available when DEMO_MODE=true.
      const demoId = typeof id === 'string' && store.workerById(id) && demo === 'worker' ? id : null;
      user = demo === 'admin' ? store.admins[0] : store.workerById(demoId) || store.workers[0];
      role = demo;
    } else if (typeof id === 'string' && typeof pin === 'string') {
      const worker = store.workerById(id);
      const admin = store.adminById(id);
      const candidate = worker || admin;
      if (candidate && verifyPin(pin, candidate.pinHash)) {
        user = candidate;
        role = worker ? 'worker' : 'admin';
      }
    }

    if (!user) return res.status(401).json({ error: 'invalid_credentials' });
    res.json({
      token: tokens.issue(user.id, role),
      role,
      user: { id: user.id, name: user.name, lang: user.lang },
    });
  });

  // Demo-only: lists seeded workers so reviewers can pick a sector to explore.
  router.get('/demo/workers', (req, res) => {
    if (!config.demoMode) return res.status(404).json({ error: 'not_found' });
    res.json(
      store.workers.map((w) => ({ id: w.id, name: w.name, role: w.role, sector: w.sector, lang: w.lang })),
    );
  });

  // Anyone holding a tracking code can follow a hazard report - no login, no identity.
  router.get('/reports/track/:code', (req, res) => {
    const report = store.reportByCode(req.params.code);
    if (!report) return res.status(404).json({ error: 'not_found' });
    const site = store.siteById(report.siteId);
    res.json({
      code: report.code,
      category: report.category,
      severity: report.severity,
      status: report.status,
      siteName: site ? site.name : '',
      createdAt: report.createdAt,
      history: report.history.map(({ status, at, note }) => ({ status, at, note })),
    });
  });

  // Read-only skill passport a worker chose to share (e.g. with a new employer).
  router.get('/passport/:token', (req, res) => {
    const workerId = store.shareTokens.get(req.params.token);
    const worker = workerId && store.workerById(workerId);
    if (!worker) return res.status(404).json({ error: 'not_found' });
    res.json({
      name: worker.name,
      role: worker.role,
      sector: worker.sector,
      credentials: store.credentialsOf(worker.id).map(({ title, issuer, issuedOn, expiresOn, verified }) => ({
        title, issuer, issuedOn, expiresOn, verified,
      })),
    });
  });

  return router;
};
