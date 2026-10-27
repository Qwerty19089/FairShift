'use strict';

const { dayKey, HOUR_MS } = require('./shifts');

const DAY_MS = 24 * HOUR_MS;

/**
 * Transparent "needs attention" score (0-100) for retention risk.
 *
 * It is a rule-based heuristic, NOT a black box: every point comes from a named
 * factor that is returned alongside the score so a manager can see *why* and
 * respond supportively (e.g. fix the schedule), never punitively.
 */
const WEIGHTS = Object.freeze({
  fatigue: 30, // critical = 30, warning = 15
  overtime: 20, // scaled by overtime hours in the last 14 days (cap at 20 h)
  absence: 20, // scaled by missed scheduled days in the last 14 days
  siteMorale: 20, // low average rating of the worker's site (1-5 scale)
  unresolvedHazard: 10, // a hazard the worker raised is still open > 7 days
});

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function computeRisk({ worker, shifts, fatigueLevel, siteMoraleAvg, openHazardAgeDays }, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const recent = shifts.filter((s) => s.checkOut && nowMs - new Date(s.checkIn) <= 14 * DAY_MS);

  const factors = [];
  const add = (key, points, detail) => {
    if (points > 0) factors.push({ key, points: Math.round(points), detail });
  };

  add('fatigue', fatigueLevel === 'critical' ? WEIGHTS.fatigue : fatigueLevel === 'warning' ? WEIGHTS.fatigue / 2 : 0, { level: fatigueLevel });

  const otHours = recent.reduce((n, s) => {
    const total = (new Date(s.checkOut) - new Date(s.checkIn)) / HOUR_MS;
    return n + Math.max(0, total - 8);
  }, 0);
  add('overtime', WEIGHTS.overtime * clamp01(otHours / 20), { hours: Math.round(otHours * 10) / 10 });

  // Expected days = scheduled weekdays pattern from the worker's weekly offs.
  const workedDays = new Set(recent.map((s) => dayKey(s.checkIn)));
  let expected = 0;
  for (let i = 1; i <= 14; i++) {
    const d = new Date(nowMs - i * DAY_MS);
    const weekday = new Date(d.getTime() + 5.5 * HOUR_MS).getUTCDay();
    if (!worker.weeklyOff.includes(weekday)) expected++;
  }
  let worked = 0;
  for (let i = 1; i <= 14; i++) {
    if (workedDays.has(dayKey(new Date(nowMs - i * DAY_MS).toISOString()))) worked++;
  }
  const missed = Math.max(0, expected - worked);
  add('absence', WEIGHTS.absence * clamp01(missed / 5), { missedDays: missed });

  if (typeof siteMoraleAvg === 'number') {
    // Averages of 3.5+ stars add no risk; 1 star adds the full weight.
    add('siteMorale', WEIGHTS.siteMorale * clamp01((3.5 - siteMoraleAvg) / 2.5), { average: siteMoraleAvg });
  }

  if (openHazardAgeDays > 7) add('unresolvedHazard', WEIGHTS.unresolvedHazard, { days: openHazardAgeDays });

  const score = Math.min(100, factors.reduce((n, f) => n + f.points, 0));
  const band = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return { score, band, factors };
}

module.exports = { computeRisk, WEIGHTS };
