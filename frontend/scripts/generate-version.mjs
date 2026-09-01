/**
 * Writes `public/version.json` — the identity of the build being produced.
 *
 * This is the file the launch-time version gate fetches to decide whether the
 * client is running the current deployment. It has to be generated rather than
 * committed, because its whole purpose is to differ between builds.
 *
 * WHERE THE VERSION COMES FROM
 * The commit SHA, which is the GitHub version of this build. It is read from
 * the CI environment first — Vercel populates VERCEL_GIT_COMMIT_SHA from the
 * GitHub webhook that triggered the deploy — and falls back to asking git
 * locally, then to a build timestamp if neither is available.
 *
 * WHY NOT ASK GITHUB AT RUNTIME
 * The obvious reading of "check against the latest version on GitHub" is a call
 * to api.github.com from the browser. That is the wrong mechanism here for
 * three reasons: it is rate limited to 60 requests per hour per IP for
 * unauthenticated callers, so a campus full of students behind one NAT would
 * exhaust it within minutes and every subsequent launch would fail the check;
 * it is a cross-origin round trip to a third party on the critical path of
 * every app start, which the "make the check super fast" requirement rules out;
 * and it would report the newest commit on the branch rather than the commit
 * that is actually DEPLOYED, so it would fire during the window between a push
 * and a finished build, forcing reloads that resolve to the same assets.
 *
 * Serving the deployed SHA from the deployment itself answers the real
 * question — "is the code I am running the code that is live" — in one
 * same-origin request of about sixty bytes.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function resolveVersion() {
  // Vercel (and most CI) expose the deployed commit directly.
  const fromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    '';
  if (fromEnv) return fromEnv.trim();

  // Local builds.
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // A source archive with no git metadata. A timestamp still changes between
    // builds, which is all the gate actually requires.
    return `build-${Date.now()}`;
  }
}

const version = resolveVersion();
const payload = {
  version,
  builtAt: new Date().toISOString(),
};

const outDir = path.resolve(process.cwd(), 'public');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'version.json'),
  `${JSON.stringify(payload, null, 2)}\n`,
  'utf8'
);

// Consumed by the Vite plugin that stamps the same value into index.html, so
// the running page and the file it fetches cannot disagree about what this
// build is.
process.stdout.write(`[version] ${version}\n`);
