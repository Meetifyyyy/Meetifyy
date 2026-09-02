import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_MESSAGE_TEXT_LENGTH, MESSAGE_LENGTH_WARN_AT } from '../messageLimits';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('the composer limit', () => {
  it('is 5000 characters', () => {
    expect(MAX_MESSAGE_TEXT_LENGTH).toBe(5000);
  });

  it('warns before the limit rather than at it', () => {
    expect(MESSAGE_LENGTH_WARN_AT).toBeLessThan(MAX_MESSAGE_TEXT_LENGTH);
    expect(MESSAGE_LENGTH_WARN_AT).toBeGreaterThan(0);
  });

  it('matches the server, which is the thing actually enforcing it', () => {
    /**
     * Two copies of a number in two languages is exactly the pair that drifts.
     * If the server drops to 2000 and this stays at 5000, the composer happily
     * accepts messages that are rejected on send, which is the failure this
     * limit was added to avoid in the first place.
     */
    const serverSource = readFileSync(
      resolve(repoRoot, 'backend/src/messages/core/message-limits.ts'),
      'utf8',
    );
    const match = serverSource.match(/MAX_MESSAGE_TEXT_LENGTH\s*=\s*(\d+)/);
    expect(match, 'server constant not found').not.toBeNull();
    expect(Number(match[1])).toBe(MAX_MESSAGE_TEXT_LENGTH);
  });
});
