'use strict';

const express = require('express');
const qrcode = require('qrcode-generator');

const { requireRole } = require('../auth');
const { cleanText, rateLimit } = require('../middleware');
const { SECTORS } = require('../config');
const { buildDashboard } = require('../domain/insights');

const STATUSES = ['open', 'in_review', 'resolved'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function qrDataUrl(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 4); // GIF data URL; allowed by the CSP (img-src data:)
}

/** Employer / admin interface. All routes require an admin session. */
module.exports = function adminRoutes({ store, clock, tokens }) {
  const router = express.Router();
  router.use(requireRole(tokens, 'admin'));
  const writeLimiter = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'admin-write' });

  const sectorFilter = (req) => (SECTORS[req.query.sector] ? req.query.sector : null);

  // ---- 7. Admin dashboard --------------------------------------------------
  router.get('/dashboard', (req, res) => {
    res.json(buildDashboard(store, { sector: sectorFilter(req), now: clock() }));
  });

  router.get('/workers/:id', (req, res) => {
    const dash = buildDashboard(store, { now: clock() });
    const person = dash.people.find((p) => p.id === req.params.id);
    if (!person) return res.status(404).json({ error: 'not_found' });
    res.json({ ...person, credentials: store.credentialsOf(person.id) });
  });

  router.get('/reports', (req, res) => {
    const sector = sectorFilter(req);
    const order = { high: 0, medium: 1, low: 2 };
    const rows = store.reports
      .filter((r) => !sector || store.siteById(r.siteId).sector === sector)
      .map((r) => ({
        id: r.id, code: r.code, siteName: store.siteById(r.siteId).name, category: r.category,
        severity: r.severity, description: r.description, status: r.status,
        createdAt: r.createdAt, anonymous: r.reporterId === null, history: r.history,
      }))
      .sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved') || order[a.severity] - order[b.severity]);
    res.json(rows);
  });

  router.patch('/reports/:id', writeLimiter, (req, res) => {
    const report = store.reports.find((r) => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: 'not_found' });
    const status = req.body && req.body.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'bad_status' });
    const now = clock().toISOString();
    report.status = status;
    report.updatedAt = now;
    report.history.push({ status, at: now, note: cleanText(req.body.note, 200) });
    res.json({ id: report.id, status });
  });

  // ---- Skill passport: employers can verify / issue credentials -----------
  router.post('/credentials', writeLimiter, (req, res) => {
    const { workerId, issuedOn, expiresOn } = req.body || {};
    const title = cleanText(req.body && req.body.title, 80);
    const issuer = cleanText(req.body && req.body.issuer, 80);
    if (!store.workerById(workerId) || !title || !DATE_RE.test(issuedOn || '')) {
      return res.status(400).json({ error: 'invalid_credential' });
    }
    if (expiresOn && !DATE_RE.test(expiresOn)) return res.status(400).json({ error: 'invalid_credential' });
    const credential = {
      id: store.nextId('C'), workerId, title, issuer: issuer || '-',
      issuedOn, expiresOn: expiresOn || null, verified: true,
    };
    store.credentials.push(credential);
    res.status(201).json(credential);
  });

  router.patch('/credentials/:id/verify', writeLimiter, (req, res) => {
    const credential = store.credentials.find((c) => c.id === req.params.id);
    if (!credential) return res.status(404).json({ error: 'not_found' });
    credential.verified = true;
    res.json(credential);
  });

  // ---- Shift tracking: printable check-in QR for each site ----------------
  router.get('/sites/:id/qr', (req, res) => {
    const site = store.siteById(req.params.id);
    if (!site) return res.status(404).json({ error: 'not_found' });
    res.json({ name: site.name, code: site.code, dataUrl: qrDataUrl(`fairshift:${site.code}`) });
  });

  return router;
};
