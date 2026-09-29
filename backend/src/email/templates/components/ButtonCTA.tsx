import * as React from 'react';
import { Button } from '@react-email/components';
import { color, font } from './tokens';

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
  margin: '28px 0',
};

const button = {
  backgroundColor: color.button,
  borderRadius: '12px',
  color: '#FFFFFF',
  fontFamily: font.sans,
  fontSize: '15px',
  lineHeight: '20px',
  fontWeight: 600,
  letterSpacing: '0.01em',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '15px 32px',
};
