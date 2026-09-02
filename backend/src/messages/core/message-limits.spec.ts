import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_MESSAGE_TEXT_LENGTH,
  assertMessageTextWithinLimit,
} from './message-limits';

/**
 * Message bodies had no upper bound. The only thing stopping a 100 KB message
 * was the body parser's default, and such a message was stored, fanned out over
 * sockets to every participant, and rendered by each client.
 */
describe('message length limit', () => {
  const atLimit = 'x'.repeat(MAX_MESSAGE_TEXT_LENGTH);
  const overLimit = 'x'.repeat(MAX_MESSAGE_TEXT_LENGTH + 1);

  it('is 5000 characters', () => {
    expect(MAX_MESSAGE_TEXT_LENGTH).toBe(5000);
  });

  it('accepts a message exactly at the limit', () => {
    expect(() => assertMessageTextWithinLimit(atLimit)).not.toThrow();
  });

  it('rejects one character over', () => {
    expect(() => assertMessageTextWithinLimit(overLimit)).toThrow(
      BadRequestException,
    );
  });

  it('says what the limit is, so the client can show something useful', () => {
    expect(() => assertMessageTextWithinLimit(overLimit)).toThrow(/5000/);
  });

  it('ignores a missing or non-string body', () => {
    // Media-only and invite-only messages carry no text at all; the emptiness
    // rule is a separate check and this must not pre-empt it.
    for (const value of [undefined, null, 0, {}, []]) {
      expect(() => assertMessageTextWithinLimit(value)).not.toThrow();
    }
  });

  it('counts characters, not bytes', () => {
    /**
     * A byte limit would cut a Hindi or emoji message far shorter than an
     * English one of the same visible length, and the count shown to a person
     * has to be the count enforced.
     */
    const emoji = '😀'.repeat(MAX_MESSAGE_TEXT_LENGTH / 2); // 2 UTF-16 units each
    expect(emoji.length).toBe(MAX_MESSAGE_TEXT_LENGTH);
    expect(Buffer.byteLength(emoji, 'utf8')).toBeGreaterThan(MAX_MESSAGE_TEXT_LENGTH);
    expect(() => assertMessageTextWithinLimit(emoji)).not.toThrow();
  });

  it('does not trim before measuring, so it matches the DTO exactly', () => {
    // @MaxLength counts the raw string. If this trimmed, a body of 5000 x's
    // plus whitespace would pass one layer and fail the other.
    expect(() => assertMessageTextWithinLimit(` ${atLimit} `)).toThrow(
      BadRequestException,
    );
  });
});

/**
 * There are TWO send implementations: MessagingCoreService.sendMessage, which
 * the DM and group-chat services inherit, and MessagesService.sendMessage,
 * which the REST controller and the socket gateway use. A limit present in one
 * and missing from the other would leave a whole surface unbounded, and the
 * socket path carries nearly all real traffic while bypassing the HTTP
 * ValidationPipe entirely.
 */
describe('every send path enforces it', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

  it('MessagesService.sendMessage calls the guard', () => {
    expect(read('../messages.service.ts')).toContain(
      'assertMessageTextWithinLimit(payload?.text)',
    );
  });

  it('MessagingCoreService.sendMessage calls the guard', () => {
    expect(read('./messaging-core.service.ts')).toContain(
      'assertMessageTextWithinLimit(payload?.text)',
    );
  });

  it('the DTO caps the HTTP path from the same constant', () => {
    const dto = read('./dto/send-message.dto.ts');
    expect(dto).toContain('@MaxLength(MAX_MESSAGE_TEXT_LENGTH)');
    // Never a duplicated literal: two numbers would eventually disagree.
    expect(dto).not.toMatch(/@MaxLength\(\s*\d+\s*\)/);
  });
});
