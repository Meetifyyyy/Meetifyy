import React from 'react';

export default function CountdownRing({ timeLeft, initialDuration }) {
  const radius = 28;
  const strokeWidth = 4;
  const circumference = 2 * Math.PI * radius;
  
  // Calculate offset
  const ratio = initialDuration > 0 ? timeLeft / initialDuration : 0;
  const strokeDashoffset = circumference - ratio * circumference;

  return (
    <div className="countdown-timer-wrapper">
      <svg className="countdown-svg" viewBox="0 0 64 64">
        <circle
          className="countdown-circle-bg"
          cx="32"
          cy="32"
          r={radius}
        />
        <circle
          className="countdown-circle-progress"
          cx="32"
          cy="32"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
        />
      </svg>
      <span className="countdown-number">{timeLeft}</span>
    </div>
  );
}
