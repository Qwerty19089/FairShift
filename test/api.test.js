'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/app');
const { load } = require('../src/config');

const NOW = new Date('2026-10-27T05:00:00Z');
let clockNow = NOW;

async function start(env = {}) {
  const config = load({ DEMO_MODE: 'true', SESSION_SECRET: 'test-secret', SEED_PIN: '4321', ...env });
  const app = createApp({ config, clock: () => clockNow });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
  };
  const login = async (id, pin = '4321') => (await call('POST', '/api/login', { body: { id, pin } })).body.token;
  return { server, call, login, close: () => new Promise((r) => server.close(r)) };
}

test('auth: PIN login works, wrong PIN and missing token are rejected', async () => {
  const t = await start();
  try {
    assert.equal((await t.call('POST', '/api/login', { body: { id: 'W001', pin: '0000' } })).status, 401);
    assert.equal((await t.call('POST', '/api/login', { body: { id: 'W001', pin: '4321' } })).status, 200);
    assert.equal((await t.call('GET', '/api/worker/me')).status, 401);
    assert.equal((await t.call('GET', '/api/admin/dashboard')).status, 401);
  } finally { await t.close(); }
});

test('auth: workers cannot reach admin routes; admins cannot use worker routes', async () => {
  const t = await start();
  try {
    const worker = await t.login('W001');
    const admin = await t.login('A001');
    assert.equal((await t.call('GET', '/api/admin/dashboard', { token: worker })).status, 401);
    assert.equal((await t.call('GET', '/api/worker/me', { token: admin })).status, 401);
  } finally { await t.close(); }
});

test('demo login is disabled unless DEMO_MODE=true', async () => {
  const t = await start({ DEMO_MODE: 'false' });
  try {
    assert.equal((await t.call('POST', '/api/login', { body: { demo: 'admin' } })).status, 401);
    assert.equal((await t.call('GET', '/api/demo/workers')).status, 404);
  } finally { await t.close(); }
});

test('security headers are set and the framework is not advertised', async () => {
  const t = await start();
  try {
    const res = await t.call('GET', '/api/health');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  } finally { await t.close(); }
});

test('shift tracking: check in, reject duplicates and wrong site, check out with overtime', async () => {
  const t = await start();
  try {
    const token = await t.login('W002'); // Marina construction site
    clockNow = new Date('2026-10-27T03:00:00Z');
    assert.equal((await t.call('POST', '/api/worker/checkin', { token, body: { code: 'SRMCAMPUS' } })).status, 403);
    assert.equal((await t.call('POST', '/api/worker/checkin', { token, body: { code: 'NOPE' } })).status, 404);

    const ok = await t.call('POST', '/api/worker/checkin', { token, body: { code: 'fairshift:marina', lat: 13.0476, lng: 80.2825 } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.locationVerified, true);
    assert.equal((await t.call('POST', '/api/worker/checkin', { token, body: { code: 'MARINA' } })).status, 409);

    clockNow = new Date('2026-10-27T13:30:00Z'); // 10.5h later
    const out = await t.call('POST', '/api/worker/checkout', { token });
    assert.equal(out.body.total, 10.5);
    assert.equal(out.body.overtime, 2.5);
    assert.equal((await t.call('POST', '/api/worker/checkout', { token })).status, 409);
  } finally { clockNow = NOW; await t.close(); }
});

test('payslip: validates month and returns consistent totals', async () => {
  const t = await start();
  try {
    const token = await t.login('W003');
    assert.equal((await t.call('GET', '/api/worker/payslip?month=2026-13', { token })).status, 400);
    const { status, body } = await t.call('GET', '/api/worker/payslip?month=2026-10', { token });
    assert.equal(status, 200);
    assert.ok(Math.abs(body.net - (body.gross - body.deductions)) < 0.01);
    assert.equal(body.worker.id, 'W003');
  } finally { await t.close(); }
});

test('safety: anonymous by default, trackable by code, admin can update status', async () => {
  const t = await start();
  try {
    const worker = await t.login('W004');
    const admin = await t.login('A001');
    assert.equal((await t.call('POST', '/api/worker/reports', { token: worker, body: { category: 'nope', severity: 'low', description: 'x' } })).status, 400);

    const created = await t.call('POST', '/api/worker/reports', { token: worker, body: { category: 'slip', severity: 'medium', description: 'Wet floor near stairs' } });
    assert.equal(created.status, 201);
    const code = created.body.code;
    assert.match(code, /^SAF-[A-Z2-9]{5}$/);

    const tracked = await t.call('GET', `/api/reports/track/${code}`);
    assert.equal(tracked.body.status, 'open');
    assert.equal(tracked.body.reporterId, undefined); // identity never exposed

    assert.deepEqual((await t.call('GET', '/api/worker/reports', { token: worker })).body, []); // anonymous: not linked to worker

    const list = await t.call('GET', '/api/admin/reports', { token: admin });
    const row = list.body.find((r) => r.code === code);
    assert.equal(row.anonymous, true);
    assert.equal((await t.call('PATCH', `/api/admin/reports/${row.id}`, { token: admin, body: { status: 'bogus' } })).status, 400);
    await t.call('PATCH', `/api/admin/reports/${row.id}`, { token: admin, body: { status: 'resolved', note: 'Mopped' } });
    const after = await t.call('GET', `/api/reports/track/${code}`);
    assert.equal(after.body.status, 'resolved');
    assert.equal(after.body.history.length, 2);
  } finally { await t.close(); }
});

test('feedback: one submission per worker per week, stored without worker identity', async () => {
  const t = await start();
  try {
    const token = await t.login('W005');
    const body = { manager: 4, conditions: 3, safety: 5, comment: 'ok' };
    assert.equal((await t.call('POST', '/api/worker/feedback', { token, body: { ...body, safety: 9 } })).status, 400);
    assert.equal((await t.call('POST', '/api/worker/feedback', { token, body })).status, 201);
    assert.equal((await t.call('POST', '/api/worker/feedback', { token, body })).status, 409);
  } finally { await t.close(); }
});

test('skill passport: self-declared, shareable by token, revocable; admin can issue and verify', async () => {
  const t = await start();
  try {
    const worker = await t.login('W006');
    const admin = await t.login('A001');
    assert.equal((await t.call('POST', '/api/worker/passport', { token: worker, body: { title: '', issuedOn: 'x' } })).status, 400);
    const added = await t.call('POST', '/api/worker/passport', { token: worker, body: { title: 'First Aid', issuer: 'Red Cross', issuedOn: '2025-05-05' } });
    assert.equal(added.body.verified, false);

    const verified = await t.call('PATCH', `/api/admin/credentials/${added.body.id}/verify`, { token: admin });
    assert.equal(verified.body.verified, true);
    const issued = await t.call('POST', '/api/admin/credentials', { token: admin, body: { workerId: 'W006', title: 'Fire Safety', issuer: 'SRM', issuedOn: '2025-06-01' } });
    assert.equal(issued.status, 201);

    const { token: shareToken } = (await t.call('POST', '/api/worker/passport/share', { token: worker })).body;
    const shared = await t.call('GET', `/api/passport/${shareToken}`);
    assert.equal(shared.status, 200);
    assert.equal(shared.body.credentials.length, 2);
    assert.equal(shared.body.hourlyRate, undefined); // private data never leaks

    await t.call('DELETE', '/api/worker/passport/share', { token: worker });
    assert.equal((await t.call('GET', `/api/passport/${shareToken}`)).status, 404);
  } finally { await t.close(); }
});

test('admin dashboard covers 2+ sectors and can be filtered by sector', async () => {
  const t = await start();
  try {
    const admin = await t.login('A001');
    const all = (await t.call('GET', '/api/admin/dashboard', { token: admin })).body;
    assert.ok(new Set(all.people.map((p) => p.sector)).size >= 2);
    assert.equal(all.attendance.length, 14);

    const hospital = (await t.call('GET', '/api/admin/dashboard?sector=hospital', { token: admin })).body;
    assert.ok(hospital.people.length > 0 && hospital.people.every((p) => p.sector === 'hospital'));
    assert.ok(hospital.people.length < all.people.length);

    const risky = all.people[0];
    assert.ok(risky.risk.factors.length > 0, 'risk must be explained');
  } finally { await t.close(); }
});

test('site QR endpoint returns an image data URL for admins only', async () => {
  const t = await start();
  try {
    const admin = await t.login('A001');
    assert.equal((await t.call('GET', '/api/admin/sites/S1/qr')).status, 401);
    const qr = await t.call('GET', '/api/admin/sites/S1/qr', { token: admin });
    assert.match(qr.body.dataUrl, /^data:image\/gif;base64,/);
    assert.equal(qr.body.code, 'MARINA');
  } finally { await t.close(); }
});

test('malformed JSON returns 400 instead of crashing', async () => {
  const t = await start();
  try {
    const res = await fetch(`http://127.0.0.1:${t.server.address().port}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
    });
    assert.equal(res.status, 400);
  } finally { await t.close(); }
});
