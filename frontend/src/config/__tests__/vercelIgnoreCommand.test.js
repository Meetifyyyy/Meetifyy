import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Vercel ignoreCommand contract.
 *
 * Vercel reads this command's exit code inverted — 0 skips the build, 1 runs it
 * — and treats a command it cannot run as a failed deployment rather than as a
 * signal. That is not theoretical: pointing it at `scripts/await-backend.sh`
 * from a project whose root directory is `frontend/` produced
 * "No such file or directory", exit 127, and two red production deployments.
 *
 * So the command has to satisfy two properties that no amount of reading it
 * will confirm. It must find the gate from either root directory, and it must
 * never emit an exit code other than 0 or 1 — including when the gate is
 * missing, where the safe answer is 1, build. Each case below runs the real
 * command string lifted from the real config against a stub gate.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function ignoreCommandFrom(configPath) {
  const config = JSON.parse(readFileSync(join(REPO, configPath), 'utf8'));
  return config.ignoreCommand;
}

/** Runs the command in `cwd` exactly as Vercel does, returning its exit code. */
function exitCode(command, cwd) {
  try {
    execFileSync('sh', ['-c', command], { cwd, stdio: 'ignore' });
    return 0;
  } catch (err) {
    return err.status;
  }
}

describe('the Vercel ignoreCommand', () => {
  let root;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'vercel-gate-'));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'frontend'));
    mkdirSync(join(root, 'bare', 'frontend'), { recursive: true });
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function stubGate(code) {
    writeFileSync(
      join(root, 'scripts', 'await-backend.sh'),
      `#!/usr/bin/env bash\nexit ${code}\n`,
    );
  }

  // Both configs carry the same command; both projects broke the same way.
  for (const configPath of ['vercel.json', 'frontend/vercel.json']) {
    describe(configPath, () => {
      // The root directory Vercel starts in differs per project, and the config
      // cannot know which — so the command has to work from either.
      const roots = {
        'the repo root': () => root,
        'a frontend/ root directory': () => join(root, 'frontend'),
      };

      for (const [name, cwd] of Object.entries(roots)) {
        it(`passes the gate's "skip" through from ${name}`, () => {
          stubGate(0);
          expect(exitCode(ignoreCommandFrom(configPath), cwd())).toBe(0);
        });

        it(`passes the gate's "build" through from ${name}`, () => {
          stubGate(1);
          expect(exitCode(ignoreCommandFrom(configPath), cwd())).toBe(1);
        });
      }

      it('builds rather than erroring when the gate exits unexpectedly', () => {
        stubGate(42);
        expect(exitCode(ignoreCommandFrom(configPath), root)).toBe(1);
      });

      // The regression itself. 127 here is a failed deployment, not a skipped one.
      it('builds rather than erroring when the gate is missing entirely', () => {
        const cwd = join(root, 'bare', 'frontend');
        expect(exitCode(ignoreCommandFrom(configPath), cwd)).toBe(1);
      });
    });
  }

  it('is the same command in both configs', () => {
    expect(ignoreCommandFrom('vercel.json')).toBe(
      ignoreCommandFrom('frontend/vercel.json'),
    );
  });
});
