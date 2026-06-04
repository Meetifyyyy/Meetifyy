import { useState } from 'react';
import { communities } from '../../data/communities';
import Post from '../feed/Post';
import ConfirmModal from '../common/ConfirmModal';

export default function CommunityView({ communityId, onBack }) {
  const comm = communities[communityId];
  const [joined, setJoined] = useState(false);
  const [memberCount, setMemberCount] = useState(comm.members);
  const [showConfirm, setShowConfirm] = useState(false);

  if (!comm) return null;

  const handleToggleJoin = () => {
    if (joined) {
      setShowConfirm(true);
    } else {
      setJoined(true);
      setMemberCount(memberCount + 1);
    }
  };

  const handleLeave = () => {
    setJoined(false);
    setMemberCount(memberCount - 1);
    setShowConfirm(false);
  };

  const maxAvatars = Math.min(comm.memberList.length, 5);

  return (
    <>
      <div className="comm-top-bar">
        <button className="comm-back" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="comm-top-name">{comm.name}</span>
      </div>

      <div className="feed">
        <div className="comm-card">
          <div className="comm-card-cover" style={{ background: comm.color }}>
            <div className="comm-card-avatar" style={{ background: comm.color }}>{comm.avatar}</div>
          </div>
          <div className="comm-card-body">
            <h2 className="comm-card-title">{comm.name}</h2>
            <p className="comm-card-desc">{comm.desc}</p>
            <div className="comm-card-members">
              <div className="comm-avatar-stack">
                {comm.memberList.slice(0, maxAvatars).map((m, i) => (
                  <div key={i} className="comm-member-mini" style={{ background: comm.tagColor }}>{m.avatar}</div>
                ))}
              </div>
              <span className="comm-member-count">
                <strong>{memberCount.toLocaleString()}</strong> members
              </span>
              <button
                className={`comm-join-btn${joined ? ' joined' : ''}`}
                onClick={handleToggleJoin}
              >
                {joined ? (
                  <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg> Joined</>
                ) : (
                  <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> Join</>
                )}
              </button>
            </div>
            <div className="comm-card-created">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {' '}Created {comm.created}
            </div>
          </div>
        </div>

        <div className="comm-section-label">Posts</div>
        {comm.posts.map((p, i) => (
          <Post key={i} name={p.user} avatar={p.avatar} time={p.time} text={p.text} initialLikes={p.likes} initialComments={p.comments} />
        ))}
      </div>

      <ConfirmModal
        visible={showConfirm}
        title={`Leave ${comm.name}?`}
        desc="You won't see posts from this community in your feed anymore."
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleLeave}
      />
    </>
  );
}
