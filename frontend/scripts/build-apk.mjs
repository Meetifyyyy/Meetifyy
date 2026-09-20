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
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: process.env });

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
