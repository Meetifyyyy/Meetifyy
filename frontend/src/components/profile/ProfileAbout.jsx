import { useData } from '../../context/DataContext';
import { useNavigate } from 'react-router-dom';
import styles from './ProfileAbout.module.css';

export default function ProfileAbout({ profileUsername }) {
  const { getUserByUsername, currentUser, communities } = useData();
  const navigate = useNavigate();
  
  const targetUsername = profileUsername || currentUser?.username;
  const profileUser = getUserByUsername(targetUsername) || currentUser;

  if (!profileUser) return null;

  const college = profileUser.collegeId ? communities[profileUser.collegeId] : null;
  const displayCommunities = profileUser.communities ? profileUser.communities.filter(c => college ? c !== college.name : true) : [];

  return (
    <div className={styles.profileSection}>
      
      <div className={styles.detailsContainer}>
        {profileUsername && profileUsername !== currentUser?.username && (
          <div className={styles.detailGroup}>
            <h3 className={styles.groupTitle}>Shared Connections</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--color-bg-main)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex' }}>
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.2), rgba(59, 130, 246, 0.2))', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.8rem', border: '2px solid var(--color-bg-white)', zIndex: 2 }}>A</div>
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(52, 211, 153, 0.2))', color: 'var(--color-success, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.8rem', border: '2px solid var(--color-bg-white)', marginLeft: '-10px', zIndex: 1 }}>S</div>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-main)' }}>You both know <strong>Alex T.</strong> and <strong>Sam Rivera</strong>.</div>
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
                const commId = Object.values(communities).find(comm => comm.name === c)?.id;
                return (
                  <button 
                    key={i} 
                    className={styles.communityTag}
                    onClick={() => commId && navigate(`/communities/${commId}`)}
                  >
                    {c}
                  </button>
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

        <div className={styles.detailGroup}>
          <h3 className={styles.groupTitle}>Social Links</h3>
          <div className={styles.socialLinks}>
            {profileUser.socialLinks?.instagram && (
              <a href={profileUser.socialLinks.instagram} target="_blank" rel="noopener noreferrer" className={styles.socialIcon} aria-label="Instagram" title="Instagram">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
              </a>
            )}
            {profileUser.socialLinks?.linkedin && (
              <a href={profileUser.socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className={styles.socialIcon} aria-label="LinkedIn" title="LinkedIn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
              </a>
            )}
            {profileUser.socialLinks?.github && (
              <a href={profileUser.socialLinks.github} target="_blank" rel="noopener noreferrer" className={styles.socialIcon} aria-label="GitHub" title="GitHub">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              </a>
            )}
            {profileUser.socialLinks?.twitter && (
              <a href={profileUser.socialLinks.twitter} target="_blank" rel="noopener noreferrer" className={styles.socialIcon} aria-label="Twitter / X" title="Twitter / X">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
            )}
            {profileUser.socialLinks?.website && (
              <a href={profileUser.socialLinks.website} target="_blank" rel="noopener noreferrer" className={styles.socialIcon} aria-label="Website" title="Website">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              </a>
            )}
            {/* Empty state for own profile */}
            {profileUser.id === currentUser?.id &&
              !profileUser.socialLinks?.instagram &&
              !profileUser.socialLinks?.linkedin &&
              !profileUser.socialLinks?.github &&
              !profileUser.socialLinks?.twitter &&
              !profileUser.socialLinks?.website && (
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', fontStyle: 'italic' }}>
                No links yet — add them in <button onClick={() => navigate('/settings')} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: '0.8rem' }}>Settings</button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
