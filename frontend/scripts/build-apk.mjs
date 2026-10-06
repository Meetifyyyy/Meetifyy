/**
 * Builds an Android APK and drops it in the gitignored `local/apk/` tree.
 *
 *   npm run mobile:apk            debug   -> local/apk/dev/
 *   npm run mobile:apk -- release release -> local/apk/release/
 *
 * Two variants, two directories, because mixing them up is easy and expensive:
 * a debug APK is signed with a throwaway key every machine generates for
 * itself, ships a WebView with remote debugging wide open, and must never reach
 * a real user. Filenames carry the variant too, so an APK that has been copied
 * out of here still says what it is.
 *
 * WHY MODE MATTERS MORE THAN IT LOOKS
 * `vite build` with no --mode defaults to production, which loads
 * `.env.production` and would bake the PRODUCTION API origin into what the
 * banner calls a dev build. The debug variant therefore builds with
 * `--mode development`, and the release variant with production, and each one
 * prints the origin it baked in so the wrong one is visible immediately rather
 * than after installing.
 *
 * SIGNING
 * Debug uses the Android SDK's standard debug keystore. Release is signed only
 * if `local/keystore/release.properties` exists; without it Gradle produces an
 * UNSIGNED release APK, which will not install, and this script says so rather
 * than leaving a file that fails silently on the phone.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '..');
const root = resolve(frontend, '..');
const android = resolve(frontend, 'android');

const variant = (process.argv[2] || 'debug').toLowerCase();
if (!['debug', 'release'].includes(variant)) {
  console.error(`Unknown variant "${variant}". Use "debug" or "release".`);
  process.exit(1);
}

const isRelease = variant === 'release';
const outDir = resolve(root, 'local/apk', isRelease ? 'release' : 'dev');
const viteMode = isRelease ? 'production' : 'development';
const gradleTask = isRelease ? 'assembleRelease' : 'assembleDebug';

/**
 * Sentry source-map upload for DEBUG builds from the developer's own login.
 *
 * `sentry-cli login` (or a hand-written ~/.sentryclirc) stores a token and
 * default org/project for the DEVELOPMENT Sentry org. A debug APK reports to
 * that org, so its maps may be uploaded with it: fill in whatever the shell has
 * not set. A RELEASE build never does this — it reports to the production org,
 * and a dev token there would put production maps in the dev org — so it only
 * uploads when SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT_ANDROID are exported
 * explicitly. See docs/sentry.md.
 */
function sentryEnvFromCliLogin() {
  if (isRelease) return {};
  let ini = '';
  try {
    ini = readFileSync(resolve(homedir(), '.sentryclirc'), 'utf8');
  } catch {
    return {};
  }
  const read = (section, key) => {
    const block = ini.split(/^\[/m).find((b) => b.startsWith(`${section}]`)) || '';
    return block.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
  };
  const fill = {};
  if (!process.env.SENTRY_AUTH_TOKEN && read('auth', 'token')) fill.SENTRY_AUTH_TOKEN = read('auth', 'token');
  if (!process.env.SENTRY_ORG && read('defaults', 'org')) fill.SENTRY_ORG = read('defaults', 'org');
  if (!process.env.SENTRY_PROJECT_ANDROID) fill.SENTRY_PROJECT_ANDROID = read('defaults', 'project') || 'meetifyy-android';
  return fill.SENTRY_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN ? fill : {};
}

const buildEnv = { ...process.env, ...sentryEnvFromCliLogin() };
if (buildEnv.SENTRY_AUTH_TOKEN && buildEnv.SENTRY_ORG) {
  console.log(`▸ Sentry: source maps will upload to ${buildEnv.SENTRY_ORG}/${buildEnv.SENTRY_PROJECT_ANDROID || '(no project set)'}`);
} else {
  console.log('▸ Sentry: no credentials for this build; source maps will not be uploaded');
}

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: buildEnv });

console.log(`\n▸ Building ${variant.toUpperCase()} APK (vite --mode ${viteMode})\n`);

// 1. The web bundle, in the matching mode.
run('npx', ['vite', 'build', '--config', 'vite.mobile.config.js', '--mode', viteMode], frontend);

// 2. Copy it into the native project.
run('npx', ['cap', 'sync', 'android'], frontend);

// 3. Gradle.
const gradlew = resolve(android, 'gradlew');
if (!existsSync(gradlew)) {
  console.error(`No Gradle wrapper at ${gradlew}. Has "npx cap add android" been run?`);
  process.exit(1);
}
/**
 * Make sure the wrapper is executable before running it.
 *
 * It is committed 100755 now, but a checkout on a filesystem that does not
 * carry the bit — or a zip download — still lands it 644, and the failure is an
 * opaque EACCES from spawnSync rather than anything that names the cause. One
 * chmod is cheaper than the bug report.
 */
try {
  chmodSync(gradlew, 0o755);
} catch {
  // Read-only checkout; the spawn below will report it properly if it matters.
}
if (!process.env.JAVA_HOME) {
  console.warn(
    '\n! JAVA_HOME is not set. Capacitor 8 compiles at source level 21; a JDK 17 ' +
      'build fails with "invalid source release: 21".\n',
  );
}
run(gradlew, [gradleTask, '--console=plain'], android);

// 4. Collect the artefact.
const apkDir = resolve(android, 'app/build/outputs/apk', variant);
if (!existsSync(apkDir)) {
  console.error(`Gradle produced no output at ${apkDir}`);
  process.exit(1);
}

const produced = readdirSync(apkDir).filter((f) => f.endsWith('.apk'));
if (produced.length === 0) {
  console.error(`No .apk in ${apkDir}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);
const copied = [];
for (const file of produced) {
  /**
   * Gradle names an unsigned release `app-release-unsigned.apk`. That name is
   * the warning, so it is preserved rather than tidied away into something that
   * looks installable.
   */
  const unsigned = file.includes('unsigned');
  const name = `meetifyy-${variant}${unsigned ? '-UNSIGNED' : ''}-${stamp}.apk`;
  copyFileSync(resolve(apkDir, file), resolve(outDir, name));
  copied.push({ name, unsigned });
}

console.log(`\n✓ ${variant} APK → ${outDir}`);
for (const { name, unsigned } of copied) {
  console.log(`    ${name}`);
  if (unsigned) {
    console.log(
      '    ! UNSIGNED — Android will refuse to install this. Provide a keystore\n' +
        '      at local/keystore/release.properties to sign it.',
    );
  }
}
if (!isRelease) {
  console.log('\n  adb install -r ' + resolve(outDir, copied[0].name));
}
console.log('');
