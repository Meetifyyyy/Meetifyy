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
  const isMicro = size === 'micro';
  const isBadge = size === 'badge';
  const isGlass = variant === 'glass';

  const eventDateStyle = isLarge ? {
    width: '100px',
    height: '104px',
    borderRadius: '24px',
    border: '3px solid var(--badge-border, var(--color-bg-white, #ffffff))',
    boxShadow: 'none',
    transition: 'border-color 0.15s ease',
    ...style
  } : isMicro ? {
    width: '21px',
    height: '22px',
    borderRadius: '6px',
    border: '3px solid var(--badge-border, var(--color-bg-white, #ffffff))',
    boxShadow: 'none',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    transition: 'border-color 0.15s ease',
    ...style
  } : (isBadge) ? {
    width: '28px',
    height: '29px',
    borderRadius: '8px',
    border: '3px solid var(--badge-border, var(--color-bg-white, #ffffff))',
    boxShadow: 'none',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    transition: 'border-color 0.15s ease',
    ...style
  } : {
    borderRadius: '12px',
    border: '3px solid var(--badge-border, var(--color-bg-white, #ffffff))',
    boxShadow: 'none',
    transition: 'border-color 0.15s ease',
    ...(isGlass ? {
      border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: 'none',
      background: 'rgba(255,255,255,0.08)',
    } : {}),
    ...style
  };

  const eventMonthStyle = isLarge
    ? { fontSize: '1.25rem', padding: '8px 0 5px' }
    : isMicro
    ? { fontSize: '0.30rem', padding: '0.5px 0', height: '7px', lineHeight: '7px', letterSpacing: '0.02em', fontWeight: 800, background: '#ef4444', color: '#ffffff' }
    : isBadge
    ? { fontSize: '0.38rem', padding: '1px 0', height: '10px', lineHeight: '10px', letterSpacing: '0.03em', fontWeight: 800, background: '#ef4444', color: '#ffffff' }
    : isGlass
    ? { background: 'rgba(239,68,68,0.9)', fontSize: '0.45rem', padding: '2px 0 1px', letterSpacing: '0.04em' }
    : undefined;

  const eventDayStyle = isLarge
    ? { fontSize: '2.5rem' }
    : isMicro
    ? { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.50rem', fontWeight: 900, lineHeight: 1, background: 'linear-gradient(145deg, #ffffff 0%, #f8fafc 35%, #e2e8f0 70%, #cbd5e1 100%)', color: '#0f172a', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9)' }
    : isBadge
    ? { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.70rem', fontWeight: 900, lineHeight: 1, background: 'linear-gradient(145deg, #ffffff 0%, #f8fafc 35%, #e2e8f0 70%, #cbd5e1 100%)', color: '#0f172a', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9)' }
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
