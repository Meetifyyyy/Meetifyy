import * as React from 'react';
import { Button } from '@react-email/components';

interface ButtonCTAProps {
  href: string;
  children: React.ReactNode;
}

export const ButtonCTA: React.FC<ButtonCTAProps> = ({ href, children }) => {
  return (
    <Button href={href} style={button}>
      {children}
    </Button>
  );
};

const button = {
  backgroundColor: '#2563EB', // Blue
  borderRadius: '8px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  width: '100%',
  padding: '14px 7px',
  marginTop: '20px',
  marginBottom: '20px',
};
