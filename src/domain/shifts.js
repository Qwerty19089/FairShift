'use strict';

const { SECTORS } = require('../config');

const HOUR_MS = 3600 * 1000;

/** Hours between two ISO timestamps, rounded to 2 decimals. */
function hoursBetween(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round((ms / HOUR_MS) * 100) / 100;
}

/** Calendar day (YYYY-MM-DD) of a timestamp in the app's fixed zone (IST). */
function dayKey(iso) {
  const istOffsetMs = 5.5 * HOUR_MS;
  return new Date(new Date(iso).getTime() + istOffsetMs).toISOString().slice(0, 10);
}

/**
 * Split a shift into regular and overtime hours using the sector's daily limit.
 * Overtime is calculated automatically - the worker never has to claim it.
 */
function splitHours(totalHours, sector) {
  const rule = SECTORS[sector];
  if (!rule) throw new Error(`Unknown sector: ${sector}`);
  const regular = Math.min(totalHours, rule.standardHours);
  const overtime = Math.max(0, totalHours - rule.standardHours);
  return {
    regular: Math.round(regular * 100) / 100,
    overtime: Math.round(overtime * 100) / 100,
  };
}

/** Great-circle distance in metres between two lat/lng points. */
function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * Is the reported position inside the site's geofence?
 * Returns null when either side has no coordinates (unknown, not "failed").
 */
function withinGeofence(site, position) {
  if (!site || !position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
    return null;
  }
  return distanceMeters(site, position) <= site.radiusM;
}

module.exports = { hoursBetween, dayKey, splitHours, distanceMeters, withinGeofence, HOUR_MS };
