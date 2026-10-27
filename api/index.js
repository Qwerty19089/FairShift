'use strict';

// Vercel serverless entry point: exports the same Express app that server.js runs on Cloud Run.
const { load } = require('../src/config');
const { createApp } = require('../src/app');

module.exports = createApp({ config: load() });
