import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './GroupSettingsPage.module.css';

export default function GroupSettingsPage({
  conversation,
  isOwner,
  isAdmin,
  isMember,
  isClosed,
  isEventGroup,
  canEditGroupInfo,
  whoCanJoin,
  setWhoCanJoin,
  visibility,
  setVisibility,
  allowSharing,
  setAllowSharing,
  editGroupPermission,
  setEditGroupPermission,
  groupUpdatesActive,
  setGroupUpdatesActive,
  updateGroupSettings,
  updateGroupEditPermission,
  onBack,
  onGoToEdit,
  onGoToChangeOwner,
  handleLeaveGroup,
  handleEndActivity,
  handleEndGroup
}) {
  return (
    <div className={sharedStyles.container}>
      {/* Header */}
      <div className={sharedStyles.header}>
        <button 
          type="button" 
          className={sharedStyles.backBtn} 
          onClick={onBack} 
          title="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <h2 className={sharedStyles.headerTitle}>Settings</h2>
        <div style={{ width: '40px' }} />
      </div>

      {/* Settings options list */}
      <div className={sharedStyles.scrollBody} key="settings-scroll" style={{ padding: '1rem 0' }}>
        {isClosed ? (
          <div style={{ textAlign: 'center', padding: '1rem', color: '#ef4444', fontWeight: 'bold' }}>
            This group has been closed by the Owner. This chat is now read-only.
          </div>
        ) : !isMember ? (
          <div style={{ textAlign: 'center', padding: '1rem', color: '#ef4444', fontWeight: 'bold' }}>
            You are no longer a member of this group.
          </div>
        ) : (
          <>
            {/* Category: Personalisation */}
            <div className={styles.categoryBlock}>
              <div className={styles.categoryHeader}>Personalisation</div>
              <button 
                type="button" 
                className={styles.settingRow} 
                onClick={onGoToEdit}
                style={{ cursor: canEditGroupInfo ? 'pointer' : 'default', opacity: canEditGroupInfo ? 1 : 0.7 }}
              >
                <span className={styles.settingLabel}>Edit group</span>
                <div className={styles.settingRight}>
                  <span className={styles.settingValue}>{conversation.name}</span>
                  {canEditGroupInfo ? (
                    <svg className={styles.chevronIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#888', marginLeft: '4px' }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  )}
                </div>
              </button>
            </div>

            {/* Category: Group Updates */}
            <div className={styles.categoryBlock} style={{ marginTop: '1.5rem' }}>
              <div className={styles.categoryHeader}>Group Updates</div>
              
              {/* Row with Switch */}
              <div className={styles.settingRow} style={{ cursor: 'default' }}>
                <div className={styles.settingLabelCol}>
                  <span className={styles.settingLabel}>Group Updates</span>
                  <span className={styles.settingSubtext}>Notifications of group activity in chat</span>
                </div>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={groupUpdatesActive}
                    onChange={(e) => {
                      const newVal = e.target.checked;
                      setGroupUpdatesActive(newVal);
                      updateGroupSettings(conversation.id, { groupUpdatesActive: newVal });
                    }}
                  />
                  <span className={styles.slider}></span>
                </label>
              </div>
            </div>

            {/* Category: Privacy */}
            <div className={styles.categoryBlock} style={{ marginTop: '1.5rem' }}>
              <div className={styles.categoryHeader}>Privacy</div>

              {/* Row: Who can join */}
              <button 
                type="button" 
                className={styles.settingRow}
                onClick={() => {
                  if (isAdmin) {
                    const newVal = whoCanJoin === 'Anyone' ? 'Request required' : 'Anyone';
                    setWhoCanJoin(newVal);
                    updateGroupSettings(conversation.id, { whoCanJoin: newVal });
                  }
                }}
                style={{ cursor: isAdmin ? 'pointer' : 'default', opacity: isAdmin ? 1 : 0.7 }}
              >
                <span className={styles.settingLabel}>Who can join</span>
                <div className={styles.settingRight}>
                  <span className={styles.settingValue}>{whoCanJoin}</span>
                  {isAdmin ? (
                    <svg className={styles.chevronIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#888', marginLeft: '4px' }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  )}
                </div>
              </button>

              {/* Row: Visibility */}
              <button 
                type="button" 
                className={styles.settingRow}
                onClick={() => {
                  if (isAdmin) {
                    const uniName = visibility.startsWith('Visible') ? visibility.split('Visible only to ')[1] || 'your university' : 'your university';
                    const newVal = visibility.startsWith('Visible') ? 'Hidden group' : `Visible only to ${uniName}`;
                    setVisibility(newVal);
                    updateGroupSettings(conversation.id, { visibility: newVal });
                  }
                }}
                style={{ cursor: isAdmin ? 'pointer' : 'default', opacity: isAdmin ? 1 : 0.7 }}
              >
                <span className={styles.settingLabel}>Visibility</span>
                <div className={styles.settingRight}>
                  <span className={styles.settingValue} style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {visibility}
                  </span>
                  {isAdmin ? (
                    <svg className={styles.chevronIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#888', marginLeft: '4px' }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  )}
                </div>
              </button>

              {/* Row: Allow sharing switch */}
              <div className={styles.settingRow} style={{ cursor: 'default', opacity: isAdmin ? 1 : 0.7 }}>
                <span className={styles.settingLabel}>Allow sharing</span>
                <div className={styles.settingRight} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label className={styles.switch}>
                    <input
                      type="checkbox"
                      checked={allowSharing}
                      onChange={(e) => {
                        if (isAdmin) {
                          setAllowSharing(e.target.checked);
                          updateGroupSettings(conversation.id, { allowSharing: e.target.checked });
                        }
                      }}
                      disabled={!isAdmin}
                    />
                    <span className={styles.slider} style={{ cursor: isAdmin ? 'pointer' : 'default' }}></span>
                  </label>
                  {!isAdmin && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#888' }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  )}
                </div>
              </div>
            </div>

            {/* Category: Permissions */}
            <div className={styles.categoryBlock} style={{ marginTop: '1.5rem' }}>
              <div className={styles.categoryHeader}>Permissions</div>

              <button 
                type="button" 
                className={styles.settingRow}
                onClick={() => {
                  if (isAdmin) {
                    const newVal = editGroupPermission === 'Everyone' ? 'Owner and Admins' : 'Everyone';
                    setEditGroupPermission(newVal);
                    updateGroupEditPermission(conversation.id, newVal);
                  }
                }}
                style={{ cursor: isAdmin ? 'pointer' : 'default', opacity: isAdmin ? 1 : 0.7 }}
              >
                <span className={styles.settingLabel}>Who can edit the group</span>
                <div className={styles.settingRight}>
                  <span className={styles.settingValue}>{editGroupPermission === 'Admin' ? 'Owner and Admins' : editGroupPermission}</span>
                  {isAdmin ? (
                    <svg className={styles.chevronIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#888', marginLeft: '4px' }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  )}
                </div>
              </button>
            </div>

            {/* Category: Group Actions */}
            <div className={styles.categoryBlock} style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
              <div className={styles.categoryHeader} style={{ color: '#ef4444' }}>Group Actions</div>

              {isOwner && (
                <button 
                  type="button" 
                  className={styles.settingRow}
                  onClick={onGoToChangeOwner}
                >
                  <span className={styles.settingLabel}>Change Owner</span>
                  <div className={styles.settingRight}>
                    <svg className={styles.chevronIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </div>
                </button>
              )}

              {!isOwner && (
                <button 
                  type="button" 
                  className={styles.settingRow}
                  onClick={handleLeaveGroup}
                >
                  <span className={styles.settingLabel} style={{ color: '#ef4444', fontWeight: '600' }}>Leave Group</span>
                </button>
              )}

              {isOwner && (
                <button 
                  type="button" 
                  className={styles.settingRow}
                  onClick={() => {
                    if (isEventGroup) {
                      handleEndActivity();
                    } else {
                      handleEndGroup();
                    }
                  }}
                >
                  <span className={styles.settingLabel} style={{ color: '#ef4444', fontWeight: '600' }}>End Group</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
