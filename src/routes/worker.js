'use strict';

const crypto = require('node:crypto');
const express = require('express');

const { requireRole } = require('../auth');
const { cleanText, isRating, rateLimit } = require('../middleware');
const { LANGUAGES } = require('../config');
const { hoursBetween, dayKey, splitHours, withinGeofence } = require('../domain/shifts');
const { buildPayslip } = require('../domain/payslip');
const { evaluateFatigue, worstLevel } = require('../domain/fatigue');
const { isoWeek } = require('../seed');

const CATEGORIES = ['fall', 'electrical', 'fire', 'machinery', 'chemical', 'slip', 'equipment', 'other'];
const SEVERITIES = ['low', 'medium', 'high'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const readPosition = (body) => {
  const lat = Number(body && body.lat);
  const lng = Number(body && body.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

/** Everything a signed-in worker can do. Every route is scoped to req.session.id. */
module.exports = function workerRoutes({ store, clock, tokens }) {
  const router = express.Router();
  router.use(requireRole(tokens, 'worker'));
  const writeLimiter = rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'worker-write' });

  const me = (req) => store.workerById(req.session.id);

  router.get('/me', (req, res) => {
    const worker = me(req);
    const site = store.siteById(worker.siteId);
    const open = store.openShift(worker.id);
    const now = clock();
    const flags = evaluateFatigue(store.shiftsOf(worker.id), now);
    res.json({
      id: worker.id, name: worker.name, role: worker.role, sector: worker.sector, lang: worker.lang,
      site: { id: site.id, name: site.name },
      openShift: open ? { checkIn: open.checkIn, hoursSoFar: hoursBetween(open.checkIn, now.toISOString()) } : null,
      fatigue: { level: worstLevel(flags), flags },
    });
  });

  router.post('/language', writeLimiter, (req, res) => {
    const lang = req.body && req.body.lang;
    if (!LANGUAGES.includes(lang)) return res.status(400).json({ error: 'bad_language' });
    me(req).lang = lang;
    res.json({ lang });
  });

  // ---- 1. Shift tracking ---------------------------------------------------
  router.post('/checkin', writeLimiter, (req, res) => {
    const worker = me(req);
    const site = store.siteByCode(String(req.body && req.body.code || '').replace(/^fairshift:/i, ''));
    if (!site) return res.status(404).json({ error: 'unknown_site_code' });
    if (site.id !== worker.siteId) return res.status(403).json({ error: 'wrong_site' });
    if (store.openShift(worker.id)) return res.status(409).json({ error: 'already_checked_in' });

    const shift = {
      id: store.nextId('SH'),
      workerId: worker.id,
      siteId: site.id,
      checkIn: clock().toISOString(),
      checkOut: null,
      locationVerified: withinGeofence(site, readPosition(req.body)),
    };
    store.shifts.push(shift);
    res.status(201).json({ checkIn: shift.checkIn, locationVerified: shift.locationVerified });
  });

  router.post('/checkout', writeLimiter, (req, res) => {
    const worker = me(req);
    const shift = store.openShift(worker.id);
    if (!shift) return res.status(409).json({ error: 'not_checked_in' });
    shift.checkOut = clock().toISOString();
    const total = hoursBetween(shift.checkIn, shift.checkOut);
    res.json({ checkIn: shift.checkIn, checkOut: shift.checkOut, total, ...splitHours(total, worker.sector) });
  });

  router.get('/shifts', (req, res) => {
    const worker = me(req);
    const recent = store
      .shiftsOf(worker.id)
      .filter((s) => s.checkOut)
      .slice(-14)
      .reverse()
      .map((s) => {
        const total = hoursBetween(s.checkIn, s.checkOut);
        return { date: dayKey(s.checkIn), checkIn: s.checkIn, checkOut: s.checkOut, total, ...splitHours(total, worker.sector) };
      });
    res.json(recent);
  });

  // ---- 2. Clear payslips ---------------------------------------------------
  router.get('/payslip', (req, res) => {
    const month = req.query.month || dayKey(clock().toISOString()).slice(0, 7);
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'bad_month' });
    res.json(buildPayslip(me(req), store.shiftsOf(req.session.id), month));
  });

  // ---- 6. Fatigue alerts ---------------------------------------------------
  router.get('/fatigue', (req, res) => {
    const flags = evaluateFatigue(store.shiftsOf(req.session.id), clock());
    res.json({ level: worstLevel(flags), flags });
  });

  // ---- 3. Safety reporting -------------------------------------------------
  router.post('/reports', writeLimiter, (req, res) => {
    const worker = me(req);
    const { category, severity, anonymous } = req.body || {};
    const description = cleanText(req.body && req.body.description, 500);
    if (!CATEGORIES.includes(category) || !SEVERITIES.includes(severity) || description.length < 3) {
      return res.status(400).json({ error: 'invalid_report' });
    }
    const now = clock().toISOString();
    const report = {
      id: store.nextId('R'),
      code: store.newTrackingCode(),
      siteId: worker.siteId,
      category, severity, description,
      status: 'open',
      reporterId: anonymous === false ? worker.id : null, // anonymous unless the worker opts in
      createdAt: now,
      updatedAt: now,
      history: [{ status: 'open', at: now, note: '' }],
    };
    store.reports.push(report);
    res.status(201).json({ code: report.code });
  });

  router.get('/reports', (req, res) => {
    const mine = store.reports.filter((r) => r.reporterId === req.session.id);
    res.json(mine.map(({ code, category, severity, status, createdAt }) => ({ code, category, severity, status, createdAt })));
  });

  // ---- 4. Honest, anonymous feedback --------------------------------------
  router.post('/feedback', writeLimiter, (req, res) => {
    const worker = me(req);
    const { manager, conditions, safety } = req.body || {};
    if (![manager, conditions, safety].every(isRating)) return res.status(400).json({ error: 'invalid_ratings' });

    const week = isoWeek(clock());
    const guardKey = `${worker.id}:${week}`;
    if (store.feedbackSubmitted.has(guardKey)) return res.status(409).json({ error: 'already_submitted' });

    // The stored feedback row carries no worker id; only the guard set knows who submitted.
    store.feedbackSubmitted.add(guardKey);
    store.feedback.push({
      id: store.nextId('F'),
      siteId: worker.siteId,
      ratings: { manager, conditions, safety },
      comment: cleanText(req.body.comment, 280),
      week,
      createdAt: clock().toISOString(),
    });
    res.status(201).json({ ok: true });
  });

  // ---- 5. Skill passport ---------------------------------------------------
  router.get('/passport', (req, res) => {
    const token = [...store.shareTokens].find(([, id]) => id === req.session.id);
    res.json({
      credentials: store.credentialsOf(req.session.id),
      shareToken: token ? token[0] : null,
    });
  });

  router.post('/passport', writeLimiter, (req, res) => {
    const title = cleanText(req.body && req.body.title, 80);
    const issuer = cleanText(req.body && req.body.issuer, 80);
    const issuedOn = req.body && req.body.issuedOn;
    if (!title || !DATE_RE.test(issuedOn || '')) return res.status(400).json({ error: 'invalid_credential' });
    const credential = {
      id: store.nextId('C'), workerId: req.session.id, title, issuer: issuer || '-',
      issuedOn, expiresOn: null, verified: false, // self-declared until an employer verifies it
    };
    store.credentials.push(credential);
    res.status(201).json(credential);
  });

  router.post('/passport/share', writeLimiter, (req, res) => {
    for (const [token, id] of store.shareTokens) if (id === req.session.id) return res.json({ token });
    const token = crypto.randomBytes(18).toString('base64url');
    store.shareTokens.set(token, req.session.id);
    res.status(201).json({ token });
  });

  router.delete('/passport/share', (req, res) => {
    for (const [token, id] of store.shareTokens) if (id === req.session.id) store.shareTokens.delete(token);
    res.json({ ok: true });
  });

  return router;
};

module.exports.CATEGORIES = CATEGORIES;
module.exports.SEVERITIES = SEVERITIES;
