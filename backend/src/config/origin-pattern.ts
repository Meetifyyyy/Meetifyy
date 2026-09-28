/**
 * Whether `origin` matches a configured CORS pattern such as
 * `https://*.vercel.app`, where each `*` stands for exactly one DNS label.
 *
 * Every other character is literal. The previous copies (in main.ts and
 * socket-cors.ts) escaped only `.`, so any other regex metacharacter in a
 * pattern changed its meaning. An entry without `*` is not a pattern and is
 * matched exactly by the caller; the bare `*` is refused at boot by
 * isolation.guard.ts.
 */
export function originMatchesPattern(allowed: string, origin: string): boolean {
  if (allowed === '*') return true;
  if (!allowed.includes('*')) return false;
  const source = allowed.split('*').map(escapeRegExp).join('[^.]*');
  return new RegExp(`^${source}$`, 'i').test(origin);
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}
