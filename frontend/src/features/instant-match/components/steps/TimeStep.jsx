import React from 'react';

const TIME_OPTIONS = [
  { 
    id: 'now', 
    title: 'Right Now', 
    desc: 'Find someone to meet immediately', 
    icon: '⚡',
    gradient: 'linear-gradient(135deg, rgba(249, 115, 22, 0.12), rgba(234, 88, 12, 0.12))',
    selectedBg: 'rgba(249, 115, 22, 0.06)',
    borderColor: 'var(--color-highlight)'
  },
  { 
    id: '30min', 
    title: 'Within 30 Minutes', 
    desc: 'Planning to head out soon', 
    icon: '⏰',
    gradient: 'linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(29, 78, 216, 0.12))',
    selectedBg: 'rgba(37, 99, 235, 0.06)',
    borderColor: 'var(--color-primary)'
  },
  { 
    id: 'today', 
    title: 'Today', 
    desc: 'Looking for partners later today', 
    icon: '📅',
    gradient: 'linear-gradient(135deg, rgba(124, 58, 237, 0.12), rgba(109, 40, 217, 0.12))',
    selectedBg: 'rgba(124, 58, 237, 0.06)',
    borderColor: 'var(--color-secondary)'
  }
];

export default function TimeStep({ selectedTime, onSelect }) {
  return (
    <div className="instant-match-step-container">
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 4px 0' }}>
          When do you want to meet?
        </h3>
        <p style={{ fontSize: '0.825rem', color: 'var(--color-text-light)', margin: 0 }}>
          Set your matching window urgency
        </p>
      </div>

      <div className="time-options">
        {TIME_OPTIONS.map(opt => {
          const isSelected = selectedTime === opt.id;
          return (
            <button
              key={opt.id}
              className={`time-option-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(opt.id)}
              style={{ 
                textAlign: 'left', 
                background: isSelected ? opt.selectedBg : undefined,
                borderColor: isSelected ? opt.borderColor : undefined,
                width: '100%' 
              }}
            >
              <div 
                className="time-option-icon-wrapper"
                style={{ background: opt.gradient }}
              >
                {opt.icon}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span className="time-option-title">{opt.title}</span>
                <span className="time-option-desc">{opt.desc}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
