import React, { useEffect } from 'react';
import { useInstantMatch } from '../../context/InstantMatchContext';
import { useMatchTimer } from '../../hooks/useMatchTimer';
import { useAuth } from '@shared/context/AuthContext';
import CountdownRing from './CountdownRing';
import '../../styles/match-popup.css';

export default function MatchPopup() {
  const { status, activeMatch, respondToMatch } = useInstantMatch();
  const { currentUser } = useAuth();

  // If no match is active, do not render
  if ((status !== 'match_found' && status !== 'chat_redirect') || !activeMatch) {
    return null;
  }

  const { candidate, activity, area, timer } = activeMatch || {};

  // Find actual shared interests between candidate and current user
  const sharedInterests = candidate?.interests && currentUser?.interests
    ? candidate.interests.filter(interest =>
        currentUser.interests.some(
          userInterest => userInterest.toLowerCase() === interest.toLowerCase()
        )
      )
    : [];

  // Auto decline when timer runs out
  const handleExpire = () => {
    if (status === 'match_found') {
      respondToMatch('decline');
    }
  };

  const { timeLeft } = useMatchTimer(timer || 30, handleExpire);

  // Helper to format natural sentences for activities
  const getNaturalSentence = () => {
    if (!activity) return '';
    const verbs = {
      study: 'study',
      coding: 'code',
      sports: 'play sports',
      coffee: 'get coffee',
      food: 'grab food',
      gaming: 'play games',
      walk: 'go for a walk',
      movie: 'watch a movie',
      event: 'attend an event',
      chat: 'chat',
      library: 'head to the library',
      other: 'meet up'
    };

    const verb = verbs[activity] || 'meet up';
    const areaLabel = area ? area.replace('_', ' ') : '';
    let sentence = `Wants to ${verb}`;

    if (areaLabel) {
      sentence += ` near the ${areaLabel}`;
    }
    return sentence;
  };

  // Fallback for avatar display
  const renderAvatar = () => {
    if (candidate?.avatarUrl) {
      return (
        <img
          src={candidate.avatarUrl}
          alt={candidate.displayName}
          className="match-profile-avatar"
        />
      );
    }
    return (
      <div className="match-profile-avatar">
        {candidate?.avatar || candidate?.displayName?.charAt(0) || '?'}
      </div>
    );
  };

  return (
    <div className="match-popup-overlay">
      <div className="match-popup-card">
        <div className="match-decor" />
        
        {status === 'chat_redirect' ? (
          <div className="match-success-overlay">
            <span className="match-success-emoji">🎉</span>
            <h3 className="match-success-title">You're matched!</h3>
            <p className="match-subinfo">Opening private conversation...</p>
          </div>
        ) : null}

        <div className="match-status-badge">Match Found</div>

        <div className="match-avatar-wrapper">
          {renderAvatar()}
        </div>

        <div className="match-details-container">
          <h3 className="match-name">{candidate?.displayName}</h3>
          <p className="match-subinfo">
            {candidate?.course} • {candidate?.year}
          </p>
          
          <div className="match-meta-box">
            ⚡ {getNaturalSentence()}
          </div>
        </div>

        {sharedInterests.length > 0 ? (
          <div className="match-interests-wrapper">
            <span className="match-interests-title">Shared Interests</span>
            <div className="match-tags-grid">
              {sharedInterests.slice(0, 3).map((interest, idx) => (
                <span key={idx} className="match-tag">
                  {interest}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {status === 'match_found' ? (
          <>
            <CountdownRing timeLeft={timeLeft} initialDuration={timer || 30} />

            <div className="match-actions-grid">
              <button
                className="instant-match-btn-secondary"
                onClick={() => respondToMatch('decline')}
              >
                Decline
              </button>
              <button
                className="instant-match-btn-primary"
                style={{ backgroundColor: 'var(--color-success)' }}
                onClick={() => respondToMatch('accept')}
              >
                Accept Match
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
