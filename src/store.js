'use strict';

const crypto = require('node:crypto');

/**
 * In-memory data store.
 *
 * Cloud Run containers are stateless, so this prototype re-seeds demo data on
 * start. Every access goes through this class, so swapping in Firestore later
 * only means re-implementing these methods.
 */
class Store {
  constructor() {
    this.sites = [];
    this.workers = [];
    this.admins = [];
    this.shifts = [];
    this.reports = [];
    this.feedback = []; // deliberately has NO worker id - anonymity by design
    this.feedbackSubmitted = new Set(); // "workerId:week" - kept apart from content
    this.credentials = [];
    this.shareTokens = new Map(); // token -> workerId
    this.seq = 1;
  }

  nextId(prefix) {
    return `${prefix}${String(this.seq++).padStart(4, '0')}`;
  }

  siteByCode(code) {
    const wanted = String(code || '').trim().toUpperCase();
    return this.sites.find((s) => s.code === wanted) || null;
  }

  siteById(id) {
    return this.sites.find((s) => s.id === id) || null;
  }

  workerById(id) {
    return this.workers.find((w) => w.id === id) || null;
  }

  adminById(id) {
    return this.admins.find((a) => a.id === id) || null;
  }

  shiftsOf(workerId) {
    return this.shifts.filter((s) => s.workerId === workerId);
  }

  openShift(workerId) {
    return this.shifts.find((s) => s.workerId === workerId && !s.checkOut) || null;
  }

  credentialsOf(workerId) {
    return this.credentials.filter((c) => c.workerId === workerId);
  }

  reportByCode(code) {
    const wanted = String(code || '').trim().toUpperCase();
    return this.reports.find((r) => r.code === wanted) || null;
  }

  newTrackingCode() {
    // Unambiguous alphabet (no 0/O/1/I) so it is easy to read out or write down.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = 'SAF-' + Array.from(crypto.randomBytes(5), (b) => alphabet[b % alphabet.length]).join('');
    } while (this.reportByCode(code));
    return code;
  }
}

/** Hash a PIN with scrypt. Stored as "salt:hash" (hex). */
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPin(pin, stored) {
  if (!stored || typeof pin !== 'string') return false;
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { Store, hashPin, verifyPin };
