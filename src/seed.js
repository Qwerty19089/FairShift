'use strict';

const { hashPin } = require('./store');
const { HOUR_MS } = require('./domain/shifts');

const DAY_MS = 24 * HOUR_MS;

/** Small deterministic PRNG so demo data (and tests) are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SITES = [
  { id: 'S1', code: 'MARINA', sector: 'construction', name: 'Marina Towers Construction Site', lat: 13.0475, lng: 80.2824, radiusM: 300 },
  { id: 'S2', code: 'SRMCAMPUS', sector: 'college', name: 'SRM Campus Facilities', lat: 12.8231, lng: 80.0442, radiusM: 800 },
  { id: 'S3', code: 'CITYCARE', sector: 'hospital', name: 'CityCare Hospital', lat: 13.0569, lng: 80.2425, radiusM: 250 },
  { id: 'S4', code: 'SUNRISE', sector: 'factory', name: 'Sunrise Auto Components', lat: 12.968, lng: 79.942, radiusM: 500 },
];

// `profile` shapes the generated history so the dashboard has a story to tell.
const WORKERS = [
  { id: 'W001', name: 'Murugan S', siteId: 'S1', role: 'Mason', hourlyRate: 75, lang: 'ta', profile: 'overworked' },
  { id: 'W002', name: 'Selvi K', siteId: 'S1', role: 'Helper', hourlyRate: 60, lang: 'ta', profile: 'normal' },
  { id: 'W003', name: 'Rahim Ansari', siteId: 'S1', role: 'Electrician', hourlyRate: 90, lang: 'hi', profile: 'normal' },
  { id: 'W004', name: 'Kavitha R', siteId: 'S2', role: 'Housekeeping', hourlyRate: 55, lang: 'ta', profile: 'normal' },
  { id: 'W005', name: 'Prakash M', siteId: 'S2', role: 'Lab Attendant', hourlyRate: 65, lang: 'en', profile: 'absent' },
  { id: 'W006', name: 'Anitha D', siteId: 'S2', role: 'Security', hourlyRate: 62, lang: 'ta', profile: 'normal' },
  { id: 'W007', name: 'Lakshmi N', siteId: 'S3', role: 'Ward Assistant', hourlyRate: 80, lang: 'te', profile: 'nightRotation' },
  { id: 'W008', name: 'Joseph P', siteId: 'S3', role: 'Sanitation', hourlyRate: 58, lang: 'en', profile: 'normal' },
  { id: 'W009', name: 'Meena V', siteId: 'S3', role: 'Nursing Aide', hourlyRate: 85, lang: 'ta', profile: 'normal' },
  { id: 'W010', name: 'Suresh B', siteId: 'S4', role: 'Machine Operator', hourlyRate: 95, lang: 'hi', profile: 'overtimeHeavy' },
  { id: 'W011', name: 'Deepa T', siteId: 'S4', role: 'Line Inspector', hourlyRate: 88, lang: 'te', profile: 'normal' },
  { id: 'W012', name: 'Imran Sheikh', siteId: 'S4', role: 'Packer', hourlyRate: 70, lang: 'hi', profile: 'normal' },
];

const ADMINS = [{ id: 'A001', name: 'Priya Raman', title: 'HR Manager', lang: 'en' }];

const CREDENTIALS = [
  ['W001', 'Masonry Level 2', 'NSDC', '2022-06-15', null, true],
  ['W001', 'Working at Height', 'BuildSafe India', '2024-02-10', '2027-02-10', true],
  ['W003', 'Electrical Wireman (ITI)', 'ITI Chennai', '2019-05-20', null, true],
  ['W003', 'Fire Safety Basics', 'CityFire Academy', '2025-01-12', '2028-01-12', true],
  ['W007', 'Patient Handling & Hygiene', 'CityCare Hospital', '2024-08-01', null, true],
  ['W009', 'Basic Life Support (BLS)', 'Indian Resuscitation Council', '2024-03-05', '2026-03-05', true],
  ['W010', 'CNC Machine Operation', 'Sunrise Training Centre', '2023-09-18', null, true],
  ['W004', 'Chemical Handling', 'SRM Safety Cell', '2025-07-01', '2027-07-01', true],
];

const FEEDBACK_SEED = [
  // siteId, manager, conditions, safety, comment
  ['S1', 2, 2, 1, 'No helmets on level 4 most days.'],
  ['S1', 2, 3, 2, 'Overtime is expected but never discussed.'],
  ['S1', 1, 2, 2, ''],
  ['S1', 3, 2, 2, 'Water point is too far from the work area.'],
  ['S2', 4, 4, 4, 'Supervisor listens when we raise issues.'],
  ['S2', 5, 4, 4, ''],
  ['S2', 4, 3, 4, ''],
  ['S3', 3, 3, 3, 'Night shifts are too close together.'],
  ['S3', 4, 3, 4, ''],
  ['S3', 3, 2, 3, 'Not enough staff on the ward at night.'],
  ['S4', 3, 3, 2, 'Noise levels are high near press line 2.'],
  ['S4', 4, 3, 3, ''],
];

/** ISO week label like "2026-W44" (used to limit anonymous feedback to 1/week). */
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** IST midnight (as a UTC timestamp) for the day `offset` days before `now`. */
function istMidnight(now, offset) {
  const istNow = new Date(now.getTime() + 5.5 * HOUR_MS);
  const midnightIst = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - offset * DAY_MS;
  return midnightIst - 5.5 * HOUR_MS;
}

/** Shift definitions (startHour, durationHours) for a worker on a given day. */
function shiftPlan(worker, dayOffset, rand, now) {
  const weekday = new Date(istMidnight(now, dayOffset) + 5.5 * HOUR_MS).getUTCDay();
  if (worker.weeklyOff.includes(weekday) && worker.profile !== 'overworked') return null;
  switch (worker.profile) {
    case 'overworked': // 12h days, never a day off
      return { start: 7, hours: 11 + rand() };
    case 'overtimeHeavy':
      return { start: 8, hours: 10 + rand() * 1.5 };
    case 'nightRotation': // alternating night + early shifts with short rest
      return dayOffset % 2 === 0 ? { start: 19, hours: 9 } : { start: 6, hours: 9 };
    case 'absent': // skips roughly half the days
      return rand() < 0.5 ? null : { start: 8, hours: 8 + rand() * 0.5 };
    default:
      return rand() < 0.06 ? null : { start: 8 + Math.round(rand()), hours: 7.5 + rand() * 1.5 };
  }
}

/**
 * Populate a Store with demo data. `now` and `seed` are injectable for tests.
 * @returns {{ pin: string }} the PIN assigned to every seeded account
 */
function seedStore(store, { now = new Date(), seed = 42, pin } = {}) {
  const rand = mulberry32(seed);
  const accountPin = pin || String(1000 + Math.floor(rand() * 9000));
  const pinHash = hashPin(accountPin); // one hash shared by all demo accounts

  store.sites = SITES.map((s) => ({ ...s }));
  store.admins = ADMINS.map((a) => ({ ...a, pinHash }));
  store.workers = WORKERS.map((w) => {
    const site = SITES.find((s) => s.id === w.siteId);
    return { ...w, sector: site.sector, otMultiplier: 2, weeklyOff: [0], pinHash };
  });

  // 30 days of completed shifts, ending yesterday (today stays open for live check-in demos)
  for (const worker of store.workers) {
    for (let offset = 30; offset >= 1; offset--) {
      const plan = shiftPlan(worker, offset, rand, now);
      if (!plan) continue;
      const start = istMidnight(now, offset) + plan.start * HOUR_MS;
      store.shifts.push({
        id: store.nextId('SH'),
        workerId: worker.id,
        siteId: worker.siteId,
        checkIn: new Date(start).toISOString(),
        checkOut: new Date(start + plan.hours * HOUR_MS).toISOString(),
        locationVerified: null,
      });
    }
  }

  for (const [workerId, title, issuer, issuedOn, expiresOn, verified] of CREDENTIALS) {
    store.credentials.push({ id: store.nextId('C'), workerId, title, issuer, issuedOn, expiresOn, verified });
  }

  const week = isoWeek(now);
  for (const [siteId, manager, conditions, safety, comment] of FEEDBACK_SEED) {
    store.feedback.push({ id: store.nextId('F'), siteId, ratings: { manager, conditions, safety }, comment, week, createdAt: now.toISOString() });
  }

  const daysAgo = (n) => new Date(now.getTime() - n * DAY_MS).toISOString();
  const seedReport = (siteId, category, severity, description, status, ageDays, reporterId = null) => {
    const history = [{ status: 'open', at: daysAgo(ageDays), note: '' }];
    if (status !== 'open') history.push({ status, at: daysAgo(Math.max(0, ageDays - 1)), note: '' });
    store.reports.push({
      id: store.nextId('R'), code: store.newTrackingCode(), siteId, category, severity, description,
      status, reporterId, createdAt: daysAgo(ageDays), updatedAt: history[history.length - 1].at, history,
    });
  };
  seedReport('S1', 'fall', 'high', 'Scaffolding on level 4 has a loose plank near the east edge.', 'open', 9, 'W001');
  seedReport('S1', 'electrical', 'medium', 'Exposed cable near the mixer machine.', 'in_review', 3);
  seedReport('S2', 'slip', 'low', 'Wet floor in the science block corridor, no sign.', 'resolved', 6);
  seedReport('S3', 'chemical', 'medium', 'Disinfectant containers stored without labels.', 'in_review', 2);
  seedReport('S4', 'machinery', 'high', 'Guard missing on press line 2.', 'open', 1);

  return { pin: accountPin };
}

module.exports = { seedStore, isoWeek, SITES };
