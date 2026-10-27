'use strict';

const crypto = require('node:crypto');

const TOKEN_TTL_MS = 12 * 3600 * 1000;

/**
 * Stateless signed session tokens: base64url(payload).base64url(hmac).
 * No third-party JWT library needed and nothing to leak from the repository -
 * the signing secret comes from the environment (or is random per process).
 */
function createTokenService(secret) {
  const key = secret || crypto.randomBytes(32).toString('hex');
  const b64 = (buf) => Buffer.from(buf).toString('base64url');
  const sign = (data) => crypto.createHmac('sha256', key).update(data).digest();

  return {
    issue(subject, role, now = Date.now()) {
      const payload = b64(JSON.stringify({ sub: subject, role, exp: now + TOKEN_TTL_MS }));
      return `${payload}.${b64(sign(payload))}`;
    },
    verify(token, now = Date.now()) {
      if (typeof token !== 'string') return null;
      const [payload, sig] = token.split('.');
      if (!payload || !sig) return null;
      const expected = sign(payload);
      const given = Buffer.from(sig, 'base64url');
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
      try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return data.exp > now ? { id: data.sub, role: data.role } : null;
      } catch {
        return null;
      }
    },
  };
}

/** Express middleware: require a valid bearer token with one of the allowed roles. */
function requireRole(tokens, ...roles) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const session = tokens.verify(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!session || !roles.includes(session.role)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.session = session;
    next();
  };
}

module.exports = { createTokenService, requireRole, TOKEN_TTL_MS };
