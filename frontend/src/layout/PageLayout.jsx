import React from 'react';
import styles from './PageLayout.module.css';

export default function PageLayout({ children, className = '', containerRef, ...props }) {
  return (
    <main
      ref={containerRef}
      className={`centre centre-wide animate-in ${styles.pageLayout} ${className}`.trim()}
      {...props}
    >
      {children}
    </main>
  );
}
