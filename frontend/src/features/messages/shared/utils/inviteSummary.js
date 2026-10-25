/**
 * What a chat list shows for a message that is only an attachment: the kind
 * of thing shared, or the group an invite is for. Mirrors `inviteSummary` in
 * the backend (messages/core/invite-data.ts), which writes the same line as
 * the conversation's stored preview, so the list reads the same before and
 * after it refreshes.
 *
 * Never the shared content itself: a shared confession in particular carries
 * nothing but its id, and its text must not reach a chat list.
 */
const SHARE_SUMMARY = {
  postShare: 'Shared a post',
  profileShare: 'Shared a profile',
  communityShare: 'Shared a community',
  activityShare: 'Shared an activity',
  confessionShare: 'Shared a confession',
};

/** The line for `invite`, or null when it is not an attachment. */
export function inviteSummary(invite) {
  if (!invite || typeof invite !== 'object') return null;
  if (typeof invite.type === 'string' && Object.hasOwn(SHARE_SUMMARY, invite.type)) {
    return SHARE_SUMMARY[invite.type];
  }
  return invite.groupName ? `Group invite: ${invite.groupName}` : 'Group invite';
}
