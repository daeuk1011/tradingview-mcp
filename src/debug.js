/**
 * Lightweight namespaced debug logging, gated by the TV_DEBUG environment variable.
 *
 * Enable with:
 *   TV_DEBUG=cdp        → only the "cdp" namespace
 *   TV_DEBUG=cdp,pine   → multiple namespaces
 *   TV_DEBUG=*          → everything
 *
 * Output goes to stderr so it never corrupts the MCP stdio protocol on stdout.
 */

export function isDebugEnabled(namespace, env = process.env) {
  const flag = env.TV_DEBUG;
  if (!flag || flag.trim() === '') return false;
  const parts = flag.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.includes('*') || parts.includes(namespace);
}

/**
 * Create a logger bound to a namespace.
 * @param {string} namespace
 * @param {{ env?: object, sink?: (line: string) => void }} [opts]
 *   sink defaults to stderr; injectable for testing.
 */
export function createDebugLogger(namespace, opts = {}) {
  const env = opts.env || process.env;
  const sink = opts.sink || ((line) => process.stderr.write(line));
  const enabled = isDebugEnabled(namespace, env);
  if (!enabled) return () => {};
  return (...args) => {
    const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    sink(`[tv:${namespace}] ${msg}\n`);
  };
}
