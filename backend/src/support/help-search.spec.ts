// sanitize-html and the email service pull in an ESM dependency Jest cannot
// parse; neither is what these tests are about.
jest.mock('../common/utils/sanitize-html.util', () => ({
  htmlToPlainText: (html: string) => html,
}));
jest.mock('../email/email.service', () => ({ EmailService: jest.fn() }));

import { Reflector } from '@nestjs/core';
import { HelpService } from './help.service';
import { SupportController } from './support.controller';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupportService } from './support.service';
import type { StorageService } from '../uploads/uploads.service';
import { RATE_LIMIT_POLICIES_KEY } from '../common/rate-limit/rate-limit.decorator';
import { stub } from '../common/testing/stub';

/**
 * The public help search (ID-36): a bounded term, a bounded keyword list, and
 * a per-IP budget on the route.
 */
describe('help search', () => {
  type Query = {
    where: {
      OR: Array<{
        question?: { contains: string };
        keywords?: { hasSome: string[] };
      }>;
    };
  };
  const build = () => {
    const findMany = jest.fn((_q: Query) => Promise.resolve([]));
    const service = new HelpService(
      stub<PrismaService>({ helpArticle: { findMany } }),
    );
    return { service, findMany };
  };

  it('searches at most 100 characters and 10 keywords of whatever it is sent', async () => {
    const { service, findMany } = build();
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    await service.searchPublicContent(words);

    const { OR } = findMany.mock.calls[0][0].where;
    const term = OR.find((c) => c.question)?.question?.contains ?? '';
    const keywords = OR.find((c) => c.keywords)?.keywords?.hasSome ?? [];
    expect(term.length).toBeLessThanOrEqual(100);
    expect(words.startsWith(term)).toBe(true);
    expect(keywords.length).toBeLessThanOrEqual(10);
  });

  it('treats a repeated q (an array) as no search at all', async () => {
    const { service, findMany } = build();
    const controller = new SupportController(
      stub<SupportService>(),
      service,
      stub<StorageService>(),
    );
    await expect(controller.searchHelp(['a', 'b'])).resolves.toMatchObject({
      total: 0,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('has a per-IP budget of its own', () => {
    const policies = new Reflector().get<string[]>(
      RATE_LIMIT_POLICIES_KEY,
      SupportController.prototype.searchHelp,
    );
    expect(policies).toEqual(['help.search.ip']);
  });
});
