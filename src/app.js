'use strict';

const path = require('node:path');
const express = require('express');

const { createTokenService } = require('./auth');
const { securityHeaders, rateLimit } = require('./middleware');
const { Store } = require('./store');
const { seedStore } = require('./seed');
const publicRoutes = require('./routes/public');
const workerRoutes = require('./routes/worker');
const adminRoutes = require('./routes/admin');

/**
 * Build the Express app. Everything environmental (store, clock, config) is
 * injected, which keeps the app trivially testable.
 */
function createApp({ config, store = new Store(), clock = () => new Date(), seed = true } = {}) {
  let seedPin = null;
  if (seed) seedPin = seedStore(store, { now: clock(), pin: config.seedPin }).pin;

  const tokens = createTokenService(config.sessionSecret);
  const ctx = { config, store, clock, tokens };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Cloud Run terminates TLS in front of the container
  app.use(securityHeaders);
  app.use(express.json({ limit: '16kb' }));

  app.use('/api', rateLimit({ windowMs: 60_000, max: 240, keyPrefix: 'api' }));
  app.use('/api', publicRoutes(ctx));
  app.use('/api/worker', workerRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir, { maxAge: '1h', extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  app.locals.seedPin = seedPin;
  return app;
}

module.exports = { createApp };
