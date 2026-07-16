import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '@shared/context/DataContext';
import { showToast } from '@shared/utils/toast';
import { isImageUrl } from '@shared/utils/avatar';

export default function CommunityAdminModal({ community, onClose }) {
  const { updateCommunity, kickMember } = useData();
  const [activeTab, setActiveTab] = useState('details');
  const avatarInputRef = useRef(null);
  const coverInputRef = useRef(null);

  // Details State
  const [name, setName] = useState(community.name || '');
  const [desc, setDesc] = useState(community.desc || '');
  const [avatar, setAvatar] = useState(community.avatar || '');
  const [coverImage, setCoverImage] = useState(community.coverImage || '');
  const [interests, setInterests] = useState(community.interests ? community.interests.join(', ') : '');
  const [rules, setRules] = useState(community.rules ? community.rules.join('\n') : '');
  
  // Settings State
  const [privacy, setPrivacy] = useState(community.privacy || 'public');
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const [allowMemberPosts, setAllowMemberPosts] = useState(community.allowMemberPosts !== false);
  
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveDetails = async (e) => {
    e.preventDefault();
    if (!name.trim() || !desc.trim()) {
      showToast('Name and Description are required');
      return;
    }
    setIsSaving(true);

    const parsedInterests = interests.split(',').map(i => i.trim()).filter(i => i);
    const parsedRules = rules.split('\n').map(g => g.trim()).filter(g => g);

    await updateCommunity(community.id, {
      name,
      desc,
      avatar,
      coverImage,
      interests: parsedInterests,
      rules: parsedRules
    });
    setIsSaving(false);
    showToast('Community details updated!');
  };

  const handleKick = async (memberId) => {
    if (window.confirm('Are you sure you want to kick this member? They will be banned from joining for 7 days.')) {
      await kickMember(community.id, memberId);
      showToast('Member kicked successfully');
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

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="no-scrollbar" style={{ background: 'var(--color-bg-white)', width: '100%', maxWidth: '600px', borderRadius: 'var(--radius-xl)', padding: '2rem', boxShadow: 'var(--shadow-premium)', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--color-text-main)', fontFamily: 'var(--font-family-display)' }}>Admin Settings</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--color-border)' }}>
          {['details', 'appearance', 'settings'].map(tab => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{ 
                background: 'none', 
                border: 'none', 
                padding: '0.5rem 0',
                cursor: 'pointer',
                fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? 'var(--color-primary)' : 'var(--color-text-muted)',
                borderBottom: activeTab === tab ? '2px solid var(--color-primary)' : '2px solid transparent',
                textTransform: 'capitalize'
              }}
            >
              {tab}
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
                style={inputStyle} 
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main)' }}>Rules (One per line)</label>
              <textarea 
                value={rules} 
                onChange={e => setRules(e.target.value)} 
                placeholder="e.g. Be respectful&#10;No spamming" 
                style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} 
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
              <button type="button" onClick={onClose} style={{ padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-bg-soft)', color: 'var(--color-text-main)', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={isSaving} style={{ padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', opacity: isSaving ? 0.7 : 1 }}>{isSaving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </form>
        )}

        {activeTab === 'appearance' && (
          <form onSubmit={handleSaveDetails} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main)' }}>Avatar Image</label>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--color-bg-alt)', overflow: 'hidden', border: '2px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {isImageUrl(avatar) ? (
                    <img src={avatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--color-text-main)' }}>
                      {avatar || (community.name ? community.name.charAt(0).toUpperCase() : 'C')}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                  <button 
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'var(--color-bg-soft)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, width: 'fit-content' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9"></path>
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                    </svg>
                    Change
                  </button>
                  <input 
                    type="file" 
                    accept="image/*"
                    ref={avatarInputRef}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => setAvatar(ev.target.result);
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </div>
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main)' }}>Cover Image</label>
              <div style={{ width: '100%', height: '120px', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-alt)', overflow: 'hidden', border: '1px solid var(--color-border)', position: 'relative' }}>
                {coverImage ? (
                  <img src={coverImage} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No Cover Image</div>
                )}
              </div>
              <button 
                type="button"
                onClick={() => coverInputRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'var(--color-bg-soft)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, width: 'fit-content' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
                Change Cover
              </button>
              <input 
                type="file" 
                accept="image/*"
                ref={coverInputRef}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => setCoverImage(ev.target.result);
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
              <button type="button" onClick={onClose} style={{ padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-bg-soft)', color: 'var(--color-text-main)', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={isSaving} style={{ padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', opacity: isSaving ? 0.7 : 1 }}>{isSaving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </form>
        )}


        {activeTab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>Community Privacy</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  {privacy === 'public' 
                    ? 'Public: Anyone can discover and join your community.' 
                    : 'Private: Users must request or be invited to join.'}
                </div>
              </div>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setIsPrivacyOpen(!isPrivacyOpen)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    padding: '0.6rem 1.1rem',
                    borderRadius: 'var(--radius-lg, 12px)',
                    border: '1px solid var(--color-border-light)',
                    background: 'var(--color-bg-white)',
                    color: 'var(--color-text-main)',
                    fontWeight: 650,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    minWidth: '120px',
                    textAlign: 'left',
                    fontFamily: 'var(--font-family-display)'
                  }}
                >
                  <span>{privacy === 'public' ? 'Public' : 'Private'}</span>
                  <svg 
                    width="12" 
                    height="12" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="3" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    style={{ transition: 'transform 0.2s', transform: isPrivacyOpen ? 'rotate(180deg)' : 'none' }}
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                {isPrivacyOpen && (
                  <>
                    <div 
                      onClick={() => setIsPrivacyOpen(false)} 
                      style={{ position: 'fixed', inset: 0, zIndex: 998 }} 
                    />
                    <div
                      style={{
                        position: 'absolute',
                        top: '110%',
                        right: 0,
                        background: 'var(--color-bg-white)',
                        border: '1px solid var(--color-border-light)',
                        borderRadius: '12px',
                        boxShadow: 'var(--shadow-lg)',
                        overflow: 'hidden',
                        zIndex: 999,
                        minWidth: '140px',
                        padding: '0.25rem'
                      }}
                    >
                      <button
                        type="button"
                        onClick={async () => {
                          setPrivacy('public');
                          setIsPrivacyOpen(false);
                          await updateCommunity(community.id, { privacy: 'public' });
                          showToast('Privacy setting updated');
                        }}
                        style={{
                          width: '100%',
                          padding: '0.65rem 1rem',
                          border: 'none',
                          background: privacy === 'public' ? 'rgba(99, 102, 241, 0.08)' : 'none',
                          color: privacy === 'public' ? 'var(--color-primary)' : 'var(--color-text-main)',
                          fontWeight: 600,
                          fontSize: '0.9rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          borderRadius: '8px',
                          fontFamily: 'var(--font-family-sans)'
                        }}
                      >
                        Public
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setPrivacy('private');
                          setIsPrivacyOpen(false);
                          await updateCommunity(community.id, { privacy: 'private' });
                          showToast('Privacy setting updated');
                        }}
                        style={{
                          width: '100%',
                          padding: '0.65rem 1rem',
                          border: 'none',
                          background: privacy === 'private' ? 'rgba(99, 102, 241, 0.08)' : 'none',
                          color: privacy === 'private' ? 'var(--color-primary)' : 'var(--color-text-main)',
                          fontWeight: 600,
                          fontSize: '0.9rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          borderRadius: '8px',
                          fontFamily: 'var(--font-family-sans)'
                        }}
                      >
                        Private
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>Allow Member Posts</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>If disabled, only admins can create new posts in the community.</div>
              </div>
              <input 
                type="checkbox" 
                checked={allowMemberPosts}
                onChange={async (e) => {
                  setAllowMemberPosts(e.target.checked);
                  await updateCommunity(community.id, { allowMemberPosts: e.target.checked });
                  showToast('Settings updated');
                }}
                style={{ width: '1.2rem', height: '1.2rem' }} 
              />
            </div>
          </div>
        )}

      </div>
    </div>,
    document.body
  );
}
