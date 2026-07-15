import sharedStyles from './ChatDetailsPanel.module.css';
import styles from './GroupEditPage.module.css';
import Avatar from '@shared/components/avatar/Avatar';
import ImageSearchModal from '@shared/components/modals/ImageSearchModal';

export default function GroupEditPage({
  conversation,
  editName,
  setEditName,
  editDesc,
  setEditDesc,
  editAvatar,
  setEditAvatar,
  isAdmin,
  isGroup,
  isEventGroup,
  fileInputRef,
  showImageSearch,
  setShowImageSearch,
  onBack,
  onSave,
  handleAvatarClick,
  handleFileChange
}) {
  return (
    <div className={sharedStyles.container}>
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
        <h2 className={sharedStyles.headerTitle}>Edit Group</h2>
        <button 
          type="button"
          className={styles.saveHeaderBtn}
          onClick={onSave}
          disabled={
            editName.trim() === conversation.name && 
            editDesc.trim() === (conversation.description || '') &&
            editAvatar === (conversation.avatar || '')
          }
        >
          Save
        </button>
      </div>

      <div className={sharedStyles.scrollBody} key="edit-group-scroll">
        <div className={styles.settingsForm}>
          {/* Avatar Section inside Settings */}
          <div className={sharedStyles.avatarSection} style={{ marginBottom: '2rem' }}>
            {isEventGroup ? (
              <Avatar
                src={conversation.avatar}
                name={conversation.name}
                size="120px"
                isGroup={true}
              />
            ) : (
              <Avatar
                src={editAvatar}
                name={editName}
                size="120px"
                isGroup={isGroup}
                onClick={handleAvatarClick}
                disableHover={true}
                className={isAdmin ? sharedStyles.avatarWrapperClickable : ''}
              />
            )}
            {isAdmin && !isEventGroup && (
              <button 
                type="button"
                className={styles.changePhotoBtn}
                onClick={handleAvatarClick}
              >
                Change Photo
              </button>
            )}
          </div>

          <input 
            type="file" 
            accept="image/*" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={handleFileChange} 
          />

          <div className={sharedStyles.section}>
            <h3 className={sharedStyles.sectionTitle}>Group Name</h3>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className={styles.textInput}
                value={editName}
                onChange={(e) => setEditName(e.target.value.substring(0, 120))}
                placeholder="Group Name"
                maxLength={120}
                style={{ paddingRight: '4.5rem' }}
              />
              <span className={styles.charCounter}>
                {editName.length}/120
              </span>
            </div>
          </div>

          <div className={sharedStyles.section} style={{ marginTop: '1.5rem' }}>
            <h3 className={sharedStyles.sectionTitle}>Description</h3>
            <div style={{ position: 'relative' }}>
              <textarea
                className={styles.textArea}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value.substring(0, 300))}
                placeholder="Add a group description..."
                maxLength={300}
                style={{ paddingBottom: '1.8rem' }}
              />
              <span className={styles.charCounter}>
                {editDesc.length}/300
              </span>
            </div>
          </div>
        </div>
      </div>
      {showImageSearch && (
        <ImageSearchModal
          onClose={() => setShowImageSearch(false)}
          onSelect={(url) => {
            setEditAvatar(url);
            setShowImageSearch(false);
          }}
        />
      )}
    </div>
  );
}
