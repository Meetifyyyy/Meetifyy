/**
 * A group's settings: only what does something.
 *
 * Checked against the server before this page was rewritten, setting by
 * setting. Removed, because nothing on the server or in the app ever acted on
 * them: "Group updates" (stored per member, read by nothing), "Visibility"
 * (college-only and hidden behaved exactly like everyone; there is no group
 * discovery for it to apply to) and "Allow sharing" (no check anywhere; the
 * link is the group's own address). The columns stay, because installed apps
 * still send them. Leave group and End group went too: they were also at the
 * foot of the group's details and in the chat's menu, and here they opened a
 * confirmation this page never showed, so tapping them did nothing.
 *
 * What remains, and what enforces it:
 * - Mute alerts — per member. Muted chats get no push and no unread badge.
 * - Who can join — admins. Approval routes joins to Requests (server).
 * - Reset invite links — admins. Revokes every link shared so far (server);
 *   an invite through one of them then reads "Invite link no longer valid".
 * - Who can edit group info — admins. Checked in updateGroupInfo (server).
 * - Transfer ownership — the owner.
 *
 * Values are read from the group as the server last sent it; a change shows at
 * once and is put back if the server refuses it (useGroupActions).
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from '@shared/components/icons';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './GroupSettingsPage.module.css';
import { EDIT_PERMISSION, WHO_CAN_JOIN } from '../../utils/groupSettings';

// Each option carries its own hint, and every hint has the same reserved
// height (GroupSettingsPage.module.css .choiceHint): switching never moves the
// rows below, which a hint that appeared for one option only used to do.
const JOIN_OPTIONS = [
  { value: WHO_CAN_JOIN.ANYONE, label: 'Anyone', hint: 'People with the link or an invite join straight away.' },
  { value: WHO_CAN_JOIN.APPROVAL, label: 'Approval required', hint: 'Admins review each request before anyone joins.' },
];
const EDIT_OPTIONS = [
  { value: EDIT_PERMISSION.ADMIN, label: 'Admins', hint: 'Only the owner and admins can change the name, photo and description.' },
  { value: EDIT_PERMISSION.EVERYONE, label: 'Everyone', hint: 'Any member can change the name, photo and description.' },
];

/**
 * Two equal options with one highlight that slides between them (a transform,
 * on the compositor): the labels never change weight or width, so nothing
 * around the control moves when the choice changes.
 */
function Choice({ id, label, options, value, editable, busy, onChange }) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[index];
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel} id={`${id}-label`}>{label}</span>
        <span className={`${styles.rowHint} ${styles.choiceHint}`}>{current.hint}</span>
      </div>
      {editable ? (
        <div
          className={styles.segmented}
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          aria-busy={busy || undefined}
          style={{ '--choice-index': index, '--choice-count': options.length }}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={i === index}
              className={i === index ? `${styles.segment} ${styles.segmentOn}` : styles.segment}
              onClick={() => !busy && i !== index && onChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <span className={styles.rowValue}>{current.label}</span>
      )}
    </div>
  );
}

/** "Saving…", then "Saved" or "Not saved", in a slot that is always there. */
function useSaveStatus() {
  const [status, setStatus] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const track = async (write) => {
    clearTimeout(timer.current);
    setStatus('Saving…');
    const ok = (await write()) !== false;
    setStatus(ok ? 'Saved' : 'Not saved');
    timer.current = setTimeout(() => setStatus(''), 1800);
  };
  return [status, track];
}

export default function GroupSettingsPage({
  isOwner,
  isAdmin,
  isMember,
  isClosed,
  canEditGroupInfo,
  whoCanJoin,
  editPermission,
  isMuted,
  onToggleMute,
  onChangeWhoCanJoin,
  onChangeEditPermission,
  onResetInviteLinks,
  onBack,
  onGoToEdit,
  onGoToChangeOwner,
}) {
  // One write at a time per setting: the server is the authority, and a second
  // tap while the first is out would race it.
  const [busy, setBusy] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [status, track] = useSaveStatus();
  const save = async (key, write) => {
    if (busy) return;
    setBusy(key);
    try {
      await track(write);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={sharedStyles.container}>
      <div className={sharedStyles.header}>
        <button type="button" className={sharedStyles.backBtn} onClick={onBack} aria-label="Back">
          <ChevronLeft size={20} />
        </button>
        <h2 className={sharedStyles.headerTitle}>Group settings</h2>
        <div style={{ width: '40px' }} />
      </div>

      <div className={`${sharedStyles.scrollBody} ${styles.body}`}>
        {isClosed || !isMember ? (
          <p className={styles.notice}>
            {isClosed
              ? 'This group has ended. Its settings can no longer be changed.'
              : 'You’re no longer in this group.'}
          </p>
        ) : (
          <>
            <section className={styles.section} aria-label="Notifications">
              <h3 className={styles.sectionTitle}>Notifications</h3>
              <div className={styles.card}>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowLabel} id="mute-alerts-label">Mute alerts</span>
                    <span className={styles.rowHint}>No notifications or unread count for this group.</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(isMuted)}
                    aria-labelledby="mute-alerts-label"
                    className={isMuted ? styles.switchOn : styles.switch}
                    onClick={onToggleMute}
                  >
                    <span className={styles.knob} />
                  </button>
                </div>
              </div>
            </section>

            <section className={styles.section} aria-label="Group">
              <div className={styles.sectionHead}>
                <h3 className={styles.sectionTitle}>Group</h3>
                <span
                  className={`${styles.status} ${status ? styles.statusOn : ''} ${status === 'Not saved' ? styles.statusError : ''}`}
                  role="status"
                  aria-live="polite"
                >
                  {status}
                </span>
              </div>
              <div className={styles.card}>
                {canEditGroupInfo && (
                  <button type="button" className={`${styles.row} ${styles.rowButton}`} onClick={onGoToEdit}>
                    <div className={styles.rowText}>
                      <span className={styles.rowLabel}>Group info</span>
                      <span className={styles.rowHint}>Name, photo and description</span>
                    </div>
                    <ChevronRight size={18} className={styles.chevron} />
                  </button>
                )}
                <Choice
                  id="who-can-join"
                  label="Who can join"
                  options={JOIN_OPTIONS}
                  value={whoCanJoin}
                  editable={isAdmin}
                  busy={busy === 'join'}
                  onChange={(value) => save('join', () => onChangeWhoCanJoin(value))}
                />
                <Choice
                  id="who-can-edit"
                  label="Who can edit group info"
                  options={EDIT_OPTIONS}
                  value={editPermission}
                  editable={isAdmin}
                  busy={busy === 'edit'}
                  onChange={(value) => save('edit', () => onChangeEditPermission(value))}
                />
                {isAdmin && onResetInviteLinks && (
                  <button
                    type="button"
                    className={`${styles.row} ${styles.rowButton}`}
                    onClick={() => setConfirmReset(true)}
                    disabled={busy === 'links'}
                    aria-busy={busy === 'links' || undefined}
                  >
                    <div className={styles.rowText}>
                      <span className={styles.rowLabel}>Reset invite links</span>
                      <span className={styles.rowHint}>Every link shared so far stops working.</span>
                    </div>
                  </button>
                )}
              </div>
              {!isAdmin && <p className={styles.footnote}>Only admins can change these.</p>}
            </section>

            {isOwner && (
              <section className={styles.section} aria-label="Ownership">
                <h3 className={styles.sectionTitle}>Ownership</h3>
                <div className={styles.card}>
                  <button type="button" className={`${styles.row} ${styles.rowButton}`} onClick={onGoToChangeOwner}>
                    <div className={styles.rowText}>
                      <span className={styles.rowLabel}>Transfer ownership</span>
                      <span className={styles.rowHint}>Make another member the owner. You stay as an admin.</span>
                    </div>
                    <ChevronRight size={18} className={styles.chevron} />
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <ConfirmModal
        visible={confirmReset}
        centered
        title="Reset invite links?"
        description="Links already shared stop working, inside Meetifyy and out. Invites sent in chats are not affected. Anyone can be sent a new link."
        confirmText="Reset links"
        isDestructive
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          void save('links', onResetInviteLinks);
        }}
      />
    </div>
  );
}
