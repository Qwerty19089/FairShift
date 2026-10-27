'use strict';

/**
 * Central configuration. Every secret comes from the environment - nothing
 * sensitive is committed to the repository.
 */

/** Per-sector labour rules (illustrative values, easy to tune per employer). */
const SECTORS = Object.freeze({
  construction: { standardHours: 8, otMultiplier: 2, weeklyLimit: 48 },
  college: { standardHours: 8, otMultiplier: 2, weeklyLimit: 48 },
  hospital: { standardHours: 8, otMultiplier: 2, weeklyLimit: 48 },
  factory: { standardHours: 8, otMultiplier: 2, weeklyLimit: 48 },
});

const FATIGUE = Object.freeze({
  longShiftWarnHours: 10,
  longShiftCriticalHours: 12,
  minRestHours: 11,
  weeklyWarnHours: 48,
  weeklyCriticalHours: 60,
  consecutiveDaysWarn: 6,
  consecutiveDaysCritical: 7,
});

const LANGUAGES = Object.freeze(['en', 'ta', 'hi', 'te']);

/** Anonymous feedback is only shown to admins once this many responses exist. */
const MIN_FEEDBACK_GROUP = 3;

function load(env = process.env) {
  return {
    port: Number(env.PORT) || 8080,
    nodeEnv: env.NODE_ENV || 'development',
    // Signs session tokens. A random per-process secret is used when unset.
    sessionSecret: env.SESSION_SECRET || null,
    // One-tap demo logins for judges/reviewers. Disable in a real deployment.
    demoMode: env.DEMO_MODE === 'true',
    // Optional PIN used for all seeded accounts. Random when unset.
    seedPin: env.SEED_PIN || null,
  };
}

module.exports = { SECTORS, FATIGUE, LANGUAGES, MIN_FEEDBACK_GROUP, load };
