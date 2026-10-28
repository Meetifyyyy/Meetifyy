/**
 * A group's pending requests to join, for its owner and admins (the server
 * sends the list to them only).
 *
 * Each row reads the requester from the request itself (the server sends
 * name, handle and photo with it). It used to look them up in a users map
 * that rarely held a stranger, and fell back to a made-up "@user / Member"
 * with a profile link to a page that does not exist.
 *
 * Accept and Decline lock their row while the call is out: a second tap
 * used to send a second call, whose "not found" read as a failure. The list
 * itself comes from the group's details, which are refetched when another
 * admin answers a request or a new one arrives (`group:join_requests`).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '@shared/components/avatar/Avatar';
import { Check, X, UserCheck, ArrowLeft } from '@shared/components/icons';
import { timeAgo } from '@shared/utils/time';
import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './GroupJoinRequestsPage.module.css';

const requesterOf = (item) => {
  const user = item?.user || {};
  return {
    id: item?.userId || user.id,
    username: item?.username || user.username || '',
    name: item?.displayName || user.displayName || item?.username || user.username || 'Someone',
    avatar: item?.avatar ?? user.avatar ?? null,
    askedAt: item?.createdAt || null,
  };
};

export default function GroupJoinRequestsPage({ pendingRequests = [], onAccept, onDecline, onBack }) {
  const [working, setWorking] = useState({});

  const answer = async (userId, act) => {
    if (working[userId]) return;
    setWorking((prev) => ({ ...prev, [userId]: true }));
    try {
      await act(userId);
    } finally {
      setWorking((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  };

  const requests = pendingRequests.map(requesterOf).filter((r) => r.id);

  return (
    <div className={sharedStyles.container}>
      <div className={sharedStyles.header}>
        <button type="button" className={sharedStyles.backBtn} onClick={onBack} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <h2 className={sharedStyles.headerTitle}>Join requests</h2>
        <div style={{ width: '40px' }} />
      </div>

      <div className={sharedStyles.scrollBody}>
        {requests.length > 0 ? (
          <ul className={styles.requestsList}>
            {requests.map((r) => {
              const busy = Boolean(working[r.id]);
              const who = (
                <>
                  <Avatar src={r.avatar} name={r.name} size="44px" />
                  <span className={styles.requestUserMeta}>
                    <span className={styles.requestUserName}>{r.name}</span>
                    <span className={styles.requestUserHandle}>
                      {[r.username && `@${r.username}`, r.askedAt && `asked ${timeAgo(r.askedAt)} ago`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={r.id} className={styles.requestCard} aria-busy={busy}>
                  {r.username ? (
                    <Link to={`/profile/${r.username}`} className={styles.requestUserLink}>{who}</Link>
                  ) : (
                    <span className={styles.requestUserLink}>{who}</span>
                  )}
                  <div className={styles.requestActionRow}>
                    <button
                      type="button"
                      className={styles.approveBtn}
                      onClick={() => answer(r.id, onAccept)}
                      disabled={busy}
                      aria-label={`Accept ${r.name}`}
                    >
                      <Check size={18} />
                    </button>
                    <button
                      type="button"
                      className={styles.rejectBtn}
                      onClick={() => answer(r.id, onDecline)}
                      disabled={busy}
                      aria-label={`Decline ${r.name}`}
                    >
                      <X size={18} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.noRequestsContainer}>
            <UserCheck size={40} className={styles.noRequestsIcon} />
            <span className={styles.noRequestsTitle}>No pending requests</span>
            <span className={styles.noRequestsSub}>When people ask to join this group, their requests will appear here.</span>
          </div>
        )}
      </div>
    </div>
  );
}
