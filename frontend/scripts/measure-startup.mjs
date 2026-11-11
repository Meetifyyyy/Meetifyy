/**
 * Measures the installed app's start-up on a connected Android device.
 *
 *   node scripts/measure-startup.mjs                     5 cold starts of the dev app
 *   node scripts/measure-startup.mjs --runs 8 --warm     warm starts (HOME, then relaunch)
 *   node scripts/measure-startup.mjs --pkg app.meetifyy  the release app
 *   node scripts/measure-startup.mjs --json out.json     also write every run to a file
 *
 * Two numbers per run, kept apart on purpose:
 *
 *   in-app      the page's own clock: navigation start -> Home's content in the
 *               DOM and painted (`meetifyy:home-painted`, see launchReadiness.js)
 *   end to end  the system's clock: the launch intent -> the splash starting to
 *               uncover the page (`MeetifyyLaunch` log) and Android's own
 *               `Displayed` / `Fully drawn`
 *
 * The native log lines and the page marks need a build that exposes them: a
 * debug APK, or the `perf` build type (release code, not debuggable, with the
 * launch log and WebView inspection switched on; see android/app/build.gradle).
 * Against a plain release build only `am start -W` and `Displayed` are read.
 *
 * It never taps the screen and never reads `Capacitor/Console` (that log
 * carries the session token on debug builds). A cold start is `am force-stop`,
 * and the script waits between runs: stopping the app within a couple of
 * seconds of a launch can interrupt the session's token rotation.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const pkg = opt('pkg', 'app.meetifyy.dev');
const runs = Number.parseInt(opt('runs', '5'), 10);
const warm = flag('warm');
const settleMs = Number.parseInt(opt('settle', '6000'), 10);
const port = Number.parseInt(opt('port', '9333'), 10);
const jsonOut = opt('json', '');
const activity = `${pkg}/app.meetifyy.MainActivity`;

const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sh = (cmd) => adb('shell', cmd);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `+934ms` and `+2s574ms` both, in milliseconds. */
function parseDuration(text) {
  const m = /\+(?:(\d+)s)?(\d+)ms/.exec(text);
  return m ? Number(m[1] || 0) * 1000 + Number(m[2]) : null;
}

/** A logcat `-v epoch` timestamp, in milliseconds. */
const logEpoch = (line) => Math.round(Number.parseFloat(line.trim().split(/\s+/)[0]) * 1000);

function readNativeLog() {
  // Two tags only, by name: nothing else in the log is read.
  const out = adb('logcat', '-d', '-v', 'epoch', '-s', 'MeetifyyLaunch:I', 'ActivityTaskManager:I');
  const native = {};
  for (const line of out.split('\n')) {
    if (line.includes('ActivityTaskManager')) {
      if (line.includes(`Displayed ${pkg}/`)) native.displayed = parseDuration(line.slice(line.indexOf('Displayed')));
      if (line.includes(`Fully drawn ${pkg}/`)) native.fullyDrawn = parseDuration(line.slice(line.indexOf('Fully drawn')));
      continue;
    }
    if (!line.includes('MeetifyyLaunch')) continue;
    const at = /at \+(\d+)ms/.exec(line) || /\+(\d+)ms/.exec(line);
    if (!at) continue;
    const ms = Number(at[1]);
    // Every line carries "ms since process start", so any of them dates the fork.
    native.processStartEpoch ??= logEpoch(line) - ms;
    if (line.includes('splash handed over')) native.splashHandedOver = ms;
    else if (line.includes('page ready via')) { native.pageReady = ms; native.pageReadyVia = /via (\w+)/.exec(line)?.[1]; }
    else if (line.includes('page painted')) native.pagePainted = ms;
    else if (line.includes('reveal starts')) native.revealStarts = ms;
    else if (line.includes('splash gone')) native.splashGone = ms;
    else if (line.includes('fully drawn')) native.fullyDrawnLog = ms;
  }
  return native;
}

/** Runs one expression in the app's page over the WebView's devtools socket. */
async function evaluateInPage(expression) {
  const pid = sh(`pidof ${pkg}`).trim().split(/\s+/)[0];
  if (!pid) return null;
  try {
    adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) return null;
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('devtools timeout')), 8000);
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id !== 1) return;
        clearTimeout(timer);
        resolve(msg.result?.result?.value ?? null);
      };
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
    ws.close();
    return result ? JSON.parse(result) : null;
  } catch {
    return null; // Not inspectable (a plain release build): the native numbers still stand.
  } finally {
    try { adb('forward', '--remove', `tcp:${port}`); } catch { /* never forwarded */ }
  }
}

const PAGE_PROBE = `(async () => {
  const buffered = (type) => new Promise((resolve) => {
    try {
      const seen = [];
      const po = new PerformanceObserver((list) => seen.push(...list.getEntries()));
      po.observe({ type, buffered: true });
      setTimeout(() => { po.disconnect(); resolve(seen); }, 150);
    } catch { resolve([]); }
  });
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]));
  const marks = {};
  for (const m of performance.getEntriesByType('mark')) {
    if (m.name.startsWith('meetifyy:') && !(m.name in marks)) marks[m.name.slice(9)] = Math.round(m.startTime);
  }
  const [lcp, shifts, long] = await Promise.all([buffered('largest-contentful-paint'), buffered('layout-shift'), buffered('longtask')]);
  const scripts = performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script' || r.initiatorType === 'link' || r.initiatorType === 'other');
  return JSON.stringify({
    timeOrigin: Math.round(performance.timeOrigin),
    path: location.pathname,
    theme: document.documentElement.getAttribute('data-theme'),
    responseEnd: Math.round(nav.responseEnd || 0),
    domInteractive: Math.round(nav.domInteractive || 0),
    dcl: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0),
    fp: paint['first-paint'] ?? null,
    fcp: paint['first-contentful-paint'] ?? null,
    lcp: lcp.length ? Math.round(lcp[lcp.length - 1].startTime) : null,
    cls: Number(shifts.filter((s) => !s.hadRecentInput).reduce((sum, s) => sum + s.value, 0).toFixed(4)),
    shifts: shifts.filter((s) => !s.hadRecentInput).map((s) => ({ at: Math.round(s.startTime), value: Number(s.value.toFixed(4)) })),
    longTasks: long.map((t) => ({ at: Math.round(t.startTime), ms: Math.round(t.duration) })),
    resources: scripts.length,
    lastScriptEnd: Math.round(Math.max(0, ...scripts.filter((r) => r.startTime < 3000).map((r) => r.responseEnd))),
    marks,
    log: window.__meetifyyPerf ? window.__meetifyyPerf.entries : undefined,
  });
})()`;

async function oneRun(index) {
  if (warm) {
    sh('input keyevent KEYCODE_HOME');
    await sleep(1500);
  } else {
    sh(`am force-stop ${pkg}`);
    await sleep(1000);
  }
  adb('logcat', '-c');
  const launchedAt = Date.now();
  const start = sh(`am start -W -n ${activity}`);
  const field = (name) => Number(new RegExp(`${name}: (\\d+)`).exec(start)?.[1] ?? Number.NaN);
  await sleep(settleMs);
  const native = readNativeLog();
  const page = await evaluateInPage(PAGE_PROBE);
  const run = {
    run: index + 1,
    state: /LaunchState: (\w+)/.exec(start)?.[1] ?? '?',
    totalTime: field('TotalTime'),
    waitTime: field('WaitTime'),
    native,
    page,
    hostLaunchEpoch: launchedAt,
  };
  // Process fork -> the document's navigation start: everything before the page exists.
  if (page && native.processStartEpoch) run.prePage = page.timeOrigin - native.processStartEpoch;
  return run;
}

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
};

const COLUMNS = [
  ['am TotalTime', (r) => r.totalTime],
  ['Displayed (TTID)', (r) => r.native.displayed],
  ['process -> page start', (r) => r.prePage],
  ['process -> reveal starts', (r) => r.native.revealStarts],
  ['Fully drawn (TTFD)', (r) => r.native.fullyDrawn],
  ['page: DCL', (r) => r.page?.dcl],
  ['page: FCP', (r) => r.page?.fcp],
  ['page: LCP', (r) => r.page?.lcp],
  ['page: auth decided', (r) => r.page?.marks['auth-decided']],
  ['page: home in DOM', (r) => r.page?.marks['fully-drawn']],
  ['page: HOME PAINTED', (r) => r.page?.marks['home-painted']],
  ['page: splash released', (r) => r.page?.marks['splash-release:frames'] ?? r.page?.marks['splash-release:timer']],
  ['page: CLS x1000', (r) => (r.page ? Math.round(r.page.cls * 1000) : null)],
  ['page: long tasks total', (r) => (r.page ? r.page.longTasks.reduce((s, t) => s + t.ms, 0) : null)],
];

const results = [];
console.log(`\n${warm ? 'WARM' : 'COLD'} start x${runs}  ${pkg}  (${sh('getprop ro.product.model').trim()}, Android ${sh('getprop ro.build.version.release').trim()})\n`);
for (let i = 0; i < runs; i += 1) {
  const r = await oneRun(i);
  results.push(r);
  console.log(`  run ${r.run}: ${r.state} total=${r.totalTime} reveal=${r.native.revealStarts ?? '-'} prePage=${r.prePage ?? '-'} homePainted=${r.page?.marks['home-painted'] ?? '-'} path=${r.page?.path ?? '-'}`);
}

console.log('\n' + 'metric (ms)'.padEnd(28) + 'median'.padStart(8) + '   runs');
for (const [name, pick] of COLUMNS) {
  const values = results.map(pick).map((v) => (Number.isFinite(v) ? v : null));
  if (values.every((v) => v === null)) continue;
  console.log(name.padEnd(28) + String(median(values)).padStart(8) + '   ' + values.map((v) => v ?? '-').join(' '));
}
console.log('');
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log(`runs written to ${jsonOut}\n`);
}
