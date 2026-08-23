import { useState, useEffect, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';

import { INTERESTS_BY_CATEGORY } from '../constants/interestsData';
import styles from './OnboardingRoute.module.css';
import { useCommunities } from '@shared/hooks/useCommunities';
import { communitiesApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ArrowLeft } from 'lucide-react';
import { resolveCommunityAvatar } from '@shared/utils/avatar';


// Draft persistence so a mid-onboarding reload doesn't wipe the user's picks.
const ONB_STEP_KEY = 'meetifyy_onboarding_step';
const ONB_INTERESTS_KEY = 'meetifyy_onboarding_interests';
const ONB_COMMUNITIES_KEY = 'meetifyy_onboarding_communities';

const readJSON = (key, fallback) => {
  try {
    const v = sessionStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

const clearOnboardingDraft = () => {
  try {
    sessionStorage.removeItem(ONB_STEP_KEY);
    sessionStorage.removeItem(ONB_INTERESTS_KEY);
    sessionStorage.removeItem(ONB_COMMUNITIES_KEY);
  } catch {
    // ignore storage errors
  }
};

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
  const { communities } = useCommunities();
  const navigate = useNavigate();
  
  const [step, setStep] = useState(() => (parseInt(sessionStorage.getItem(ONB_STEP_KEY), 10) === 2 ? 2 : 1));
  const [selectedInterests, setSelectedInterests] = useState(() => {
    const saved = readJSON(ONB_INTERESTS_KEY, []);
    return Array.isArray(saved) ? saved : [];
  });
  const [selectedCommunities, setSelectedCommunities] = useState(() => {
    const saved = readJSON(ONB_COMMUNITIES_KEY, []);
    return Array.isArray(saved) ? saved : [];
  });
  const [isCompleting, setIsCompleting] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [showAll, setShowAll] = useState(false);

  // Guards finishOnboarding against a rapid double-click landing two submits
  // before isCompleting re-renders (state reads in the closure would be stale).
  const isFinishingRef = useRef(false);

  // Persist the draft so a reload restores the user's progress.
  useEffect(() => {
    try {
      sessionStorage.setItem(ONB_STEP_KEY, String(step));
      sessionStorage.setItem(ONB_INTERESTS_KEY, JSON.stringify(selectedInterests));
      sessionStorage.setItem(ONB_COMMUNITIES_KEY, JSON.stringify(selectedCommunities));
    } catch {
      // ignore storage errors
    }
  }, [step, selectedInterests, selectedCommunities]);

  const loadingMessages = [
    'Creating your profile...',
    'Saving your interests...',
    'Setting up your campus circle...',
    'Almost ready!'
  ];



  // Trap the user inside onboarding (browser-back must not escape to signup/login,
  // which are invalid states now that the account exists). But make back feel
  // sensible rather than frozen: if they're on Step 2, browser-back returns them
  // to Step 1 instead of doing nothing.
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);

    const handlePopState = () => {
      setStep((prev) => (prev > 1 ? prev - 1 : prev));
      // Re-arm the trap so a subsequent back press is caught again.
      window.history.pushState(null, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (!currentUser.isNewUser && !isCompleting) {
    return <Navigate to="/home" replace />;
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

  // Persists interests + joins selected communities, then routes to /home.
  // Shared by both completion entry points (Step 1 with no communities to show,
  // and Step 2's "Let's go") — previously only Step 1 could complete, leaving
  // Step 2 a dead end.
  const finishOnboarding = async () => {
    if (isFinishingRef.current) return; // guard against double submit (ref = no stale read)
    isFinishingRef.current = true;
    setIsCompleting(true);

    const interval = setInterval(() => {
      setLoadingMsgIdx((prev) => (prev < loadingMessages.length - 1 ? prev + 1 : prev));
    }, 700);

    try {
      // Join selected communities in parallel — they're independent operations,
      // so there's no reason to pay for sequential round-trips. Individual
      // failures are non-fatal and shouldn't block finishing onboarding.
      if (selectedCommunities.length > 0) {
        await Promise.all(
          selectedCommunities.map((commId) =>
            communitiesApi.join(commId).catch((e) => {
              console.error(`Failed to join community ${commId}:`, e);
            })
          )
        );
      }

      const success = await completeOnboarding({ interests: selectedInterests });

      clearInterval(interval);

      if (success) {
        clearOnboardingDraft();
        navigate('/home', { replace: true });
      } else {
        // Keep the draft so the user's picks survive a retry.
        setIsCompleting(false);
        isFinishingRef.current = false;
        showToast("Couldn't save profile", 'error');
      }
    } catch (err) {
      clearInterval(interval);
      setIsCompleting(false);
      isFinishingRef.current = false;
      showToast(err?.message || "Couldn't save profile", 'error');
    }
  };

  const handleNext = async () => {
    if (step === 1) {
      // If we have communities to suggest, go to Step 2; otherwise finish now.
      if (suggestedCommunities.length > 0) {
        setStep(2);
        return;
      }
      await finishOnboarding();
    } else if (step === 2) {
      await finishOnboarding();
    }
  };

  if (isCompleting) {
    return (
      <div className={styles.shell}>
        <div className={styles.ambient} aria-hidden="true">
          <span className={`${styles.blob} ${styles.blobA}`} />
          <span className={`${styles.blob} ${styles.blobB}`} />
        </div>
        <div className={styles.completingWrap}>
          <div className={styles.spinner} />
          <h2 className={styles.completingTitle}>Creating profile...</h2>
          <p className={styles.completingMsg}>{loadingMessages[loadingMsgIdx]}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.ambient} aria-hidden="true">
        <span className={`${styles.blob} ${styles.blobA}`} />
        <span className={`${styles.blob} ${styles.blobB}`} />
      </div>

      <div className={styles.contentArea}>
        {step === 1 && (
          <div className={styles.stepWrap}>
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
          <div className={styles.stepWrap}>
            <button type="button" onClick={() => setStep(1)} aria-label="Back to interests" className={styles.backLink}>
              <ArrowLeft size={16} /> Back
            </button>
            <h1 className={styles.headline}>Join your first spaces</h1>
            <p className={styles.subheadline}>Based on your interests, we recommend these communities.</p>
            
            <div className={styles.communitiesList}>
              {suggestedCommunities.map(comm => {
                // Reads `avatarKey` and resolves it, like every other
                // community surface. The local check only accepted values the
                // API does not store.
                const commAvatar = resolveCommunityAvatar(comm);
                const isImage = Boolean(commAvatar);
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
                          <img src={commAvatar} alt={comm.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
                        ) : (
                          comm.name.charAt(0).toUpperCase()
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

            <div className={styles.actionsFooter}>
              <button className={styles.continueBtn} onClick={handleNext}>
                Let's go
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
