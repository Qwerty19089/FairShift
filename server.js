'use strict';

const { load } = require('./src/config');
const { createApp } = require('./src/app');

const config = load();
const app = createApp({ config });

const server = app.listen(config.port, () => {
  console.log(`FairShift listening on :${config.port} (demoMode=${config.demoMode})`);
  // Only print the generated PIN outside production, and only when no SEED_PIN was given.
  if (!config.seedPin && config.nodeEnv !== 'production') {
    console.log(`Seed accounts PIN (dev only): ${app.locals.seedPin}`);
  }
});

// Cloud Run sends SIGTERM before stopping an instance: finish in-flight requests first.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
