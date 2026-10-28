import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { previewText } from './message-preview';

/**
 * The conversation list's preview, as one viewer may see it.
 *
 * The latest message is stored on the conversation row (`lastMessage*`), which
 * every participant shares. Three things make it the wrong preview for one of
 * them, and the list used to ignore two of them:
 *
 * - they left or were removed: the shared preview kept following the group,
 *   so a removed member's list showed every message sent after they were
 *   gone (and the row kept jumping to the top as the group talked);
 * - they deleted that message for themselves: it stayed in their list;
 * - they cleared the chat: handled already, by hiding anything at or before
 *   the clear.
 *
 * For the first two, the viewer's own latest visible message is looked up:
 * bounded by when they left and when they cleared, skipping what they deleted
 * for themselves. Only those rows are queried (one indexed LIMIT 1 each); the
 * rest use the shared row as before.
 */
export interface ViewerPreviewRow {
  /** Internal conversation id. */
  conversationId: string;
  leftAt: Date | null;
  clearedAt: Date | null;
  lastMessageId: string | null;
  lastMessageAt: Date | null;
}

export interface ViewerPreview {
  id: string;
  createdAt: Date;
  senderId: string;
  text: string;
  type: string;
}

export async function resolveViewerPreviews(
  prisma: Pick<PrismaService, 'deletedMessage' | 'message'>,
  viewerId: string,
  rows: ViewerPreviewRow[],
): Promise<Map<string, ViewerPreview | null>> {
  const out = new Map<string, ViewerPreview | null>();
  const lastIds = rows
    .map((r) => r.lastMessageId)
    .filter((id): id is string => Boolean(id));
  const deletedForViewer =
    lastIds.length > 0
      ? await prisma.deletedMessage.findMany({
          where: { userId: viewerId, messageId: { in: lastIds } },
          select: { messageId: true },
        })
      : [];
  const deleted = new Set(deletedForViewer.map((d) => d.messageId));

  const needsOwn = rows.filter(
    (r) =>
      r.lastMessageAt &&
      ((r.leftAt && r.lastMessageAt > r.leftAt) ||
        (r.lastMessageId && deleted.has(r.lastMessageId))),
  );

  await Promise.all(
    needsOwn.map(async (r) => {
      const createdAt: Prisma.DateTimeFilter<'Message'> = {};
      if (r.leftAt) createdAt.lte = r.leftAt;
      if (r.clearedAt) createdAt.gt = r.clearedAt;
      const message = await prisma.message.findFirst({
        where: {
          conversationId: r.conversationId,
          deletedAt: null,
          ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
          deletedByUsers: { none: { userId: viewerId } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          createdAt: true,
          senderId: true,
          type: true,
          state: true,
          payload: true,
        },
      });
      out.set(
        r.conversationId,
        message
          ? {
              id: message.id,
              createdAt: message.createdAt,
              senderId: message.senderId,
              text: previewText(message),
              type: message.type.toLowerCase(),
            }
          : null,
      );
    }),
  );
  return out;
}

/**
 * The time a row sorts and dates by, for this viewer: a group they are no
 * longer in stops at the moment they left, whatever it has done since.
 */
export function viewerUpdatedAt(updatedAt: Date, leftAt: Date | null): Date {
  return leftAt && leftAt < updatedAt ? leftAt : updatedAt;
}
