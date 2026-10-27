'use strict';

/** Security headers. The strict CSP is possible because pages use no inline scripts. */
function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(self), microphone=(self), camera=(self)',
  });
  next();
}

/** Tiny fixed-window rate limiter keyed by client IP (enough for a single instance). */
function rateLimit({ windowMs, max, keyPrefix = '' }) {
  const hits = new Map();
  const timer = setInterval(() => hits.clear(), windowMs);
  timer.unref();
  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}`;
    const count = (hits.get(key) || 0) + 1;
    hits.set(key, count);
    if (count > max) return res.status(429).json({ error: 'too_many_requests' });
    next();
  };
}

/** Collapse whitespace and cap length; strips control characters. */
function cleanText(value, maxLen) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

function isRating(n) {
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

module.exports = { securityHeaders, rateLimit, cleanText, isRating };
