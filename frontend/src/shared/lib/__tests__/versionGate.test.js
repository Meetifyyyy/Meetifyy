import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * The launch-time version gate.
 *
 * Tested by extracting the gate straight out of `index.html` and running it,
 * rather than against a re-typed copy. The gate has to be inline — it runs
 * before any bundle exists — so it cannot be imported, and a test that mirrored
 * its logic would keep passing after the real thing drifted. Pulling the actual
 * source in is what makes this meaningful.
 */
const HTML = fs.readFileSync(
  path.resolve(process.cwd(), 'index.html'),
  'utf8'
);

const BUILD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function extractGate() {
  const start = HTML.indexOf('    (function () {\n      var BUILD =');
  expect(start).toBeGreaterThan(-1);
  const end = HTML.indexOf('})();', start) + '})();'.length;
  // Stand in for what the build plugin stamps.
  return HTML.slice(start, end).replace('__MEETIFYY_BUILD_VERSION__', BUILD);
}

/** Runs the gate against a fake browser and reports what it did. */
async function runGate({
  serverVersion,
  alreadyTried = null,
  fetchFails = false,
  hasServiceWorker = true,
  buildVersion = BUILD,
} = {}) {
  const actions = [];
  const store = new Map();
  if (alreadyTried) store.set('meetifyy_version_reload_for', alreadyTried);

  const caches = {
    keys: async () => ['js-chunks-cache', 'app-shell', 'workbox-precache-v2'],
    delete: async (n) => actions.push(`cache-delete:${n}`),
  };

  const win = {
    location: {
      href: 'https://dev.meetifyy.app/home',
      replace: (u) => actions.push(`reload:${u}`),
    },
    fetch: async () => {
      if (fetchFails) throw new Error('offline');
      return { ok: true, json: async () => ({ version: serverVersion }) };
    },
    caches,
  };

  const sandbox = {
    window: win,
    setTimeout,
    clearTimeout,
    Promise,
    URL,
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        store.set(k, v);
        actions.push(`mark:${v}`);
      },
    },
    navigator: hasServiceWorker
      ? {
          serviceWorker: {
            getRegistration: async () => ({
              waiting: {
                postMessage: (m) => actions.push(`skip-waiting:${m.type}`),
              },
              update: async () => actions.push('sw-update'),
            }),
          },
        }
      : {},
    caches,
    fetch: win.fetch,
  };

  const source = extractGate().replace(BUILD, buildVersion);
  const fn = new Function(
    ...Object.keys(sandbox),
    `${source}\n return window.__meetifyyVersionGate;`
  );
  const gate = fn(...Object.values(sandbox));

  // Polled rather than a fixed wait. Most paths settle in a tick; only the
  // forced-update path has bounded async work, and waiting 1.8s for every case
  // made the suite take sixteen seconds to assert almost nothing.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const reloaded = actions.some((a) => a.startsWith('reload:'));
    if (reloaded || gate.pending === false) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  return { actions, gate };
}

describe('launch version gate', () => {
  it('does nothing when the build is current', async () => {
    // Requirement: no extra delay and no visible sign a check happened.
    const { actions, gate } = await runGate({ serverVersion: BUILD });
    expect(actions).toEqual([]);
    expect(gate.pending).toBe(false);
  });

  it('purges every cache, promotes the worker and reloads on a new version', async () => {
    const { actions } = await runGate({ serverVersion: 'bbbb2222' });

    // Caches first, so nothing can answer the reload from a stale entry.
    expect(actions).toContain('cache-delete:js-chunks-cache');
    expect(actions).toContain('cache-delete:app-shell');
    expect(actions).toContain('cache-delete:workbox-precache-v2');
    // skipWaiting is safe HERE — before any lazy chunk has been requested.
    expect(actions).toContain('skip-waiting:SKIP_WAITING');
    expect(actions).toContain('sw-update');
    expect(actions.some((a) => a.startsWith('reload:'))).toBe(true);
  });

  it('holds the loading screen up until the reload is under way', async () => {
    // The shell checks this flag. Lifting it early would show the old app for a
    // moment and then reload out from under it — the "mix of old and new" the
    // gate exists to prevent.
    const { gate } = await runGate({ serverVersion: 'bbbb2222' });
    expect(gate.pending).toBe(true);
  });

  it('cache-busts the reload so no intermediary can serve the old document', async () => {
    const { actions } = await runGate({ serverVersion: 'bbbb2222' });
    const reload = actions.find((a) => a.startsWith('reload:'));
    expect(reload).toMatch(/[?&]_v=/);
  });

  it('does not reload twice for the same version', async () => {
    // A CDN mid-propagation can still answer with the old build. Reloading
    // again would not help, so the gate gives up rather than looping the tab.
    const { actions, gate } = await runGate({
      serverVersion: 'bbbb2222',
      alreadyTried: 'bbbb2222',
    });
    expect(actions).toEqual([]);
    expect(gate.pending).toBe(false);
  });

  it('still fires for a DIFFERENT version after an earlier attempt', async () => {
    const { actions } = await runGate({
      serverVersion: 'cccc3333',
      alreadyTried: 'bbbb2222',
    });
    expect(actions.some((a) => a.startsWith('reload:'))).toBe(true);
  });

  it('fails open when the check cannot complete', async () => {
    // Offline, or a blocked request. Blocking or reloading here would break the
    // app on a bad connection, which is far worse than running one deploy behind.
    const { actions, gate } = await runGate({ fetchFails: true });
    expect(actions).toEqual([]);
    expect(gate.pending).toBe(false);
  });

  it('proceeds when the build carries no stamp', async () => {
    // A direct `vite build` with no generated manifest. There is nothing to
    // compare, so it must not reload-loop every client.
    const { actions, gate } = await runGate({
      serverVersion: 'bbbb2222',
      buildVersion: '__MEETIFYY_BUILD_VERSION__',
    });
    expect(actions).toEqual([]);
    expect(gate.pending).toBe(false);
  });

  it('still purges and reloads with no service worker registered', async () => {
    // The dev deployment ships a tombstone worker and production may not have
    // registered one yet; the cache purge and reload must not depend on it.
    const { actions } = await runGate({
      serverVersion: 'bbbb2222',
      hasServiceWorker: false,
    });
    expect(actions).toContain('cache-delete:js-chunks-cache');
    expect(actions.some((a) => a.startsWith('reload:'))).toBe(true);
  });
});

describe('the gate is wired into the page', () => {
  it('runs before the module bundle', () => {
    // Ordering is the point: it has to decide while the logo shell is up, not
    // after React has started mounting.
    const gateAt = HTML.indexOf('__meetifyyVersionGate');
    const bundleAt = HTML.indexOf('src="/src/main.jsx"');
    expect(gateAt).toBeGreaterThan(-1);
    expect(bundleAt).toBeGreaterThan(gateAt);
  });

  it('blocks the launch shell from lifting while pending', () => {
    expect(HTML).toMatch(/__meetifyyVersionGate\s*&&\s*window\.__meetifyyVersionGate\.pending/);
  });

  it('keeps an unconditional backstop so the logo can never hang', () => {
    expect(HTML).toMatch(/dismiss\(true\)/);
  });
});
