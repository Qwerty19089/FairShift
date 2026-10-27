'use strict';

const { MIN_FEEDBACK_GROUP } = require('../config');
const { hoursBetween, dayKey, HOUR_MS } = require('./shifts');
const { evaluateFatigue, worstLevel } = require('./fatigue');
const { computeRisk } = require('./risk');

const DAY_MS = 24 * HOUR_MS;
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Aggregate anonymous feedback per site. A site's numbers and comments are
 * withheld until MIN_FEEDBACK_GROUP responses exist, so one worker can never be
 * singled out by a small group size.
 */
function feedbackSummary(feedback, siteId) {
  const rows = feedback.filter((f) => f.siteId === siteId);
  if (rows.length < MIN_FEEDBACK_GROUP) {
    return { siteId, count: rows.length, hidden: true, minGroup: MIN_FEEDBACK_GROUP };
  }
  const avg = (key) => round1(rows.reduce((n, r) => n + r.ratings[key], 0) / rows.length);
  const averages = { manager: avg('manager'), conditions: avg('conditions'), safety: avg('safety') };
  return {
    siteId,
    count: rows.length,
    hidden: false,
    averages,
    overall: round1((averages.manager + averages.conditions + averages.safety) / 3),
    comments: rows.filter((r) => r.comment).map((r) => r.comment),
  };
}

/** People per day with a recorded check-in, for the last `days` days (oldest first). */
function attendanceTrend(shifts, workerIds, now, days = 14) {
  const ids = new Set(workerIds);
  const perDay = new Map();
  for (const s of shifts) {
    if (!ids.has(s.workerId)) continue;
    const key = dayKey(s.checkIn);
    if (!perDay.has(key)) perDay.set(key, new Set());
    perDay.get(key).add(s.workerId);
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(new Date(new Date(now).getTime() - i * DAY_MS).toISOString());
    out.push({ date: key, present: perDay.get(key)?.size || 0 });
  }
  return out;
}

function overtimeHoursLast7(shifts, workerIds, now) {
  const ids = new Set(workerIds);
  let total = 0;
  for (const s of shifts) {
    if (!ids.has(s.workerId) || !s.checkOut) continue;
    if (new Date(now) - new Date(s.checkIn) > 7 * DAY_MS) continue;
    total += Math.max(0, hoursBetween(s.checkIn, s.checkOut) - 8);
  }
  return round1(total);
}

/** Open hazard age in whole days for the oldest unresolved report raised by this worker. */
function oldestOpenHazardDays(reports, workerId, now) {
  const mine = reports.filter((r) => r.reporterId === workerId && r.status !== 'resolved');
  if (!mine.length) return 0;
  return Math.floor((new Date(now) - Math.min(...mine.map((r) => new Date(r.createdAt)))) / DAY_MS);
}

/** Everything the admin dashboard needs, optionally filtered to one sector. */
function buildDashboard(store, { sector = null, now = new Date() } = {}) {
  const sites = store.sites.filter((s) => !sector || s.sector === sector);
  const siteIds = new Set(sites.map((s) => s.id));
  const workers = store.workers.filter((w) => siteIds.has(w.siteId));
  const workerIds = workers.map((w) => w.id);
  const reports = store.reports.filter((r) => siteIds.has(r.siteId));

  const feedback = sites.map((s) => ({ ...feedbackSummary(store.feedback, s.id), siteName: s.name }));
  const moraleBySite = new Map(feedback.filter((f) => !f.hidden).map((f) => [f.siteId, f.overall]));

  const people = workers.map((w) => {
    const shifts = store.shiftsOf(w.id);
    const flags = evaluateFatigue(shifts, now);
    const fatigueLevel = worstLevel(flags);
    const risk = computeRisk(
      {
        worker: w,
        shifts,
        fatigueLevel,
        siteMoraleAvg: moraleBySite.get(w.siteId),
        openHazardAgeDays: oldestOpenHazardDays(store.reports, w.id, now),
      },
      now,
    );
    const open = store.openShift(w.id);
    return {
      id: w.id, name: w.name, role: w.role, sector: w.sector, siteId: w.siteId,
      onShift: Boolean(open), fatigueLevel, fatigueFlags: flags, risk,
    };
  });

  const todayKey = dayKey(new Date(now).toISOString());
  const presentToday = new Set(
    store.shifts.filter((s) => workerIds.includes(s.workerId) && dayKey(s.checkIn) === todayKey).map((s) => s.workerId),
  ).size;

  return {
    generatedAt: new Date(now).toISOString(),
    sector,
    kpis: {
      workers: workers.length,
      presentToday,
      onShiftNow: people.filter((p) => p.onShift).length,
      overtimeHours7d: overtimeHoursLast7(store.shifts, workerIds, now),
      openHazards: reports.filter((r) => r.status !== 'resolved').length,
      fatigueAlerts: people.filter((p) => p.fatigueLevel !== 'ok').length,
      highRisk: people.filter((p) => p.risk.band === 'high').length,
    },
    attendance: attendanceTrend(store.shifts, workerIds, now),
    people: people.sort((a, b) => b.risk.score - a.risk.score),
    feedback,
    sites: sites.map(({ id, name, sector: sec, code }) => ({ id, name, sector: sec, code })),
  };
}

module.exports = { buildDashboard, feedbackSummary, attendanceTrend, overtimeHoursLast7 };
