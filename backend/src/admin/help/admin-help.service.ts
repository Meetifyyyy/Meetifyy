import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HelpContentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  htmlToPlainText,
  sanitizeArticleHtml,
} from '../../common/utils/sanitize-html.util';
import {
  CreateHelpArticleDto,
  CreateHelpCategoryDto,
  ListHelpContentDto,
  SetHelpStatusDto,
  UpdateHelpArticleDto,
  UpdateHelpCategoryDto,
} from './dto/admin-help.dto';
import { ReorderDto } from '../support/dto/admin-support.dto';

/**
 * Help-content management for the Admin Dashboard's Support section.
 *
 * Unlike the public HelpService, this one reads every status - an admin has to
 * be able to see and work on drafts. That asymmetry is the whole point of
 * keeping the two services separate rather than parameterising one with a
 * "includeUnpublished" flag that a public caller could eventually reach.
 */
@Injectable()
export class AdminHelpService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Categories ───────────────────────────────────────────────────────────

  async listCategories() {
    const categories = await this.prisma.helpCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      include: {
        // Split counts: an admin ordering the public page needs to know how
        // many articles a category actually shows, not how many it contains.
        _count: { select: { articles: true } },
      },
    });

    const published = await this.prisma.helpArticle.groupBy({
      by: ['categoryId'],
      where: { status: HelpContentStatus.PUBLISHED },
      _count: { _all: true },
    });
    const publishedByCategory = new Map(
      published.map((row) => [row.categoryId, row._count._all]),
    );

    return categories.map((category) => ({
      ...category,
      articleCount: category._count.articles,
      publishedArticleCount: publishedByCategory.get(category.id) ?? 0,
    }));
  }

  async createCategory(dto: CreateHelpCategoryDto) {
    const slug = await this.ensureUniqueSlug(
      'helpCategory',
      dto.slug || slugify(dto.title),
    );
    const status = dto.status ?? HelpContentStatus.DRAFT;

    return this.prisma.helpCategory.create({
      data: {
        slug,
        title: dto.title,
        description: dto.description ?? null,
        icon: dto.icon ?? null,
        sortOrder: dto.sortOrder ?? (await this.nextCategorySortOrder()),
        status,
        ...statusTimestamps(status),
      },
    });
  }

  async updateCategory(id: string, dto: UpdateHelpCategoryDto) {
    const existing = await this.prisma.helpCategory.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Help category not found');

    // The slug is only regenerated when the admin explicitly changes it.
    // Silently re-slugging on a title edit would break every link already
    // published to a category, which is exactly the kind of breakage a CMS
    // must not cause as a side effect of fixing a typo.
    const slug =
      dto.slug && dto.slug !== existing.slug
        ? await this.ensureUniqueSlug('helpCategory', dto.slug, id)
        : undefined;

    const status = dto.status;

    return this.prisma.helpCategory.update({
      where: { id },
      data: {
        ...(slug ? { slug } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description || null }
          : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon || null } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(status
          ? { status, ...statusTimestamps(status, existing.publishedAt) }
          : {}),
      },
    });
  }

  async setCategoryStatus(id: string, dto: SetHelpStatusDto) {
    const category = await this.prisma.helpCategory.findUnique({
      where: { id },
      select: {
        id: true,
        publishedAt: true,
        _count: {
          select: {
            articles: { where: { status: HelpContentStatus.PUBLISHED } },
          },
        },
      },
    });
    if (!category) throw new NotFoundException('Help category not found');

    // Publishing an empty category would put a heading with nothing under it
    // on the public page.
    if (
      dto.status === HelpContentStatus.PUBLISHED &&
      category._count.articles === 0
    ) {
      throw new BadRequestException(
        'Publish at least one article in this category before publishing the category.',
      );
    }

    return this.prisma.helpCategory.update({
      where: { id },
      data: {
        status: dto.status,
        ...statusTimestamps(dto.status, category.publishedAt),
      },
    });
  }

  /**
   * Archives a category rather than deleting it.
   *
   * Deleting cascades to every article inside it, which is not a thing an
   * admin should be able to do with one click on content that took a while to
   * write. Archiving removes it from the public page immediately and is
   * reversible; `deleteCategory` below is the explicit, separate action.
   */
  async archiveCategory(id: string) {
    await this.requireCategory(id);
    return this.prisma.$transaction([
      this.prisma.helpArticle.updateMany({
        where: { categoryId: id },
        data: { status: HelpContentStatus.ARCHIVED, archivedAt: new Date() },
      }),
      this.prisma.helpCategory.update({
        where: { id },
        data: { status: HelpContentStatus.ARCHIVED, archivedAt: new Date() },
      }),
    ]);
  }

  /**
   * Permanent removal. Refused while the category still holds articles, so the
   * cascade can never silently take content with it - the admin has to move or
   * delete the articles first, which makes the loss deliberate.
   */
  async deleteCategory(id: string) {
    const category = await this.prisma.helpCategory.findUnique({
      where: { id },
      select: { id: true, _count: { select: { articles: true } } },
    });
    if (!category) throw new NotFoundException('Help category not found');

    if (category._count.articles > 0) {
      throw new ConflictException(
        `This category still holds ${category._count.articles} article(s). Move or delete them first, or archive the category instead.`,
      );
    }

    await this.prisma.helpCategory.delete({ where: { id } });
    return { id, deleted: true };
  }

  async reorderCategories(dto: ReorderDto) {
    await this.applyOrder('helpCategory', dto);
    return this.listCategories();
  }

  // ── Articles ─────────────────────────────────────────────────────────────

  async listArticles(query: ListHelpContentDto) {
    const where: Prisma.HelpArticleWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.featuredOnly) where.isFeatured = true;

    if (query.search?.trim()) {
      const contains = {
        contains: query.search.trim(),
        mode: Prisma.QueryMode.insensitive,
      } as const;
      where.OR = [
        { question: contains },
        { summary: contains },
        { body: contains },
        { keywords: { hasSome: [query.search.trim().toLowerCase()] } },
      ];
    }

    return this.prisma.helpArticle.findMany({
      where,
      orderBy: [
        { categoryId: 'asc' },
        { sortOrder: 'asc' },
        { question: 'asc' },
      ],
      include: {
        category: {
          select: { id: true, title: true, slug: true, status: true },
        },
      },
    });
  }

  async getArticle(id: string) {
    const article = await this.prisma.helpArticle.findUnique({
      where: { id },
      include: {
        category: {
          select: { id: true, title: true, slug: true, status: true },
        },
      },
    });
    if (!article) throw new NotFoundException('Help article not found');
    return article;
  }

  async createArticle(dto: CreateHelpArticleDto) {
    await this.requireCategory(dto.categoryId);

    const slug = await this.ensureUniqueSlug(
      'helpArticle',
      dto.slug || slugify(dto.question),
    );
    const status = dto.status ?? HelpContentStatus.DRAFT;
    const body = sanitizeArticleHtml(dto.body);

    if (htmlToPlainText(body).length === 0) {
      throw new BadRequestException(
        'The answer is empty once formatting is removed.',
      );
    }

    return this.prisma.helpArticle.create({
      data: {
        slug,
        categoryId: dto.categoryId,
        question: dto.question,
        summary: dto.summary ?? null,
        body,
        keywords: dto.keywords ?? [],
        sortOrder:
          dto.sortOrder ?? (await this.nextArticleSortOrder(dto.categoryId)),
        isFeatured: dto.isFeatured ?? false,
        status,
        ...statusTimestamps(status),
      },
      include: {
        category: {
          select: { id: true, title: true, slug: true, status: true },
        },
      },
    });
  }

  async updateArticle(id: string, dto: UpdateHelpArticleDto) {
    const existing = await this.prisma.helpArticle.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Help article not found');

    if (dto.categoryId && dto.categoryId !== existing.categoryId) {
      await this.requireCategory(dto.categoryId);
    }

    const slug =
      dto.slug && dto.slug !== existing.slug
        ? await this.ensureUniqueSlug('helpArticle', dto.slug, id)
        : undefined;

    let body: string | undefined;
    if (dto.body !== undefined) {
      body = sanitizeArticleHtml(dto.body);
      if (htmlToPlainText(body).length === 0) {
        throw new BadRequestException(
          'The answer is empty once formatting is removed.',
        );
      }
    }

    return this.prisma.helpArticle.update({
      where: { id },
      data: {
        ...(slug ? { slug } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.question !== undefined ? { question: dto.question } : {}),
        ...(dto.summary !== undefined ? { summary: dto.summary || null } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(dto.keywords !== undefined ? { keywords: dto.keywords } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
        ...(dto.status
          ? {
              status: dto.status,
              ...statusTimestamps(dto.status, existing.publishedAt),
            }
          : {}),
      },
      include: {
        category: {
          select: { id: true, title: true, slug: true, status: true },
        },
      },
    });
  }

  async setArticleStatus(id: string, dto: SetHelpStatusDto) {
    const article = await this.prisma.helpArticle.findUnique({
      where: { id },
      select: {
        id: true,
        publishedAt: true,
        category: { select: { id: true, status: true, title: true } },
      },
    });
    if (!article) throw new NotFoundException('Help article not found');

    const result = await this.prisma.helpArticle.update({
      where: { id },
      data: {
        status: dto.status,
        ...statusTimestamps(dto.status, article.publishedAt),
      },
      include: {
        category: {
          select: { id: true, title: true, slug: true, status: true },
        },
      },
    });

    // Publishing into an unpublished category is not an error - an admin often
    // prepares articles first - but it does mean the article is not actually
    // visible yet, which they need to be told.
    const hidden =
      dto.status === HelpContentStatus.PUBLISHED &&
      article.category.status !== HelpContentStatus.PUBLISHED;

    return {
      ...result,
      warning: hidden
        ? `This article is published, but its category "${article.category.title}" is not, so it won't appear publicly yet.`
        : null,
    };
  }

  async deleteArticle(id: string) {
    const article = await this.prisma.helpArticle.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Help article not found');
    await this.prisma.helpArticle.delete({ where: { id } });
    return { id, deleted: true };
  }

  async reorderArticles(dto: ReorderDto) {
    await this.applyOrder('helpArticle', dto);
    return { reordered: dto.items.length };
  }

  /**
   * Renders an article exactly as the public page would, without publishing.
   *
   * Runs the same sanitizer the save path uses, so the preview shows what will
   * actually be stored rather than the raw draft.
   */
  previewArticle(body: string) {
    const sanitized = sanitizeArticleHtml(body);
    return {
      html: sanitized,
      plainText: htmlToPlainText(sanitized),
      wasModified: sanitized !== body,
    };
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  private async requireCategory(id: string) {
    const category = await this.prisma.helpCategory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Help category not found');
    return category;
  }

  /**
   * Appends `-2`, `-3`, … until the slug is free.
   *
   * The unique index is still the authority; this only avoids handing the
   * admin a raw constraint violation for the ordinary case of two articles
   * with similar titles.
   */
  private async ensureUniqueSlug(
    model: 'helpCategory' | 'helpArticle',
    base: string,
    excludeId?: string,
  ): Promise<string> {
    const root = (slugify(base) || 'item').slice(0, 100);

    for (let suffix = 0; suffix < 50; suffix++) {
      const candidate = suffix === 0 ? root : `${root}-${suffix + 1}`;
      const clash =
        model === 'helpCategory'
          ? await this.prisma.helpCategory.findUnique({
              where: { slug: candidate },
              select: { id: true },
            })
          : await this.prisma.helpArticle.findUnique({
              where: { slug: candidate },
              select: { id: true },
            });

      if (!clash || clash.id === excludeId) return candidate;
    }

    throw new ConflictException(
      'Could not derive a unique URL for this item. Set one explicitly.',
    );
  }

  private async nextCategorySortOrder(): Promise<number> {
    const last = await this.prisma.helpCategory.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }

  private async nextArticleSortOrder(categoryId: string): Promise<number> {
    const last = await this.prisma.helpArticle.findFirst({
      where: { categoryId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }

  /**
   * Applies a whole reordering in one transaction.
   *
   * All-or-nothing matters here: a partial apply leaves the list in an order
   * that matches neither what the admin dragged nor what it was before, and
   * the UI has no way to tell that happened.
   */
  private async applyOrder(
    model: 'helpCategory' | 'helpArticle',
    dto: ReorderDto,
  ) {
    if (dto.items.length === 0) return;

    const ids = dto.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'The same item appears more than once in the new order.',
      );
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        model === 'helpCategory'
          ? this.prisma.helpCategory.update({
              where: { id: item.id },
              data: { sortOrder: item.sortOrder },
            })
          : this.prisma.helpArticle.update({
              where: { id: item.id },
              data: { sortOrder: item.sortOrder },
            }),
      ),
    );
  }
}

/**
 * Publication timestamps.
 *
 * `publishedAt` is stamped on the first publish and left alone afterwards, so
 * it keeps meaning "when this first went live" across an unpublish/republish
 * cycle - overwriting it would make an old article look newly written every
 * time someone fixed a typo in it. `archivedAt` is cleared on any move back
 * out of ARCHIVED.
 */
function statusTimestamps(
  status: HelpContentStatus,
  existingPublishedAt?: Date | null,
) {
  switch (status) {
    case HelpContentStatus.PUBLISHED:
      return {
        publishedAt: existingPublishedAt ?? new Date(),
        archivedAt: null,
      };
    case HelpContentStatus.ARCHIVED:
      return { archivedAt: new Date() };
    case HelpContentStatus.DRAFT:
      return { archivedAt: null };
  }
}

/** Title → URL segment. */
function slugify(value: string): string {
  return (
    String(value ?? '')
      // Decompose, then drop the combining marks, so "Sécurité" becomes
      // "securite" rather than losing the accented letters entirely.
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100)
  );
}
