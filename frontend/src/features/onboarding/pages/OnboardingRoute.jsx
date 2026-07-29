import { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';

import { INTERESTS_BY_CATEGORY } from '../constants/interestsData';
import styles from './OnboardingRoute.module.css';
import { useData } from '@shared/hooks/useData';
import { communitiesApi } from '@shared/api/apiClient';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import Background from '@shared/components/ui/Background';

const FEATURED_INTERESTS = [
  { emoji: "📚", label: "Reading" },
  { emoji: "📸", label: "Photography" },
  { emoji: "💻", label: "Coding & Tech" },
  { emoji: "🏋️", label: "Gym & Fitness" },
  { emoji: "✈️", label: "Traveling" },
  { emoji: "🎨", label: "Graphic Design" },
  { emoji: "🎤", label: "Arijit Singh" },
  { emoji: "🎧", label: "AP Dhillon" },
  { emoji: "🎯", label: "BGMI / PUBG" },
  { emoji: "🔥", label: "Valorant" },
  { emoji: "🏏", label: "Cricket" },
  { emoji: "⚽", label: "Football" },
  { emoji: "☕", label: "Coffee & Tea" },
  { emoji: "🎬", label: "Movies & Cinema" },
  { emoji: "⚡", label: "Anime" },
];

export default function OnboardingRoute() {
  const { currentUser, completeOnboarding } = useAuth();
  const { communities } = useData();
  const navigate = useNavigate();
  
  const [step, setStep] = useState(1);
  const [selectedInterests, setSelectedInterests] = useState([]);
  const [selectedCommunities, setSelectedCommunities] = useState([]); // stores community IDs
  const [isCompleting, setIsCompleting] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const loadingMessages = [
    'Creating your profile...',
    'Saving your interests...',
    'Setting up your campus circle...',
    'Almost ready!'
  ];



  // Completely disable browser back navigation while on onboarding
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);

    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  if (!currentUser) {
    window.location.replace('/login');
    return <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg-main, #121212)' }} />;
  }

  if (!currentUser.isNewUser && !isCompleting) {
    window.location.replace('/home');
    return <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg-main, #121212)' }} />;
  }

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

  const toggleCommunity = (id) => {
    setSelectedCommunities(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  // Filter communities for step 2 — must be above handleNext so it can be referenced inside
  const suggestedCommunities = communities.filter(c => !c.isUniversity).slice(0, 5);

  const handleNext = async () => {
    if (step === 1) {
      if (suggestedCommunities.length > 0) {
        setStep(2);
        return;
      }
      // No communities to show — skip straight to completing
      setIsCompleting(true);

      const interval = setInterval(() => {
        setLoadingMsgIdx((prev) => (prev < loadingMessages.length - 1 ? prev + 1 : prev));
      }, 700);

      try {
        // Join selected communities via API
        for (const commId of selectedCommunities) {
          try {
            await communitiesApi.join(commId);
          } catch (e) {
            console.error(`Failed to join community ${commId}:`, e);
          }
        }
        
        const success = await completeOnboarding({ 
          interests: selectedInterests
        });

        clearInterval(interval);

        if (success) {
          navigate('/home', { replace: true });
        } else {
          setIsCompleting(false);
          alert("Failed to save onboarding data. Please try again. Ensure your backend is running.");
        }
      } catch (err) {
        clearInterval(interval);
        setIsCompleting(false);
        alert(err.message || "An error occurred while saving your profile.");
      }
    }
  };

  if (isCompleting) {
    return (
      <div className={styles.onboardingContainer} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Background />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '2rem' }}>
          <div style={{ position: 'relative', marginBottom: '2rem' }}>
            <motion.div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                border: '4px solid var(--color-border)',
                borderTopColor: 'var(--color-primary)',
                display: 'inline-block',
              }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
            />
          </div>
          <h2 className={styles.headline} style={{ fontSize: '1.75rem' }}>Creating profile...</h2>
          <p className={styles.subheadline} style={{ color: 'var(--color-primary)', fontWeight: 600, marginTop: '0.5rem' }}>
            {loadingMessages[loadingMsgIdx]}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.onboardingContainer}>
      <Background />
      <div className={styles.contentArea}>
        {step === 1 && (
          <div className="animate-in" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h1 className={styles.headline}>What are you into?</h1>
            <p className={styles.subheadline}>
              {selectedInterests.length >= 1
                ? `You can select up to 10 topics (${selectedInterests.length}/10)`
                : "Choose a few tags to personalize your profile and customize your feed."}
            </p>

            {/* Header bar above interests */}
            <div className={styles.sectionHeaderBar}>
              <span className={styles.sectionHeaderText}>{showAll ? 'All Categories' : 'Popular Topics'}</span>
              <span 
                className={styles.exploreTextLink}
                onClick={() => setShowAll(!showAll)}
              >
                {showAll ? 'Show top picks' : 'See all topics →'}
              </span>
            </div>

            <AnimatePresence mode="wait">
              {!showAll ? (
                <motion.div
                  key="featured-grid"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                >
                  <div className={styles.majorGrid}>
                    {FEATURED_INTERESTS.map((item, idx) => {
                      const isSelected = selectedInterests.includes(item.label);
                      return (
                        <motion.div
                          key={idx}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className={`${styles.majorCard} ${isSelected ? styles.majorCardSelected : ''}`}
                          onClick={() => toggleInterest(item.label)}
                        >
                          <span className={styles.majorEmoji}>{item.emoji}</span>
                          <span className={styles.majorLabel} title={item.label}>{item.label}</span>
                          {isSelected && (
                            <div className={styles.checkBadge}>
                              <Check size={12} />
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="all-categories"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 15 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  style={{ width: '100%' }}
                >
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
                </motion.div>
              )}
            </AnimatePresence>

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
                          <img src={comm.avatar} alt={comm.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
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
                    className={`${styles.joinBtn} ${selectedCommunities.includes(comm.id) ? styles.joined : ''}`}
                    onClick={() => toggleCommunity(comm.id)}
                  >
                    {selectedCommunities.includes(comm.id) ? 'Joined' : 'Join'}
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
