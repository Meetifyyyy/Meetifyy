import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreatePostDto } from './posts.controller';
import { POST_MAX_CHARS } from '../common/validation/text-length.util';

/**
 * CreatePostDto's text limit through the global pipe, configured as main.ts
 * configures it: this is what a direct API request meets. Post text is at most
 * 2,000 characters (the width of `Post.text`); a longer one is a 400, never a
 * database error.
 */
describe('CreatePostDto text through the global ValidationPipe', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const run = (body: Record<string, unknown>): Promise<unknown> =>
    Promise.resolve(
      pipe.transform(body, { type: 'body', metatype: CreatePostDto }),
    );
  const LIMIT_MESSAGE = 'Posts can be at most 2,000 characters';

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

  it('is 2,000', () => {
    expect(POST_MAX_CHARS).toBe(2000);
  });

  it('accepts exactly 2,000 characters', async () => {
    await expect(run({ text: 'a'.repeat(2000) })).resolves.toBeInstanceOf(
      CreatePostDto,
    );
  });

  it('refuses 2,001 characters with a 400 that names the limit', async () => {
    expect(await refusal({ text: 'a'.repeat(2001) })).toContain(LIMIT_MESSAGE);
  });

  it('refuses what used to pass: up to 5,000 characters', async () => {
    expect(await refusal({ text: 'a'.repeat(5000) })).toContain(LIMIT_MESSAGE);
  });

  it('counts an emoji as one character, as the column does', async () => {
    await expect(run({ text: '😀'.repeat(2000) })).resolves.toBeInstanceOf(
      CreatePostDto,
    );
    expect(await refusal({ text: '😀'.repeat(2001) })).toContain(LIMIT_MESSAGE);
  });

  it('counts line breaks, since they are stored', async () => {
    const text = `${'a'.repeat(999)}\n\n${'a'.repeat(999)}`; // 2,000
    await expect(run({ text })).resolves.toBeInstanceOf(CreatePostDto);
    expect(await refusal({ text: `${text}!` })).toContain(LIMIT_MESSAGE);
  });

  it('still allows an empty caption, for a media-only post', async () => {
    await expect(
      run({ text: '', mediaKeys: ['posts/a.webp'] }),
    ).resolves.toBeInstanceOf(CreatePostDto);
  });
});
