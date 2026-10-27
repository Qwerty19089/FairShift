'use strict';

const { FATIGUE } = require('../config');
const { hoursBetween, dayKey, HOUR_MS } = require('./shifts');

const DAY_MS = 24 * HOUR_MS;

/**
 * Evaluate fatigue risk for one worker from their completed shifts.
 * Returns a list of flags, each { code, level: 'warning'|'critical', value }.
 * `now` is injectable so the logic is deterministic under test.
 */
function evaluateFatigue(shifts, now = new Date()) {
  const done = shifts
    .filter((s) => s.checkOut)
    .sort((a, b) => new Date(a.checkIn) - new Date(b.checkIn));
  const flags = [];
  const nowMs = new Date(now).getTime();

  // 1. Longest shift in the last 7 days
  const lastWeek = done.filter((s) => nowMs - new Date(s.checkIn) <= 7 * DAY_MS);
  const longest = lastWeek.reduce((m, s) => Math.max(m, hoursBetween(s.checkIn, s.checkOut)), 0);
  if (longest >= FATIGUE.longShiftCriticalHours) flags.push({ code: 'longShift', level: 'critical', value: longest });
  else if (longest >= FATIGUE.longShiftWarnHours) flags.push({ code: 'longShift', level: 'warning', value: longest });

  // 2. Weekly total (rolling 7 days)
  const weekly = lastWeek.reduce((n, s) => n + hoursBetween(s.checkIn, s.checkOut), 0);
  const weeklyRounded = Math.round(weekly * 10) / 10;
  if (weekly > FATIGUE.weeklyCriticalHours) flags.push({ code: 'weeklyHours', level: 'critical', value: weeklyRounded });
  else if (weekly > FATIGUE.weeklyWarnHours) flags.push({ code: 'weeklyHours', level: 'warning', value: weeklyRounded });

  // 3. Shortest rest between back-to-back shifts in the last 7 days
  let minRest = Infinity;
  for (let i = 1; i < lastWeek.length; i++) {
    const rest = hoursBetween(lastWeek[i - 1].checkOut, lastWeek[i].checkIn);
    minRest = Math.min(minRest, rest);
  }
  if (minRest < FATIGUE.minRestHours) {
    flags.push({ code: 'shortRest', level: minRest < FATIGUE.minRestHours / 2 ? 'critical' : 'warning', value: minRest });
  }

  // 4. Consecutive working days ending today or yesterday
  const workedDays = new Set(done.map((s) => dayKey(s.checkIn)));
  let streak = 0;
  let cursor = nowMs;
  if (!workedDays.has(dayKey(new Date(cursor).toISOString()))) cursor -= DAY_MS;
  while (workedDays.has(dayKey(new Date(cursor).toISOString()))) {
    streak++;
    cursor -= DAY_MS;
  }
  if (streak >= FATIGUE.consecutiveDaysCritical) flags.push({ code: 'noRestDay', level: 'critical', value: streak });
  else if (streak >= FATIGUE.consecutiveDaysWarn) flags.push({ code: 'noRestDay', level: 'warning', value: streak });

  return flags;
}

/** The worst level across a set of flags: 'critical' | 'warning' | 'ok'. */
function worstLevel(flags) {
  if (flags.some((f) => f.level === 'critical')) return 'critical';
  if (flags.length) return 'warning';
  return 'ok';
}

module.exports = { evaluateFatigue, worstLevel };
