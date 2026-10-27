'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { hoursBetween, dayKey, splitHours, distanceMeters, withinGeofence } = require('../src/domain/shifts');
const { buildPayslip } = require('../src/domain/payslip');
const { evaluateFatigue, worstLevel } = require('../src/domain/fatigue');
const { computeRisk } = require('../src/domain/risk');
const { feedbackSummary } = require('../src/domain/insights');
const { createTokenService } = require('../src/auth');
const { hashPin, verifyPin } = require('../src/store');

const NOW = new Date('2026-10-27T06:00:00Z');
const iso = (s) => new Date(s).toISOString();
const shift = (workerId, inAt, outAt) => ({ workerId, checkIn: iso(inAt), checkOut: outAt ? iso(outAt) : null });

test('hoursBetween rounds and guards bad input', () => {
  assert.equal(hoursBetween('2026-10-01T08:00:00Z', '2026-10-01T16:30:00Z'), 8.5);
  assert.equal(hoursBetween('2026-10-01T16:00:00Z', '2026-10-01T08:00:00Z'), 0);
  assert.equal(hoursBetween('nope', 'nope'), 0);
});

test('dayKey uses IST so a late-evening UTC shift lands on the next Indian day', () => {
  assert.equal(dayKey('2026-10-01T20:00:00Z'), '2026-10-02');
  assert.equal(dayKey('2026-10-01T10:00:00Z'), '2026-10-01');
});

test('splitHours computes automatic overtime above the daily standard', () => {
  assert.deepEqual(splitHours(7, 'factory'), { regular: 7, overtime: 0 });
  assert.deepEqual(splitHours(11.5, 'construction'), { regular: 8, overtime: 3.5 });
  assert.throws(() => splitHours(8, 'unknown'));
});

test('geofence: inside, outside and unknown', () => {
  const site = { lat: 13.0475, lng: 80.2824, radiusM: 300 };
  assert.equal(withinGeofence(site, { lat: 13.0476, lng: 80.2825 }), true);
  assert.equal(withinGeofence(site, { lat: 13.1, lng: 80.3 }), false);
  assert.equal(withinGeofence(site, null), null);
  assert.ok(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) > 111000);
});

test('payslip: regular + 2x overtime, PF and ESI deductions, net adds up', () => {
  const worker = { id: 'W1', name: 'Test', sector: 'factory', hourlyRate: 100, otMultiplier: 2 };
  const shifts = [
    shift('W1', '2026-10-05T03:00:00Z', '2026-10-05T13:00:00Z'), // 10h -> 8 reg + 2 OT
    shift('W1', '2026-10-06T03:00:00Z', '2026-10-06T11:00:00Z'), // 8h
    shift('W1', '2026-09-30T03:00:00Z', '2026-09-30T11:00:00Z'), // other month: ignored
    shift('W1', '2026-10-07T03:00:00Z', null), // still open: ignored
    shift('OTHER', '2026-10-05T03:00:00Z', '2026-10-05T11:00:00Z'), // other worker: ignored
  ];
  const slip = buildPayslip(worker, shifts, '2026-10');
  assert.deepEqual(slip.hours, { regular: 16, overtime: 2, total: 18 });
  assert.equal(slip.earnings[0].amount, 1600);
  assert.equal(slip.earnings[1].amount, 400); // 2h * 100 * 2
  assert.equal(slip.gross, 2000);
  assert.equal(slip.deductionItems[0].amount, 192); // 12% of regular pay
  assert.equal(slip.deductionItems[1].amount, 15); // 0.75% of gross
  assert.equal(slip.net, slip.gross - slip.deductions);
  assert.equal(slip.days.length, 2);
});

test('payslip: ESI is not charged above the gross ceiling', () => {
  const worker = { id: 'W1', name: 'T', sector: 'factory', hourlyRate: 500, otMultiplier: 2 };
  const shifts = Array.from({ length: 6 }, (_, i) => shift('W1', `2026-10-0${i + 1}T03:00:00Z`, `2026-10-0${i + 1}T11:00:00Z`));
  assert.equal(buildPayslip(worker, shifts, '2026-10').deductionItems[1].amount, 0);
});

test('fatigue: healthy schedule raises no flags', () => {
  const shifts = [
    shift('W', '2026-10-24T03:00:00Z', '2026-10-24T11:00:00Z'),
    shift('W', '2026-10-26T03:00:00Z', '2026-10-26T11:00:00Z'),
  ];
  assert.deepEqual(evaluateFatigue(shifts, NOW), []);
});

test('fatigue: long shift, short rest and weekly overload are flagged', () => {
  const shifts = [
    shift('W', '2026-10-25T02:00:00Z', '2026-10-25T14:30:00Z'), // 12.5h -> critical
    shift('W', '2026-10-25T18:00:00Z', '2026-10-26T03:00:00Z'), // 3.5h rest -> critical
  ];
  const flags = evaluateFatigue(shifts, NOW);
  const byCode = Object.fromEntries(flags.map((f) => [f.code, f.level]));
  assert.equal(byCode.longShift, 'critical');
  assert.equal(byCode.shortRest, 'critical');
  assert.equal(worstLevel(flags), 'critical');
});

test('fatigue: 7 consecutive days without a rest day is critical', () => {
  const shifts = [];
  for (let d = 21; d <= 27; d++) shifts.push(shift('W', `2026-10-${d}T03:00:00Z`, `2026-10-${d}T11:00:00Z`));
  const flag = evaluateFatigue(shifts, NOW).find((f) => f.code === 'noRestDay');
  assert.equal(flag.level, 'critical');
  assert.equal(flag.value, 7);
});

test('risk: transparent factors explain the score and stay within 0-100', () => {
  const worker = { weeklyOff: [0] };
  const calm = computeRisk({ worker, shifts: [], fatigueLevel: 'ok', siteMoraleAvg: 4.5, openHazardAgeDays: 0 }, NOW);
  assert.ok(calm.score >= 0 && calm.score <= 100);

  const stressed = computeRisk({ worker, shifts: [], fatigueLevel: 'critical', siteMoraleAvg: 1.5, openHazardAgeDays: 10 }, NOW);
  const keys = stressed.factors.map((f) => f.key);
  assert.ok(keys.includes('fatigue') && keys.includes('siteMorale') && keys.includes('unresolvedHazard'));
  assert.equal(stressed.factors.reduce((n, f) => n + f.points, 0), Math.min(100, stressed.score));
  assert.equal(stressed.band, 'high');
});

test('feedback is hidden until the anonymity threshold is met', () => {
  const row = (n) => ({ siteId: 'S1', ratings: { manager: n, conditions: n, safety: n }, comment: 'c' });
  const hidden = feedbackSummary([row(1), row(2)], 'S1');
  assert.equal(hidden.hidden, true);
  assert.equal(hidden.comments, undefined);

  const shown = feedbackSummary([row(2), row(3), row(4)], 'S1');
  assert.equal(shown.hidden, false);
  assert.equal(shown.averages.manager, 3);
  assert.equal(shown.overall, 3);
});

test('tokens: valid, tampered and expired', () => {
  const svc = createTokenService('unit-test-secret');
  const token = svc.issue('W001', 'worker', 1000);
  assert.deepEqual(svc.verify(token, 2000), { id: 'W001', role: 'worker' });
  assert.equal(svc.verify(token + 'x', 2000), null);
  assert.equal(svc.verify(token, 1000 + 13 * 3600 * 1000), null);
  assert.equal(createTokenService('other').verify(token, 2000), null);
  assert.equal(svc.verify(undefined), null);
});

test('PIN hashing never stores the PIN and verifies correctly', () => {
  const stored = hashPin('2468');
  assert.ok(!stored.includes('2468'));
  assert.equal(verifyPin('2468', stored), true);
  assert.equal(verifyPin('1111', stored), false);
  assert.equal(verifyPin('2468', null), false);
});
