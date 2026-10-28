/**
 * Transfer ownership: the owner picks another member to take over.
 *
 * Members come from the group's own details (name, handle and photo, as the
 * server sent them). They used to be looked up in a users map that held only
 * people the app happened to have loaded, and anyone it did not hold was
 * skipped without a word, so a group with members could show "No other
 * members available". A member whose account was deleted is listed but
 * cannot be chosen.
 */
import styles from './ChatDetailsPanel.module.css';
import own from './GroupChangeOwnerPage.module.css';
import { ChevronLeft, Users, UserPlus } from '@shared/components/icons';
import Avatar from '@shared/components/avatar/Avatar';
import ConfirmModal from '@shared/components/modals/ConfirmModal';

const memberId = (m) => m?.userId || m?.id;
const memberName = (m) => m?.displayName || m?.name || m?.username || 'This member';

export default function GroupChangeOwnerPage({
  members = [],
  ownerId,
  onBack,
  onInvite,
  targetUserId,
  showConfirm,
  onChoose,
  onCancelConfirm,
  onConfirmAction,
}) {
  const candidates = members.filter((m) => memberId(m) && String(memberId(m)) !== String(ownerId));
  const target = candidates.find((m) => String(memberId(m)) === String(targetUserId));

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={onBack} aria-label="Back">
          <ChevronLeft size={20} />
        </button>
        <h2 className={styles.headerTitle}>Transfer ownership</h2>
        <div style={{ width: '40px' }} />
      </div>

      <div className={`${styles.scrollBody} ${own.body}`}>
        <div className={own.content}>
        {candidates.length > 0 ? (
          <>
            <p className={own.intro}>
              The new owner gets full control of the group, including its settings and members. You stay in the group as an admin.
            </p>
            <ul className={own.list}>
              {candidates.map((m) => {
                const id = memberId(m);
                const unavailable = Boolean(m.isDeleted || m.profileAvailable === false);
                return (
                  <li key={id} className={own.row}>
                    <Avatar src={m.avatar} name={memberName(m)} size="40px" />
                    <span className={own.meta}>
                      <span className={own.name}>{memberName(m)}</span>
                      {m.username && !unavailable && <span className={own.handle}>@{m.username}</span>}
                    </span>
                    <button
                      type="button"
                      className={own.choose}
                      onClick={() => onChoose(id)}
                      disabled={unavailable}
                    >
                      Make owner
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className={own.empty}>
            <span className={own.emptyIcon} aria-hidden="true">
              <Users size={28} />
            </span>
            <h3 className={own.emptyTitle}>No one to transfer to yet</h3>
            <p className={own.emptyText}>
              Ownership can only pass to another member of this group. Invite someone, and once they join you can make them the owner.
            </p>
            {onInvite && (
              <button type="button" className={own.emptyAction} onClick={onInvite}>
                <UserPlus size={18} />
                Invite people
              </button>
            )}
          </div>
        )}
        </div>
      </div>

      <ConfirmModal
        title="Transfer ownership"
        desc={`${memberName(target)} will become the owner of this group. You will stay in the group as an admin.`}
        visible={Boolean(showConfirm && target)}
        onCancel={onCancelConfirm}
        onConfirm={onConfirmAction}
        confirmText="Transfer"
        cancelText="Cancel"
        isDestructive
        centered
      />
    </div>
  );
}
