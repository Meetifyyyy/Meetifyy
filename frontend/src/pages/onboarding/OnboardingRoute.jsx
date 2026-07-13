import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import styles from './OnboardingRoute.module.css';

const INTERESTS = [
  { id: 'design', label: 'Design', icon: '🎨' },
  { id: 'coding', label: 'Engineering', icon: '💻' },
  { id: 'business', label: 'Business', icon: '📈' },
  { id: 'sports', label: 'Sports', icon: '🏀' },
  { id: 'gaming', label: 'Gaming', icon: '🎮' },
  { id: 'music', label: 'Music', icon: '🎵' }
];

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
    setSelectedInterests(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
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
      completeOnboarding({ communities: updatedCommunities });
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
            <p className={styles.subheadline}>Select a few topics to help us customize your feed.</p>
            
            <div className={styles.optionsGrid}>
              {INTERESTS.map(interest => (
                <div 
                  key={interest.id}
                  className={`${styles.optionChip} ${selectedInterests.includes(interest.id) ? styles.selected : ''}`}
                  onClick={() => toggleInterest(interest.id)}
                >
                  <span className={styles.chipIcon}>{interest.icon}</span>
                  <span className={styles.chipLabel}>{interest.label}</span>
                </div>
              ))}
            </div>

            <button 
              className={styles.continueBtn} 
              onClick={handleNext}
              disabled={selectedInterests.length === 0}
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="animate-in" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h1 className={styles.headline}>Join your first spaces</h1>
            <p className={styles.subheadline}>Based on your interests, we recommend these communities.</p>
            
            <div className={styles.communitiesList}>
              {suggestedCommunities.map(comm => (
                <div key={comm.id} className={styles.communityCard}>
                  <div className={styles.commInfo}>
                    <div className={styles.commAvatar}>
                      {comm.name.charAt(0)}
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
              ))}
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
