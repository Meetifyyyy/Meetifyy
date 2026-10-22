import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The website and the app each build their own QueryClient (see the note in
 * mobile/main.jsx), so the offline wiring has to be in both. Nothing else would
 * notice one of them losing it: the app would still run, with queries that
 * think they are online and mutations that pause silently.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const entries = { web: 'src/main.jsx', app: 'src/mobile/main.jsx' };

describe.each(Object.entries(entries))('%s entry point', (_name, file) => {
  const source = readFileSync(resolve(root, file), 'utf8');

  it('gives TanStack the device connectivity before the client is used', () => {
    expect(source).toMatch(/installNetworkStatus\(\);/);
    expect(source.indexOf('installNetworkStatus();')).toBeLessThan(source.indexOf('new QueryClient('));
  });

  it('makes mutations fail fast offline instead of pausing', () => {
    expect(source).toMatch(/mutations:\s*mutationDefaults/);
  });
});
