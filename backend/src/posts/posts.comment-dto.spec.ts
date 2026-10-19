import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateCommentDto } from './posts.controller';
import { COMMENT_MAX_CHARS } from '../common/validation/text-length.util';

/**
 * CreateCommentDto through the global pipe, configured as main.ts configures
 * it: this is what a direct API request meets. A comment or a reply is limited
 * to 500 characters; a failure is a 400 whose messages name the rule.
 */
describe('CreateCommentDto through the global ValidationPipe', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const run = (body: Record<string, unknown>): Promise<unknown> =>
    Promise.resolve(
      pipe.transform(body, { type: 'body', metatype: CreateCommentDto }),
    );

  const chars = (n: number): string => 'a'.repeat(n);
  const LIMIT_MESSAGE = `Comments can be at most ${COMMENT_MAX_CHARS} characters`;

  /** The messages of the 400 a body is refused with. */
  async function refusal(body: Record<string, unknown>): Promise<string[]> {
    const err: unknown = await run(body).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BadRequestException);
    const response = (err as BadRequestException).getResponse() as {
      message: string[];
    };
    return response.message;
  }

  it('accepts a short comment', async () => {
    await expect(run({ text: 'nice one' })).resolves.toBeInstanceOf(
      CreateCommentDto,
    );
  });

  it('accepts exactly 500 characters', async () => {
    await expect(run({ text: chars(500) })).resolves.toBeInstanceOf(
      CreateCommentDto,
    );
  });

  it('refuses 501 characters with a 400 that names the limit', async () => {
    expect(await refusal({ text: chars(501) })).toContain(LIMIT_MESSAGE);
  });

  it('applies the same limit to a reply', async () => {
    await expect(
      run({ text: chars(500), parentId: 'comment-1' }),
    ).resolves.toBeInstanceOf(CreateCommentDto);
    await refusal({ text: chars(501), parentId: 'comment-1' });
  });

  it('counts line breaks and spaces, since they are stored', async () => {
    const multiline = `${chars(249)}\n\n${chars(249)}`; // 500
    await expect(run({ text: multiline })).resolves.toBeInstanceOf(
      CreateCommentDto,
    );
    expect(await refusal({ text: `${multiline} ` })).toContain(LIMIT_MESSAGE);
  });

  it('counts an emoji as one character, as the column does', async () => {
    await expect(run({ text: '😀'.repeat(500) })).resolves.toBeInstanceOf(
      CreateCommentDto,
    );
    expect(await refusal({ text: '😀'.repeat(501) })).toContain(LIMIT_MESSAGE);
  });

  it('counts a variation selector, which the column stores', async () => {
    // 250 × U+2764 U+FE0F is 500 code points; one more character is over.
    const hearts = '\u2764\uFE0F'.repeat(250);
    await expect(run({ text: hearts })).resolves.toBeInstanceOf(
      CreateCommentDto,
    );
    expect(await refusal({ text: `${hearts}!` })).toContain(LIMIT_MESSAGE);
  });

  it('refuses a pasted block over the limit just as typed text', async () => {
    expect(await refusal({ text: `${chars(300)}\n${chars(300)}` })).toContain(
      LIMIT_MESSAGE,
    );
  });

  it('refuses empty and whitespace-only text', async () => {
    expect(await refusal({ text: '' })).toContain(
      'Write something before posting',
    );
    expect(await refusal({ text: '  \n\t  ' })).toContain(
      'Write something before posting',
    );
  });

  it('refuses a non-string text with the type error only', async () => {
    const messages = await refusal({ text: 5 });
    expect(messages).toContain('text must be a string');
  });
});
