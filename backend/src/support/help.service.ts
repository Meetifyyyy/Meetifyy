import { Injectable, NotFoundException } from '@nestjs/common';
import { HelpContentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { htmlToPlainText } from '../common/utils/sanitize-html.util';

/**
 * Only rows in this state are ever visible on the public page. Every query in
 * this service applies it - a DRAFT or ARCHIVED row must not be reachable by
 * listing, by search, or by guessing a slug.
 */
const PUBLISHED = HelpContentStatus.PUBLISHED;

/** Keeps one runaway article body from becoming a 200 KB search response. */
const EXCERPT_LENGTH = 220;
const SEARCH_LIMIT = 25;

@Injectable()
export class HelpService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The whole published help centre in one response: categories in admin order,
   * each with its published articles.
   *
   * Returned as a single payload rather than a category list plus one request
   * per category - the content is small, entirely public, and the page renders
   * every category at once, so per-category fetching would be N round-trips for
   * a payload measured in kilobytes.
   */
  async getPublicHelpCentre() {
    const categories = await this.prisma.helpCategory.findMany({
      where: { status: PUBLISHED },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        icon: true,
        articles: {
          where: { status: PUBLISHED },
          orderBy: [{ sortOrder: 'asc' }, { question: 'asc' }],
          select: {
            id: true,
            slug: true,
            question: true,
            summary: true,
            body: true,
            isFeatured: true,
          },
        },
      },
    });

    return {
      categories,
      // The FAQ strip on the page is the featured set, drawn from across
      // categories rather than being a separate hand-maintained list.
      featured: categories
        .flatMap((category) =>
          category.articles
            .filter((article) => article.isFeatured)
            .map((article) => ({
              ...article,
              categorySlug: category.slug,
              categoryTitle: category.title,
            })),
        )
        .slice(0, 12),
    };
  }

  async getPublicArticle(slug: string) {
    const article = await this.prisma.helpArticle.findFirst({
      // findFirst, not findUnique: the slug is unique but the status filter has
      // to be part of the same query, or an unpublished article would be
      // fetched and then discarded - which is a timing signal that it exists.
      where: { slug, status: PUBLISHED, category: { status: PUBLISHED } },
      select: {
        id: true,
        slug: true,
        question: true,
        summary: true,
        body: true,
        updatedAt: true,
        category: { select: { slug: true, title: true } },
      },
    });

    if (!article)
      throw new NotFoundException('That help article could not be found.');

    // Fire-and-forget: a view counter must never delay or fail the read.
    this.prisma.helpArticle
      .update({
        where: { id: article.id },
        data: { viewCount: { increment: 1 } },
      })
      .catch(() => {});

    return article;
  }

  /**
   * Public help search.
   *
   * Matches the question, the summary, the body and the admin-maintained
   * keyword list. Keywords exist precisely so an article can be found by words
   * a user would type but an editor would not write - "can't sign in" finding
   * the article titled "Resetting your password".
   */
  async searchPublicContent(rawQuery: string) {
    const query = (rawQuery ?? '').trim();

    // One character matches almost everything and is never a real search.
    if (query.length < 2) {
      return { query, results: [], total: 0 };
    }

    const contains = {
      contains: query,
      mode: Prisma.QueryMode.insensitive,
    } as const;

    const articles = await this.prisma.helpArticle.findMany({
      where: {
        status: PUBLISHED,
        category: { status: PUBLISHED },
        OR: [
          { question: contains },
          { summary: contains },
          { body: contains },
          {
            keywords: {
              hasSome: query
                .split(/\s+/)
                .filter(Boolean)
                .map((w) => w.toLowerCase()),
            },
          },
        ],
      },
      // Featured articles first: they are the ones an admin has marked as the
      // answer people usually want.
      orderBy: [
        { isFeatured: 'desc' },
        { viewCount: 'desc' },
        { sortOrder: 'asc' },
      ],
      take: SEARCH_LIMIT,
      select: {
        id: true,
        slug: true,
        question: true,
        summary: true,
        body: true,
        isFeatured: true,
        category: { select: { slug: true, title: true } },
      },
    });

    return {
      query,
      total: articles.length,
      results: articles.map(({ body, ...article }) => ({
        ...article,
        // The body is stripped to text and trimmed: search results are a list
        // of candidates, and shipping full article HTML for 25 of them is both
        // wasteful and pointless - the list does not render it.
        excerpt: article.summary || buildExcerpt(body, query),
      })),
    };
  }
}

/**
 * Builds a snippet centred on the first occurrence of the query so the reader
 * can see why the article matched, rather than always the opening sentence.
 */
function buildExcerpt(body: string, query: string): string {
  const text = htmlToPlainText(body).replace(/\s+/g, ' ');
  if (text.length <= EXCERPT_LENGTH) return text;

  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…`;

  const start = Math.max(0, at - Math.floor(EXCERPT_LENGTH / 3));
  const snippet = text.slice(start, start + EXCERPT_LENGTH).trim();
  return `${start > 0 ? '…' : ''}${snippet}${start + EXCERPT_LENGTH < text.length ? '…' : ''}`;
}
