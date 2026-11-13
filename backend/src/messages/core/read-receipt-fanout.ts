/**
 * Who is told about a read, and what each of them is told.
 *
 * After a member reads a conversation every OTHER current member gets a
 * `conversation:seen` event saying whether everyone apart from themselves has
 * now read it (`isAllRead`) and, if so, the earliest of those reads
 * (`minOtherReadAt`), which their client uses to tick messages as read.
 *
 * This used to be computed by filtering the whole roster once per member, an
 * O(N²) pass, and published as one event per member — N Redis publishes for
 * every read in an N-person group. The answer only depends on two facts about
 * the roster: how many members count as "has read" and the two earliest read
 * times. So it is computed in one pass, and members whose answer is the same
 * share one event: in practice at most three distinct answers, whatever the
 * group size. Each recipient's payload is exactly what it was before.
 */

export interface ReadReceiptParticipant {
  userId: string;
  lastReadAt: Date | string | null;
  user: { settings: { readReceipts: boolean | null } | null } | null;
}

export interface ReadReceiptAudience {
  isAllRead: boolean;
  /** ISO time of the earliest read among the others, or null. */
  minOtherReadAt: string | null;
  userIds: string[];
}

/** Counts towards "has read": receipts not switched off, and a read on record. */
function readTime(p: ReadReceiptParticipant): number | null {
  if (p.user?.settings?.readReceipts === false || p.lastReadAt == null) {
    return null;
  }
  return new Date(p.lastReadAt).getTime();
}

/**
 * Groups the members other than `readerId` by the `conversation:seen` answer
 * each of them should receive.
 */
export function readReceiptAudiences(
  participants: readonly ReadReceiptParticipant[],
  readerId: string,
): ReadReceiptAudience[] {
  const times = participants.map(readTime);
  const total = participants.length;

  let readCount = 0;
  let firstIndex = -1;
  let first = Infinity;
  let second = Infinity;
  times.forEach((t, i) => {
    if (t === null) return;
    readCount += 1;
    if (t < first) {
      second = first;
      first = t;
      firstIndex = i;
    } else if (t < second) {
      second = t;
    }
  });

  const groups = new Map<string, ReadReceiptAudience>();
  participants.forEach((p, i) => {
    if (p.userId === readerId) return;
    const ownTime = times[i];
    const othersRead = readCount - (ownTime !== null ? 1 : 0);
    const isAllRead = othersRead > 0 && othersRead === total - 1;
    // The earliest read among everyone but this member: the overall earliest,
    // unless this member is the one holding it.
    const earliestOther = i === firstIndex ? second : first;
    const minOther = isAllRead ? earliestOther : 0;
    const minOtherReadAt = minOther ? new Date(minOther).toISOString() : null;

    const key = `${isAllRead}|${minOtherReadAt ?? ''}`;
    const group = groups.get(key);
    if (group) {
      group.userIds.push(p.userId);
    } else {
      groups.set(key, { isAllRead, minOtherReadAt, userIds: [p.userId] });
    }
  });
  return [...groups.values()];
}
