import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../context/DataContext';
import { isImageUrl } from '../../utils/avatar';
import styles from './InstantMatchFlow.module.css';

export default function InstantMatchFlow({ isOpen, onClose, onCreateActivity }) {
  const { startInstantMatch, createTemporaryGroupChat, joinCrewActivity, currentUser } = useData();
  const navigate = useNavigate();
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 300);
  }, [onClose]);
  
  const [step, setStep] = useState('preferences');
  
  const [activity, setActivity] = useState('Badminton');
  const [isCustom, setIsCustom] = useState(false);
  const [customActivity, setCustomActivity] = useState('');
  const [people, setPeople] = useState('2-3 People');
  const [time, setTime] = useState('Right Now');
  const [location, setLocation] = useState('Current Location');
  const [details, setDetails] = useState('');
  
  const [matches, setMatches] = useState(null);
  
  const handleFindMatch = async () => {
    setStep('searching');
    const finalActivity = isCustom ? (customActivity.trim() || 'Custom') : activity;
    const result = await startInstantMatch({ activity: finalActivity, people, time, location, details });
    setMatches(result);
    setStep('matched');
  };
  
  const handleJoin = async () => {
    if (!matches) return;
    const userIds = matches.users.map(u => u.id);
    const roomId = await createTemporaryGroupChat(matches.activity, userIds);
    handleClose();
    navigate('/messages', { state: { conversationId: roomId } });
  };
  
  const handleJoinActivity = async (activityId) => {
    await joinCrewActivity(activityId);
    handleClose();
    navigate('/messages', { state: { conversationId: `act_${activityId}` } });
  };

  const handleCreateActivity = () => {
    if (onCreateActivity) {
      onCreateActivity({
        activity: isCustom ? (customActivity.trim() || 'Custom') : activity,
        people,
        time,
        location,
        details
      });
    }
  };

  if (!isOpen) return null;
  
  const rootClass = `${styles.overlay}${isClosing ? ` ${styles.overlayClosing}` : ''}`;
  const sheetClass = `${styles.sheet}${isClosing ? ` ${styles.sheetClosing}` : ''}`;
  
  return (
    <div className={rootClass} onClick={handleClose}>
      <div className={sheetClass} onClick={e => e.stopPropagation()}>
        
        {step === 'preferences' && (
          <div className={`${styles.content} animate-in`}>
            <div className={styles.header}>
              <h3>Instant Match</h3>
              <button className={styles.closeBtn} onClick={handleClose}>✕</button>
            </div>
            
            <div className={styles.scrollArea}>
              <div className={styles.section}>
                <label>What do you want to do?</label>
                <div className={styles.chips}>
                  {['Badminton', 'Coffee', 'Walk', 'Movie', 'Food', 'Gym', 'Gaming', 'Study', 'Tennis', 'Cycling', 'Basketball', 'Shopping'].map(a => (
                    <button 
                      key={a} 
                      className={`${styles.chip} ${activity === a && !isCustom ? styles.chipActive : ''}`}
                      onClick={() => {
                        setActivity(a);
                        setIsCustom(false);
                      }}
                    >
                      {a === 'Badminton' ? '🏸 ' : a === 'Coffee' ? '☕ ' : a === 'Walk' ? '🚶 ' : a === 'Movie' ? '🎬 ' : a === 'Food' ? '🍔 ' : a === 'Gym' ? '🏋️ ' : a === 'Gaming' ? '🎮 ' : a === 'Study' ? '📚 ' : a === 'Tennis' ? '🎾 ' : a === 'Cycling' ? '🚴 ' : a === 'Basketball' ? '🏀 ' : a === 'Shopping' ? '🛍️ ' : ''}{a}
                    </button>
                  ))}
                  {isCustom ? (
                    <input
                      autoFocus
                      type="text"
                      className={styles.customInput}
                      value={customActivity}
                      onChange={(e) => setCustomActivity(e.target.value)}
                      placeholder="Type activity..."
                      onBlur={() => {
                        if (!customActivity.trim()) {
                          setIsCustom(false);
                          setActivity('Badminton');
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.target.blur();
                        }
                      }}
                    />
                  ) : (
                    <button 
                      className={styles.chip}
                      onClick={() => {
                        setIsCustom(true);
                        setActivity('Custom');
                      }}
                    >
                      ➕ Custom
                    </button>
                  )}
                </div>
              </div>
              
              <div className={styles.section}>
                <label>Looking for</label>
                <div className={styles.chips}>
                  {['1 Person', '2-3 People', 'Small Group (4-8)', "Doesn't Matter"].map(p => (
                    <button 
                      key={p} 
                      className={`${styles.chip} ${people === p ? styles.chipActive : ''}`}
                      onClick={() => setPeople(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className={styles.section}>
                <label>When?</label>
                <div className={styles.chips}>
                  {['Right Now', 'Within 30 mins', 'Within 1 hour', 'Today'].map(t => (
                    <button 
                      key={t} 
                      className={`${styles.chip} ${time === t ? styles.chipActive : ''}`}
                      onClick={() => setTime(t)}
                    >
                      {t === 'Right Now' ? '⚡ ' : t === 'Within 30 mins' ? '🕒 ' : t === 'Within 1 hour' ? '⏰ ' : '📅 '}{t}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className={styles.section}>
                <label>Location</label>
                <div className={styles.chips}>
                  {['Current Location', '5 km', '10 km', '20 km', 'Custom Area'].map(l => (
                    <button 
                      key={l} 
                      className={`${styles.chip} ${location === l ? styles.chipActive : ''}`}
                      onClick={() => setLocation(l)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className={styles.section}>
                <label>Add Details (Optional)</label>
                <textarea 
                  className={styles.textarea}
                  placeholder="e.g., Let's play badminton. Need 3 more players. Skill level: Intermediate."
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                />
              </div>
            </div>
            
            <div className={styles.footer}>
              <button className={styles.primaryBtn} onClick={handleFindMatch}>
                Find Match ⚡
              </button>
            </div>
          </div>
        )}
        
        {step === 'searching' && (
          <div className={`${styles.content} ${styles.centerContent} animate-in`}>
            <div className={styles.searchingAnimation}>
              <div className={styles.radar}></div>
              <div className={styles.radarIcon}>🏸</div>
            </div>
            <h3 className={styles.searchingTitle}>Finding people...</h3>
            <p className={styles.searchingSubtitle}>Searching nearby...</p>
            <div className={styles.onlineBadge}>12 people online</div>
            <p className={styles.matchingText}>Matching preferences...</p>
          </div>
        )}
        
        {step === 'matched' && matches && (
          <div className={`${styles.content} animate-in`}>
             <div className={styles.header}>
              <h3 className={styles.matchedTitle}>🏸 Match Found</h3>
              <button className={styles.closeBtn} onClick={handleClose}>✕</button>
            </div>
            
            <div className={styles.scrollArea}>
              {matches.activities && matches.activities.length > 0 && (
                <div className={styles.matchSection}>
                  <h4 className={styles.sectionTitle}>Similar Activities</h4>
                  <div className={styles.matchesCarousel}>
                    {matches.activities.map((a, i) => (
                      <div key={i} className={styles.matchCard}>
                        <div className={styles.matchAvatarWrapper}>
                          <div className={styles.matchAvatar} style={{ background: 'var(--color-secondary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 'bold' }}>
                            {a.title.charAt(0).toUpperCase()}
                          </div>
                        </div>
                        <h4>{a.title}</h4>
                        <p className={styles.matchDetail}><span>📅</span> <span>{a.dateLabel || a.date}</span></p>
                        <p className={styles.matchDetail}><span>📍</span> <span>{a.location}</span></p>
                        <p className={styles.matchDetail}><span>👥</span> <span>{a.slotsFilled}/{a.slotsNeeded} Joined</span></p>
                        <div className={styles.matchActions}>
                          <button className={styles.primaryBtn} onClick={() => handleJoinActivity(a.id)}>Join</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {matches.users && matches.users.length > 0 && (
                <div className={styles.matchSection}>
                  <h4 className={styles.sectionTitle}>People Ready to Join</h4>
                  <div className={styles.matchesCarousel}>
                    {matches.users.map((u, i) => (
                      <div key={i} className={styles.matchCard}>
                        <div className={styles.matchAvatarWrapper}>
                          {u.avatarUrl || isImageUrl(u.avatar) ? (
                            <img src={u.avatarUrl || u.avatar} alt={u.displayName || u.name} className={styles.matchAvatar} />
                          ) : (
                            <div className={styles.matchAvatar} style={{ 
                              background: 'linear-gradient(135deg, var(--color-primary), #818cf8)', 
                              color: 'white', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center',
                              fontSize: '1.5rem',
                              fontWeight: 'bold'
                            }}>
                              {(u.displayName || u.name || '?').charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <h4>{u.displayName || u.name}</h4>
                        <p className={styles.matchDetail}><span>📍</span> <span>{matches.distance}</span></p>
                        <p className={styles.matchDetail}><span>⭐️</span> <span>Intermediate</span></p>
                        <p className={styles.matchDetail}><span>👥</span> <span>Looking for {people}</span></p>
                        <p className={styles.matchDetailTime}>Joined {matches.joinedTime}</p>
                        
                        <div className={styles.matchActions}>
                          <button className={styles.secondaryBtn}>View Profile</button>
                          <button className={styles.primaryBtn} onClick={handleJoin}>Join</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className={styles.createFallbackSection}>
              <p>Didn't find what you're looking for?</p>
              <button 
                className={styles.secondaryBtn} 
                style={{ maxWidth: '300px' }}
                onClick={handleCreateActivity}
              >
                ➕ Create Your Own Activity
              </button>
            </div>
          </div>
        )}
        
      </div>
    </div>
  );
}
