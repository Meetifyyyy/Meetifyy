/**
 * FIRST-YEAR ISOLATION — the client's copy of the policy.
 *
 * ============================================================================
 * THIS IS UX ONLY. It decides which of two states a control is DRAWN in; it
 * decides nothing about what is allowed. Every rule here is enforced
 * independently by the backend (`StudentYearPolicyService`), which refuses a
 * restricted conversation, message, share, invite, match or recommendation
 * whatever the client believes — including a client that has been modified, is
 * running a stale cached bundle, or is not this client at all.
 *
 * The consequence worth stating plainly: nothing here may be the only thing
 * standing between a user and a restricted action. If you find yourself
 * reaching for one of these functions to *permit* something, the check belongs
 * on the server.
 * ============================================================================
 *
 * Mirrors `backend/src/common/student-year/` — see
 * `docs/first-year-isolation.md`. Kept deliberately small: the client never
 * parses email addresses (it is not given other students' addresses) and never
 * decides who is first-year. The server hands it two things and it reads them:
 *
 *   - `currentUser.isFirstYearStudent` — the viewer's own status, derived
 *     server-side from the verified institutional address, delivered by
 *     `/auth/sync`.
 *   - `profile.messagingRestricted` — the authoritative per-profile answer,
 *     computed by the server for this exact viewer/target pair.
 *
 * `messagingRestricted` is the one to trust. The helpers below exist for the
 * surfaces that hold a list of users rather than a resolved profile.
 */

/**
 * Whether the Message button for this profile should render in its LOCKED
 * state.
 *
 * Reads the server's flag and nothing else. A payload that predates the flag
 * (a stale cache, an older endpoint) yields `false` — the unlocked state —
 * which is the right failure mode for a UX hint: the button then behaves as it
 * always has, and the server refuses the action with its own message rather
 * than the user being locked out of someone they are allowed to message.
 */
export function isMessagingRestricted(profile) {
  return profile?.messagingRestricted === true;
}

/**
 * Whether `viewer` and `target` are in the same isolation bucket, from the
 * per-user flags a list payload carries.
 *
 * For lists only — recipient pickers, suggestion rails — where there is no
 * resolved `messagingRestricted` for each row. The server already filters
 * those lists, so this is a second line of defence against a stale cache, not
 * the filter itself.
 *
 * Returns `true` (compatible) whenever either side's status is unknown, so a
 * payload without the field behaves exactly as it did before this feature.
 */
export function areUsersCompatible(viewer, target) {
  const viewerFirstYear = viewer?.isFirstYearStudent;
  const targetFirstYear = target?.isFirstYearStudent;
  if (typeof viewerFirstYear !== 'boolean') return true;
  if (typeof targetFirstYear !== 'boolean') return true;
  return viewerFirstYear === targetFirstYear;
}

/**
 * Drops rows the viewer may not interact with from a recipient list.
 *
 * The server has already filtered every list this runs on, so this catches one
 * thing only: a row left in the in-memory query cache from before the viewer's
 * batch resolved.
 *
 * A row without the marker is KEPT, deliberately. It is tempting to fail
 * closed and drop the unmarked, but the marker is emitted by the handful of
 * endpoints that feed recipient pickers and NOT by the conversation payloads
 * the New Message modal also draws on — so dropping the unmarked would empty a
 * first-year student's picker of every person they already have a thread with.
 * That is a real regression traded against a case the server already refuses,
 * which is the wrong trade for a hint.
 *
 * So this can only ever remove a row the server would also have removed, which
 * is what makes it safe to apply anywhere.
 */
export function filterCompatibleUsers(viewer, users) {
  if (!Array.isArray(users)) return [];
  if (typeof viewer?.isFirstYearStudent !== 'boolean') return users;
  return users.filter((u) => areUsersCompatible(viewer, u));
}

/**
 * The copy shown by the Messaging Restricted modal.
 *
 * Defined here, next to the policy, and matched word for word by
 * `FIRST_YEAR_RESTRICTED_MESSAGE` in the backend service — so the dialog and
 * the API's own refusal say the same thing, and a client that falls back to
 * rendering the server error does not suddenly change voice.
 */
export const MESSAGING_RESTRICTED_TITLE = 'Messaging Restricted';

export const MESSAGING_RESTRICTED_BODY =
  'Direct messaging between first-year students and students from other years ' +
  'is temporarily restricted to help keep first-year students safe.';

/**
 * The error code the API returns when it refuses a restricted action, so a
 * failed request can raise the same modal the locked button does.
 */
export const FIRST_YEAR_RESTRICTED_CODE = 'FIRST_YEAR_RESTRICTED';

/** Whether a caught API error is this policy refusing. */
export function isFirstYearRestrictedError(error) {
  const payload = error?.response?.data ?? error?.data ?? error;
  return payload?.code === FIRST_YEAR_RESTRICTED_CODE;
}
