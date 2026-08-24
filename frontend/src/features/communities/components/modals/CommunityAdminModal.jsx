import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useCommunityActions } from '@shared/hooks/useCommunityActions';
import { communitiesApi, getMediaUrl } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { isImageUrl } from '@shared/utils/avatar';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import MediaCropper from '@shared/components/media/MediaCropper';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import defaultCommunityCover from '@assets/images/default_community_cover.webp';
import styles from './CommunityAdminModal.module.css';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';

export default function CommunityAdminModal({ community, onClose, onDeleteCommunity }) {
  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(true, onClose);

  const { updateCommunity, kickMember } = useCommunityActions();
  const [activeTab, setActiveTab] = useState('details');
  const avatarInputRef = useRef(null);
  const coverInputRef = useRef(null);
  
  const [cropFile, setCropFile] = useState(null);
  const [cropType, setCropType] = useState(null); // 'avatar' or 'cover'
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingType, setUploadingType] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [kickTarget, setKickTarget] = useState(null);

  const handleDeleteCommunity = async () => {
    setIsDeleting(true);
    try {
      await communitiesApi.delete(community.id);
      showToast('Community deleted', 'success');
      onClose();
      if (onDeleteCommunity) {
        onDeleteCommunity();
      }
    } catch (err) {
      showToast(err?.message || "Couldn't delete community", 'error');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Details State
  const [name, setName] = useState(community?.name || '');
  const [desc, setDesc] = useState(community?.description || community?.desc || '');
  const [avatar, setAvatar] = useState(community?.avatar || community?.avatarKey || '');
  const [coverImage, setCoverImage] = useState(community?.coverImage || community?.coverKey || community?.cover || '');
  const [interests, setInterests] = useState(community?.interests ? (Array.isArray(community.interests) ? community.interests.join(', ') : community.interests) : '');
  const [rules, setRules] = useState(community?.rules ? (Array.isArray(community.rules) ? community.rules.join('\n') : community.rules) : '');
  
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (community) {
      setName(community.name || '');
      setDesc(community.description || community.desc || '');
      setAvatar(community.avatar || community.avatarKey || '');
      setCoverImage(community.coverImage || community.coverKey || community.cover || '');
      setInterests(community.interests ? (Array.isArray(community.interests) ? community.interests.join(', ') : community.interests) : '');
      setRules(community.rules ? (Array.isArray(community.rules) ? community.rules.join('\n') : community.rules) : '');
    }
  }, [community]);

  const handleSaveDetails = async (e) => {
    if (e) e.preventDefault();
    const finalName = name.trim();
    if (!finalName) {
      showToast('Name is required', 'error');
      return;
    }
    setIsSaving(true);

    const parsedInterests = typeof interests === 'string'
      ? interests.split(',').map(i => i.trim()).filter(Boolean)
      : (Array.isArray(interests) ? interests : []);

    const parsedRules = typeof rules === 'string'
      ? rules.split('\n').map(g => g.trim()).filter(Boolean)
      : (Array.isArray(rules) ? rules : []);

    try {
      await updateCommunity(community.id, {
        name: finalName,
        description: desc,
        desc: desc,
        avatar,
        avatarKey: avatar,
        coverImage,
        coverKey: coverImage,
        interests: parsedInterests,
        rules: parsedRules
      });
      showToast('Community updated', 'success');
      onClose();
    } catch (err) {
      console.error(err);
      showToast(err?.message || "Couldn't update community", 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKick = (memberId) => {
    setKickTarget(memberId);
  };

  const confirmKickMember = async () => {
    if (!kickTarget) return;
    try {
      await kickMember(community.id, kickTarget);
      showToast('Member removed', 'success');
    } catch (err) {
      showToast(err?.message || "Couldn't remove member", 'error');
    } finally {
      setKickTarget(null);
    }
  };

  const handleCropComplete = async (croppedFile) => {
    const currentType = cropType;
    setCropFile(null);
    setIsUploading(true);
    setUploadingType(currentType);
    try {
      const folder = currentType === 'avatar' ? 'community-icons' : 'community-covers';
      const { publicUrl } = await processAndUploadImage(croppedFile, folder, {
        maxWidthOrHeight: currentType === 'avatar' ? 512 : 1920
      });
      
      if (currentType === 'avatar') {
        setAvatar(publicUrl);
      } else {
        setCoverImage(publicUrl);
      }
    } catch (e) {
      console.error(e);
      // Report the real reason. The generic message here is the other half of
      // why a rejected upload folder went unnoticed for so long.
      showToast(e?.message || 'Upload failed', 'error');
    } finally {
      setIsUploading(false);
      setUploadingType(null);
      setCropType(null);
    }
  };

  const inputStyle = {
    padding: '0.75rem',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-soft)',
    color: 'var(--color-text-main)',
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box'
  };

  const [requests, setRequests] = useState([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  useEffect(() => {
    if (activeTab === 'requests') {
      setIsLoadingRequests(true);
      communitiesApi.getJoinRequests(community.id)
        .then((data) => setRequests(Array.isArray(data) ? data : []))
        .catch(() => setRequests([]))
        .finally(() => setIsLoadingRequests(false));
    }
  }, [activeTab, community.id]);

  const handleApproveRequest = async (requestId) => {
    try {
      await communitiesApi.approveJoinRequest(community.id, requestId);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      showToast('Request approved', 'success');
    } catch {
      showToast("Couldn't approve request", 'error');
    }
  };

  const handleDeclineRequest = async (requestId) => {
    try {
      await communitiesApi.declineJoinRequest(community.id, requestId);
      setRequests(prev => prev.filter(r => r.id !== requestId));
      showToast('Request declined', 'success');
    } catch {
      showToast("Couldn't decline request", 'error');
    }
  };

  const isPrivate = community?.isPrivate || community?.privacy === 'private';
  const availableTabs = isPrivate ? ['details', 'appearance', 'requests', 'danger zone'] : ['details', 'appearance', 'danger zone'];

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.modal} no-scrollbar`} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--color-text-main)', fontFamily: 'var(--font-family-display)' }}>Community Settings</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--color-border)' }}>
          {availableTabs.map(tab => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{ 
                background: 'none', 
                border: 'none', 
                padding: '0.5rem 0',
                cursor: 'pointer',
                fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? (tab === 'danger zone' ? 'var(--color-danger, #ef4444)' : 'var(--color-primary)') : 'var(--color-text-muted)',
                borderBottom: activeTab === tab ? `2px solid ${tab === 'danger zone' ? 'var(--color-danger, #ef4444)' : 'var(--color-primary)'}` : '2px solid transparent',
                textTransform: 'capitalize',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              {tab === 'requests' ? (
                <>
                  Join Requests
                  {requests.length > 0 && (
                    <span style={{ background: 'var(--color-primary)', color: 'white', fontSize: '0.72rem', padding: '0.1rem 0.45rem', borderRadius: '10px', fontWeight: 700 }}>
                      {requests.length}
                    </span>
                  )}
                </>
              ) : tab === 'danger zone' ? 'Danger Zone' : tab}
            </button>
          ))}
        </div>

        {activeTab === 'details' && (
          <form onSubmit={handleSaveDetails} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main)' }}>Name</label>
              <input 
                type="text" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                maxLength={30}
                style={inputStyle} 
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '-0.2rem' }}>
                {name.length} / 30
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main)' }}>Description</label>
              <textarea 
                value={desc} 
                onChange={e => setDesc(e.target.value)} 
                maxLength={250}
                style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} 
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '-0.2rem' }}>
                {desc.length} / 250
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main)' }}>Interests (Comma separated)</label>
              <input 
                type="text" 
                value={interests} 
                onChange={e => setInterests(e.target.value)} 
                placeholder="e.g. UI/UX, Figma, Typography" 
                maxLength={500}
                style={inputStyle} 
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main)' }}>Rules (One per line)</label>
              <textarea 
                value={rules} 
                onChange={e => setRules(e.target.value)} 
                placeholder="e.g. Be respectful&#10;No spamming" 
                maxLength={1000}
                style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} 
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
              <button type="button" onClick={onClose} style={{ padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-bg-soft)', color: 'var(--color-text-main)', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={isSaving} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.7 : 1 }}>
                {isSaving ? (
                  <>
                    <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', borderColor: 'white', borderTopColor: 'transparent' }} />
                    Saving...
                  </>
                ) : 'Save Changes'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'appearance' && (
          <form onSubmit={handleSaveDetails} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main)' }}>Avatar Image</label>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div style={{ position: 'relative', width: '80px', height: '80px', borderRadius: '50%', background: isImageUrl(avatar) ? 'var(--color-bg-white)' : (community.color || 'var(--color-primary)'), overflow: 'hidden', border: '2px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {isUploading && uploadingType === 'avatar' && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, borderRadius: '50%' }}>
                      <div className="spinner" style={{ width: '22px', height: '22px', borderWidth: '2.5px', borderColor: '#ffffff', borderTopColor: 'transparent' }} />
                    </div>
                  )}
                  {isImageUrl(avatar) ? (
                    <img src={getMediaUrl(avatar)} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
                  ) : (
                    <span style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#FFFFFF' }}>
                      {avatar || (community.name ? community.name.charAt(0).toUpperCase() : 'C')}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                  <button 
                    type="button"
                    disabled={isUploading}
                    onClick={() => avatarInputRef.current?.click()}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'var(--color-bg-soft)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', cursor: isUploading ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 600, width: 'fit-content', opacity: isUploading ? 0.7 : 1 }}
                  >
                    {isUploading && uploadingType === 'avatar' ? (
                      <>
                        <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', borderColor: 'currentColor', borderTopColor: 'transparent' }} />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9"></path>
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                        Change
                      </>
                    )}
                  </button>
                  <input 
                    type="file" 
                    accept="image/*"
                    ref={avatarInputRef}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setCropFile(file);
                      setCropType('avatar');
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main)' }}>Cover Image</label>
              <div style={{ width: '100%', height: '120px', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-alt)', overflow: 'hidden', border: '1px solid var(--color-border)', position: 'relative' }}>
                {isUploading && uploadingType === 'cover' && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, borderRadius: 'var(--radius-lg)' }}>
                    <div className="spinner" style={{ width: '28px', height: '28px', borderWidth: '3px', borderColor: '#ffffff', borderTopColor: 'transparent' }} />
                  </div>
                )}
                <img src={getMediaUrl(coverImage) || defaultCommunityCover} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.onerror = null; e.target.src = defaultCommunityCover; }} />
              </div>
              <button 
                type="button"
                disabled={isUploading}
                onClick={() => coverInputRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'var(--color-bg-soft)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', cursor: isUploading ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 600, width: 'fit-content', opacity: isUploading ? 0.7 : 1 }}
              >
                {isUploading && uploadingType === 'cover' ? (
                  <>
                    <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', borderColor: 'currentColor', borderTopColor: 'transparent' }} />
                    Uploading...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9"></path>
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                    </svg>
                    Change Cover
                  </>
                )}
              </button>
              <input 
                type="file" 
                accept="image/*"
                ref={coverInputRef}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setCropFile(file);
                  setCropType('cover');
                  e.target.value = '';
                }}
              />
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
              <button type="button" onClick={onClose} style={{ padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-bg-soft)', color: 'var(--color-text-main)', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={isSaving || isUploading} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: (isSaving || isUploading) ? 'not-allowed' : 'pointer', opacity: (isSaving || isUploading) ? 0.7 : 1 }}>
                {isSaving ? (
                  <>
                    <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', borderColor: 'white', borderTopColor: 'transparent' }} />
                    Saving...
                  </>
                ) : 'Save Changes'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'danger zone' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingTop: '0.5rem' }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-danger, #ef4444)' }}>
              Danger Zone
            </div>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              padding: '1.25rem',
              borderRadius: 'var(--radius-lg, 16px)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              background: 'rgba(239, 68, 68, 0.04)'
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text-main)', marginBottom: '0.25rem' }}>
                  Delete Community
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                  Once deleted, this community, its posts, members, and settings will be permanently removed. This action cannot be undone.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                style={{
                  padding: '0.7rem 1.25rem',
                  borderRadius: 'var(--radius-md, 12px)',
                  border: 'none',
                  background: 'var(--color-danger, #ef4444)',
                  color: 'white',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  alignSelf: 'flex-start'
                }}
              >
                Delete Community
              </button>
            </div>
          </div>
        )}

        {cropFile && (
          <MediaCropper
            imageFile={cropFile}
            aspect={cropType === 'avatar' ? 1 : 5}
            cropShape={cropType === 'avatar' ? 'round' : 'rect'}
            onCropComplete={handleCropComplete}
            onCancel={() => {
              setCropFile(null);
              setCropType(null);
            }}
          />
        )}

        <ConfirmModal
          visible={showDeleteConfirm}
          title="Delete Community"
          desc={`"${community.name}" and all of its content will be permanently removed.`}
          confirmText={isDeleting ? 'Deleting...' : 'Delete'}
          cancelText="Cancel"
          isDestructive={true}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteCommunity}
        />

        <ConfirmModal
          visible={Boolean(kickTarget)}
          title="Remove Member"
          desc="They will be removed and temporarily banned for 7 days."
          confirmText="Remove"
          cancelText="Cancel"
          isDestructive={true}
          onCancel={() => setKickTarget(null)}
          onConfirm={confirmKickMember}
        />




        {activeTab === 'requests' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--color-text-main)' }}>
              Pending Requests ({requests.length})
            </div>
            {requests.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                No pending join requests.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {requests.map((req) => (
                  <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-soft)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', background: 'var(--color-bg-alt)', flexShrink: 0 }}>
                        {req.user?.avatar ? (
                          <img src={getMediaUrl(req.user.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                            {req.user?.displayName?.charAt(0) || 'U'}
                          </div>
                        )}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text-main)' }}>{req.user?.displayName || req.user?.username}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>@{req.user?.username}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => handleApproveRequest(req.id)}
                        style={{ padding: '0.42rem 0.85rem', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeclineRequest(req.id)}
                        style={{ padding: '0.42rem 0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-white)', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>,
    document.body
  );
}
