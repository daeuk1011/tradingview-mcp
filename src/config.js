/**
 * Centralized configuration for the CDP connection.
 * Single source of truth for host/port, overridable via environment variables:
 *   TV_CDP_HOST (default "localhost")
 *   TV_CDP_PORT (default 9222)
 */

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 9222;

export function resolveCdpHost(env = process.env) {
  const raw = env.TV_CDP_HOST;
  return raw && raw.trim() !== '' ? raw.trim() : DEFAULT_HOST;
}

export function resolveCdpPort(env = process.env) {
  const raw = env.TV_CDP_PORT;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return DEFAULT_PORT;
  return n;
}

// Resolved once at process startup — import these for runtime use.
export const CDP_HOST = resolveCdpHost();
export const CDP_PORT = resolveCdpPort();
export const CDP_BASE_URL = `http://${CDP_HOST}:${CDP_PORT}`;
