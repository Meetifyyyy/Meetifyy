import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

const MEDIA_URL_PREFIX = '/api/media/';

/**
 * Shared platform assets (defaults, presets, system art). They are not owned by
 * the person who picks them, so they are exempt from ownership checks — and
 * must never be deleted. `MediaCleanupService.isProtectedKey` delegates here so
 * the two cannot drift.
 */
export function isProtectedMediaKey(key: string): boolean {
  if (!key) return true;
  const lower = key.toLowerCase();
  return (
    lower.startsWith('defaults/') ||
    lower.startsWith('v2-defaults/') ||
    lower.startsWith('presets/') ||
    lower.startsWith('system/') ||
    lower.startsWith('assets/') ||
    lower.startsWith('mock-') ||
    lower.startsWith('support/') ||
    lower.includes('preset-') ||
    lower.includes('default-')
  );
}

/** The storage key behind an uploaded-media reference, or null for anything else. */
function uploadedKey(ref: string | null | undefined): string | null {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (!trimmed.startsWith(MEDIA_URL_PREFIX)) return null;
  return trimmed.slice(MEDIA_URL_PREFIX.length) || null;
}

/**
 * Refuses to attach media that someone else uploaded.
 *
 * Profile, community and activity images are linked to their Media row by
 * object key, and nothing checked who owned that row: a caller who knew (or
 * guessed) another user's key could attach it to their own avatar, cover or
 * community, and the cleanup that runs when the image is later replaced would
 * then delete the original owner's file.
 *
 * Only uploaded references (`/api/media/<key>`) are checked. Protected shared
 * assets, external URLs (which are connect-or-create and carry no upload) and
 * gradients are not ownership questions. `unchanged` lists references the
 * entity already holds, so re-saving an untouched image never fails.
 */
export async function assertMediaRefsOwnedBy(
  prisma: Pick<PrismaService, 'media'>,
  userId: string,
  refs: Array<string | null | undefined>,
  unchanged: Array<string | null | undefined> = [],
): Promise<void> {
  const already = new Set(unchanged.filter((r): r is string => !!r));
  const keys = new Set<string>();
  for (const ref of refs) {
    if (!ref || already.has(ref)) continue;
    const key = uploadedKey(ref);
    if (key && !isProtectedMediaKey(key)) keys.add(key);
  }
  if (keys.size === 0) return;

  const rows = await prisma.media.findMany({
    where: { objectKey: { in: [...keys] } },
    select: { objectKey: true, ownerId: true },
  });
  const ownerByKey = new Map(rows.map((r) => [r.objectKey, r.ownerId]));
  for (const key of keys) {
    // A missing row is left to the relation write, which already fails on it;
    // a row that exists must belong to the caller.
    if (ownerByKey.has(key) && ownerByKey.get(key) !== userId) {
      throw new ForbiddenException('You can only use images you uploaded');
    }
  }
}

/** The same check for a Media row referenced by id (e.g. an activity cover). */
export async function assertMediaIdOwnedBy(
  prisma: Pick<PrismaService, 'media'>,
  userId: string,
  mediaId: string | null | undefined,
): Promise<void> {
  if (!mediaId) return;
  const row = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { ownerId: true, objectKey: true },
  });
  if (!row) return;
  if (isProtectedMediaKey(row.objectKey)) return;
  if (row.ownerId !== userId) {
    throw new ForbiddenException('You can only use images you uploaded');
  }
}
