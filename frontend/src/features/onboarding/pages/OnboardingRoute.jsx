import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/context/DataContext';
import { INTERESTS_BY_CATEGORY } from '../constants/interestsData';
import styles from './OnboardingRoute.module.css';

export default function OnboardingRoute() {
  const { currentUser, completeOnboarding } = useAuth();
  const { communities } = useData();
  const navigate = useNavigate();
  
  const [step, setStep] = useState(1);
  const [selectedInterests, setSelectedInterests] = useState([]);
  const [selectedCommunities, setSelectedCommunities] = useState([]);

  // Redirect if not a new user
  useEffect(() => {
    if (currentUser && !currentUser.isNewUser) {
      navigate('/home', { replace: true });
    }
  }, [currentUser, navigate]);

  if (!currentUser || !currentUser.isNewUser) return null;

  const toggleInterest = (id) => {
    setSelectedInterests(prev => {
      if (prev.includes(id)) {
        return prev.filter(i => i !== id);
      }
      if (prev.length >= 10) {
        return prev;
      }
      return [...prev, id];
    });
  };

  const toggleCommunity = (name) => {
    setSelectedCommunities(prev => 
      prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]
    );
  };

  const handleNext = () => {
    if (step === 1) {
      setStep(2);
    } else {
      // Finish onboarding
      const updatedCommunities = [...new Set([...(currentUser.communities || []), ...selectedCommunities])];
      completeOnboarding({ 
        communities: updatedCommunities,
        interests: selectedInterests
      });
      navigate('/home', { replace: true });
    }
  };

  // Filter communities based on selected interests for step 2
  const suggestedCommunities = Object.values(communities).filter(c => !c.isUniversity).slice(0, 5);

  return (
    <div className={styles.onboardingContainer}>
      <div className={styles.contentArea}>
        {step === 1 && (
          <div className="animate-in" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h1 className={styles.headline}>What are you into?</h1>
            <p className={styles.subheadline}>
              {selectedInterests.length >= 1
                ? `You can select up to 10 topics (${selectedInterests.length}/10)`
                : "Choose a few tags to personalize your profile and customize your feed."}
            </p>
            
            <div className={styles.categoriesWrapper}>
              {INTERESTS_BY_CATEGORY.map((category, catIndex) => {
                const row1 = category.tags.filter((_, i) => i % 2 === 0);
                const row2 = category.tags.filter((_, i) => i % 2 !== 0);
                return (
                  <div key={catIndex} className={styles.categorySection}>
                    <h2 className={styles.categoryTitle}>{category.title}</h2>
                    <div className={styles.tagsContainer}>
                      {[row1, row2].map((rowTags, rowIndex) => (
                        <div key={rowIndex} className={styles.tagsRow}>
                          {rowTags.map((tag, tagIndex) => {
                            const isSelected = selectedInterests.includes(tag.label);
                            return (
                              <div 
                                key={tagIndex}
                                className={`${styles.optionPill} ${isSelected ? styles.selected : ''}`}
                                onClick={() => toggleInterest(tag.label)}
                              >
                                <span className={styles.pillIcon}>{tag.emoji}</span>
                                <span className={styles.pillLabel}>{tag.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.actionsFooter}>
              <button 
                className={styles.continueBtn} 
                onClick={handleNext}
                disabled={selectedInterests.length === 0}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="animate-in" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h1 className={styles.headline}>Join your first spaces</h1>
            <p className={styles.subheadline}>Based on your interests, we recommend these communities.</p>
            
            <div className={styles.communitiesList}>
              {suggestedCommunities.map(comm => {
                const isImage = comm.avatar && (comm.avatar.startsWith('/') || comm.avatar.startsWith('http://') || comm.avatar.startsWith('https://') || comm.avatar.startsWith('data:'));
                return (
                  <div key={comm.id} className={styles.communityCard}>
                    <div className={styles.commInfo}>
                      <div 
                        className={styles.commAvatar}
                        style={{
                          background: isImage ? 'var(--color-bg-white)' : (comm.color || 'var(--color-primary)'),
                          color: '#ffffff'
                        }}
                      >
                        {isImage ? (
                          <img src={comm.avatar} alt={comm.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          comm.avatar || comm.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className={styles.commText}>
                        <span className={styles.commName}>{comm.name}</span>
                        <span className={styles.commDesc}>{comm.members?.toLocaleString() || '0'} members</span>
                      </div>
                    </div>
                  <button 
                    className={`${styles.joinBtn} ${selectedCommunities.includes(comm.name) ? styles.joined : ''}`}
                    onClick={() => toggleCommunity(comm.name)}
                  >
                    {selectedCommunities.includes(comm.name) ? 'Joined' : 'Join'}
                  </button>
                </div>
              )
            })}
          </div>

            <button 
              className={styles.continueBtn} 
              onClick={handleNext}
            >
              Let's go
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
