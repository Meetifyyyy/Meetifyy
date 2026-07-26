import React from 'react';
import styles from './CalendarIcon.module.css';

const getMonthLabel = (date, dateLabel) => {
  const target = date || dateLabel;
  if (target) {
    const d = new Date(target);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const match = String(target).match(/\b([A-Za-z]{3})\b/);
    if (match) return match[1].toUpperCase();
  }
  return new Date().toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
};

const getDayLabel = (date, dateLabel) => {
  const target = date || dateLabel;
  if (target) {
    const d = new Date(target);
    if (!isNaN(d.getTime())) return d.getDate();
    const match = String(target).match(/\b(\d{1,2})\b/);
    if (match) return parseInt(match[1], 10);
  }
  return new Date().getDate();
};

export default function CalendarIcon({ date, dateLabel, size, style, variant, className }) {
  const month = getMonthLabel(date, dateLabel);
  const day = getDayLabel(date, dateLabel);

  const isLarge = size === 'large';
  const isGlass = variant === 'glass';

  const eventDateStyle = isLarge ? {
    width: '100px',
    height: '104px',
    borderRadius: '22px',
    ...style
  } : {
    ...(isGlass ? {
      border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: 'none',
      background: 'rgba(255,255,255,0.08)',
    } : {}),
    ...style
  };

  const eventMonthStyle = isLarge
    ? { fontSize: '1.25rem', padding: '8px 0 5px' }
    : isGlass
    ? { background: 'rgba(239,68,68,0.9)', fontSize: '0.45rem', padding: '2px 0 1px', letterSpacing: '0.04em' }
    : undefined;

  const eventDayStyle = isLarge
    ? { fontSize: '2.5rem' }
    : isGlass
    ? { background: '#ffffff', color: '#000000', fontSize: '0.82rem', fontWeight: 800 }
    : undefined;

  return (
    <div className={`${styles.eventDate}${className ? ` ${className}` : ''}`} style={eventDateStyle}>
      <div className={styles.eventMonth} style={eventMonthStyle}>{month}</div>
      <div className={styles.eventDay} style={eventDayStyle}>{day}</div>
    </div>
  );
}
