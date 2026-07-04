import { useState, useRef, useEffect, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useNavigate } from 'react-router-dom';
import DefaultAvatar from '../common/DefaultAvatar';
import ShareProfileModal from './ShareProfileModal';
import styles from './ProfileAbout.module.css';

export default function ProfileAbout({ profileUsername }) {
  const { getUserByUsername, currentUser, communities } = useData();
  const navigate = useNavigate();
  
  const [menuOpen, setMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleAction = (action) => {
    if (action === 'Share Profile') {
      setIsShareModalOpen(true);
    } else {
      console.log(`Action clicked: ${action}`);
    }
    setMenuOpen(false);
  };
  
  const targetUsername = profileUsername || currentUser?.username;
  const profileUser = getUserByUsername(targetUsername) || currentUser;

  if (!profileUser) return null;

  const college = profileUser.collegeId ? communities[profileUser.collegeId] : null;
  const displayCommunities = profileUser.communities ? profileUser.communities.filter(c => college ? c !== college.name : true) : [];
  
  const socialLinks = profileUser.socialLinks || {};
  const hasSocialLinks = socialLinks.instagram || socialLinks.facebook || socialLinks.linkedin || socialLinks.twitter;

  const isOwnProfile = targetUsername === currentUser?.username;

  const sharedConnections = useMemo(() => {
    if (!profileUsername || profileUsername === currentUser?.username) return [];
    const myFollowing = currentUser?.followingList || [];
    const theirFollowing = profileUser?.followingList || [];
    const mutual = myFollowing.filter(u => theirFollowing.includes(u));
    return mutual.map(uname => getUserByUsername(uname)).filter(Boolean);
  }, [profileUsername, currentUser, profileUser, getUserByUsername]);

  return (
    <div className={styles.profileSection}>
      
      {!isOwnProfile && (
        <div className={styles.desktopMenuContainer} ref={menuRef}>
          <button
            className={styles.desktopMenuBtn}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Profile options"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>

          {menuOpen && (
            <div className={styles.dropdownMenu}>
              <button className={styles.dropdownItem} onClick={() => handleAction('Share Profile')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                Share Profile
              </button>
              <button className={styles.dropdownItem} onClick={() => handleAction('Block')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                </svg>
                Block
              </button>
              <button className={`${styles.dropdownItem} ${styles.dangerItem}`} onClick={() => handleAction('Report')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                  <line x1="4" y1="22" x2="4" y2="15"></line>
                </svg>
                Report
              </button>
            </div>
          )}
        </div>
      )}
      
      <div className={styles.detailsContainer}>
        {profileUsername && profileUsername !== currentUser?.username && sharedConnections.length > 0 && (
          <div className={styles.detailGroup}>
            <h3 className={styles.groupTitle}>Shared Connections</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex' }}>
                {sharedConnections.slice(0, 3).map((conn, i) => (
                  <div
                    key={conn.username}
                    style={{
                      width: '30px', height: '30px', borderRadius: '50%',
                      background: conn.avatar && conn.avatar.length > 1
                        ? `url(${conn.avatar}) center/cover`
                        : 'linear-gradient(135deg, rgba(37, 99, 235, 0.2), rgba(59, 130, 246, 0.2))',
                      color: 'var(--color-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 600, fontSize: '0.8rem',
                      border: '2px solid var(--color-bg-white)',
                      marginLeft: i > 0 ? '-10px' : '0',
                      zIndex: 3 - i,
                      overflow: 'hidden'
                    }}
                  >
                    {conn.avatar && conn.avatar.length > 1 ? null : conn.avatar || conn.displayName?.[0] || '?'}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-main)' }}>
                {sharedConnections.length === 1 ? (
                  <>You both know <strong>{sharedConnections[0].displayName || sharedConnections[0].username}</strong>.</>
                ) : sharedConnections.length === 2 ? (
                  <>You both know <strong>{sharedConnections[0].displayName || sharedConnections[0].username}</strong> and <strong>{sharedConnections[1].displayName || sharedConnections[1].username}</strong>.</>
                ) : (
                  <>You both know <strong>{sharedConnections[0].displayName || sharedConnections[0].username}</strong>, <strong>{sharedConnections[1].displayName || sharedConnections[1].username}</strong> and {sharedConnections.length - 2} other{sharedConnections.length - 2 > 1 ? 's' : ''}.</>
                )}
              </div>
            </div>
          </div>
        )}

        {college && (
          <div className={styles.detailGroup}>
            <h3 className={styles.groupTitle}>College</h3>
            <div className={styles.collegeItem} onClick={() => navigate(`/colleges/${college.id}`)}>
               <img src={college.avatar} alt={college.name} className={styles.collegeIcon} />
               <div className={styles.collegeInfo}>
                 <div className={styles.collegeName}>{college.name}</div>
                 <div className={styles.collegeCourse}>{profileUser.course} • {profileUser.year}</div>
               </div>
            </div>
          </div>
        )}

        {displayCommunities.length > 0 && (
          <div className={styles.detailGroup}>
            <h3 className={styles.groupTitle}>Communities</h3>
            <div className={styles.communitiesList}>
              {displayCommunities.map((c, i) => {
                const commObj = Object.values(communities).find(comm => comm.name === c);
                if (!commObj) return null;
                return (
                  <div 
                    key={i} 
                    className={styles.communityCard}
                    onClick={() => navigate(`/communities/${commObj.id}`)}
                  >
                    {commObj.avatar && commObj.avatar.length > 5 ? (
                      <img src={commObj.avatar} alt={c} className={styles.communityAvatar} />
                    ) : (
                      <div className={styles.communityAvatarFallback} style={commObj.color ? { background: commObj.color } : {}}>
                        {commObj.avatar && commObj.avatar.length <= 5 ? commObj.avatar : c.charAt(0)}
                      </div>
                    )}
                    <div className={styles.communityInfo}>
                      <span className={styles.communityName}>{c}</span>
                      <span className={styles.communityMembers}>{commObj.members || 0} members</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {displayCommunities.length === 0 && (
          <div className={styles.detailGroup}>
            <h3 className={styles.groupTitle}>Communities</h3>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', 
              padding: '2rem 1rem', background: 'var(--color-bg-white)', 
              borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)',
              textAlign: 'center', gap: '0.75rem'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-light)" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <div style={{color: 'var(--color-text-muted)', fontSize: '0.9rem'}}>Not part of any communities yet.</div>
              {profileUser.id === currentUser?.id && (
                <button onClick={() => navigate('/communities')} style={{
                  padding: '0.5rem 1rem', background: 'var(--color-bg-main)', color: 'var(--color-text-main)',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)',
                  fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', marginTop: '0.5rem'
                }}>
                  Explore Communities
                </button>
              )}
            </div>
          </div>
        )}

        {hasSocialLinks && (
          <div className={styles.detailGroup}>
            <h3 className={styles.groupTitle}>Social Links</h3>
            <div className={styles.socialLinks}>
              {socialLinks.instagram && (
                <a href={socialLinks.instagram} target="_blank" rel="noopener noreferrer" className={`${styles.socialBtn} ${styles.socialInstagram}`} aria-label="Instagram">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
                  <span>Instagram</span>
                </a>
              )}
              {socialLinks.facebook && (
                <a href={socialLinks.facebook} target="_blank" rel="noopener noreferrer" className={`${styles.socialBtn} ${styles.socialFacebook}`} aria-label="Facebook">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
                  <span>Facebook</span>
                </a>
              )}
              {socialLinks.linkedin && (
                <a href={socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className={`${styles.socialBtn} ${styles.socialLinkedin}`} aria-label="LinkedIn">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>
                  <span>LinkedIn</span>
                </a>
              )}
              {socialLinks.twitter && (
                <a href={socialLinks.twitter} target="_blank" rel="noopener noreferrer" className={`${styles.socialBtn} ${styles.socialTwitter}`} aria-label="Twitter">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"></path></svg>
                  <span>Twitter</span>
                </a>
              )}
            </div>
          </div>
        )}
      </div>
      
      <ShareProfileModal 
        isOpen={isShareModalOpen} 
        onClose={() => setIsShareModalOpen(false)} 
        profileUser={profileUser} 
      />
    </div>
  );
}
