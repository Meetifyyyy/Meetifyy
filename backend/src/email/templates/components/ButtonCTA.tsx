import * as React from 'react';
import { Button } from '@react-email/components';

interface ButtonCTAProps {
  href: string;
  children: React.ReactNode;
}

export const ButtonCTA: React.FC<ButtonCTAProps> = ({ href, children }) => {
  return (
    <div style={buttonContainer}>
      <Button href={href} style={button}>
        {children}
      </Button>
    </div>
  );
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '28px 0',
};

const button = {
  backgroundColor: '#2563eb',
  borderRadius: '10px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  width: '100%',
  maxWidth: '320px',
  padding: '14px 28px',
  boxSizing: 'border-box' as const,
  boxShadow: '0 4px 14px rgba(37, 99, 235, 0.28)',
};
