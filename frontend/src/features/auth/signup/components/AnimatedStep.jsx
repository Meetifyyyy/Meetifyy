import React from 'react';

/** Plain step wrapper — no transition, so a step swap never depends on an animation resolving. */
export default function AnimatedStep({ children, className }) {
  return (
    <div className={className} style={{ width: '100%' }}>
      {children}
    </div>
  );
}
