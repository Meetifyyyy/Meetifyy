/**
 * Normalizes a raw backend CrewActivity into the shape the UI (CrewCard, detail
 * pages, campus lists) expects: formatted dates, host fields flattened, member
 * arrays split into participants/pending, and slot counts. Pure and idempotent
 * on its own output, so it is safe to memoize per raw list.
 */
export function mapActivity(a) {
  if (!a) return a;
  const startDate = a.startDate ? new Date(a.startDate) : null;
  const endDate = a.endDate ? new Date(a.endDate) : null;

  const dateFormatted = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const dateLabelFormatted = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  const timeFormatted = startDate ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;

  const endDateFormatted = endDate ? endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const endTimeFormatted = endDate ? endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;

  return {
    ...a,
    date: a.startDate || null,
    endDate: a.endDate || null,
    dateFormatted,
    dateLabel: dateLabelFormatted,
    time: timeFormatted,
    endTime: endTimeFormatted,
    endDateFormatted,
    hostId: a.creatorId,
    hostName: a.creator?.displayName || a.members?.find(m => m.userId === a.creatorId)?.user?.displayName || 'Host',
    hostUsername: a.creator?.username || a.members?.find(m => m.userId === a.creatorId)?.user?.username || 'host',
    hostAvatar: a.creator?.avatar || a.members?.find(m => m.userId === a.creatorId)?.user?.avatar || '',
    participants: a.members?.filter(m => m.status === 'MEMBER').map(m => m.userId) || [],
    pendingRequests: a.members?.filter(m => m.status === 'PENDING').map(m => m.userId) || [],
    slotsFilled: a.members?.filter(m => m.status === 'MEMBER').length || 1,
    slotsNeeded: a.maxMembers || 999,
    _membersData: a.members?.map(m => m.user) || [], // Keep full user objects for UI
  };
}
