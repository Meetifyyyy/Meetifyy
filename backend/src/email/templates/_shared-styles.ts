/**
 * Shared email style constants used across all Meetifyy email templates.
 * Centralises the design system so all templates stay visually consistent.
 */

// ─── Layout ────────────────────────────────────────────────────────────────

export const main = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  padding: '40px 0',
};

export const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '0',
  borderRadius: '20px',
  boxShadow: '0 4px 24px rgba(15, 23, 42, 0.08)',
  overflow: 'hidden',
  maxWidth: '480px',
  border: '1px solid #e8edf5',
};

// ─── Header ────────────────────────────────────────────────────────────────

export const header = {
  backgroundColor: '#ffffff',
  padding: '32px 40px 20px',
  textAlign: 'center' as const,
  borderBottom: '1px solid #f1f5f9',
};

export const headerLink = {
  textDecoration: 'none',
  display: 'inline-block',
};

export const logoTable = {
  margin: '0 auto',
  borderCollapse: 'collapse' as const,
};

export const logoIconCell = {
  verticalAlign: 'middle' as const,
  paddingRight: '8px',
  lineHeight: '1',
};

export const logoIconImg = {
  display: 'block',
  margin: '0',
  width: '36px',
  height: '36px',
  maxWidth: '36px',
  maxHeight: '36px',
  border: '0',
  outline: 'none',
  borderRadius: '8px',
};

export const logoTextCell = {
  verticalAlign: 'middle' as const,
  lineHeight: '1',
};

export const wordmarkText = {
  fontSize: '22px',
  fontWeight: '900',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Arial Black", Arial, sans-serif',
  color: '#050F24',
  letterSpacing: '2px',
  lineHeight: '36px',
  textDecoration: 'none',
  display: 'inline-block',
  verticalAlign: 'middle' as const,
};

export const wordmarkAccent = {
  color: '#0088ff',
  fontWeight: '900',
};

// ─── Content ───────────────────────────────────────────────────────────────

export const content = {
  padding: '32px 40px 28px',
  textAlign: 'center' as const,
  backgroundColor: '#ffffff',
};

export const heading = {
  fontSize: '24px',
  fontWeight: '700',
  letterSpacing: '-0.5px',
  lineHeight: '1.25',
  color: '#0f172a',
  margin: '0 0 12px',
  textAlign: 'center' as const,
};

export const highlightText = {
  color: '#4f46e5',
};

export const greeting = {
  fontSize: '15px',
  fontWeight: '500',
  color: '#334155',
  margin: '0 0 8px',
};

export const subtext = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#64748b',
  fontWeight: '400',
  margin: '0 0 28px',
};

// ─── CTA Button ────────────────────────────────────────────────────

export const btnSection = {
  margin: '0 0 20px',
  textAlign: 'center' as const,
};

export const button = {
  background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
  backgroundColor: '#4f46e5',
  borderRadius: '100px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 36px',
  letterSpacing: '0.1px',
};

// ─── Expiry notice ─────────────────────────────────────────────────────────

export const expirySection = {
  margin: '0 0 24px',
  textAlign: 'center' as const,
};

export const expiryText = {
  fontSize: '12.5px',
  color: '#94a3b8',
  fontWeight: '400',
  margin: '0',
};

export const expiryHighlight = {
  color: '#4f46e5',
  fontWeight: '600',
};

// ─── Info / Details Box ─────────────────────────────────────────────────────

export const detailsBox = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '16px 20px',
  margin: '0 0 24px',
  textAlign: 'left' as const,
};

export const detailsTitle = {
  fontSize: '11px',
  fontWeight: '700',
  color: '#94a3b8',
  margin: '0 0 12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.8px',
};

export const detailLabel = {
  fontSize: '13px',
  color: '#94a3b8',
  padding: '5px 0',
  width: '110px',
  fontWeight: '400',
};

export const detailValue = {
  fontSize: '13px',
  color: '#0f172a',
  fontWeight: '500',
  padding: '5px 0',
};

// ─── Steps Box (Welcome) ────────────────────────────────────────────────────

export const stepsBox = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '18px 20px',
  margin: '0 0 24px',
  textAlign: 'left' as const,
};

export const stepsTitle = {
  fontSize: '11px',
  fontWeight: '700',
  color: '#94a3b8',
  margin: '0 0 12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.8px',
};

export const stepItem = {
  fontSize: '13px',
  lineHeight: '20px',
  color: '#334155',
  margin: '0 0 8px',
  paddingLeft: '2px',
};

// ─── Security Card ─────────────────────────────────────────────────────────

export const securityCard = {
  backgroundColor: '#fafafa',
  borderRadius: '12px',
  borderLeft: '3px solid #4f46e5',
  padding: '14px 18px',
  margin: '0 0 24px',
  textAlign: 'left' as const,
};

export const shieldIconCell = {
  width: '40px',
  verticalAlign: 'top' as const,
};

export const shieldBadge = {
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  backgroundColor: '#ede9fe',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center' as const,
};

export const securityTextCell = {
  verticalAlign: 'top' as const,
  paddingLeft: '10px',
};

export const securityTitle = {
  fontSize: '13px',
  fontWeight: '600',
  color: '#1e1b4b',
  margin: '0 0 3px',
};

export const securityBody = {
  fontSize: '12.5px',
  lineHeight: '18px',
  color: '#64748b',
  fontWeight: '400',
  margin: '0',
};

// ─── Ignore / Signoff text ──────────────────────────────────────────────────

export const ignoreText = {
  fontSize: '12.5px',
  color: '#94a3b8',
  fontWeight: '400',
  margin: '0 0 20px',
  textAlign: 'center' as const,
};

export const signoff = {
  fontSize: '13.5px',
  lineHeight: '22px',
  color: '#475569',
  fontWeight: '400',
  margin: '0',
  textAlign: 'center' as const,
};

// ─── Divider ────────────────────────────────────────────────────────────────

export const hr = {
  borderColor: '#f1f5f9',
  margin: '0',
  borderWidth: '1px',
};

// ─── Footer ─────────────────────────────────────────────────────────────────

export const footer = {
  padding: '20px 40px 28px',
  backgroundColor: '#f8fafc',
  textAlign: 'center' as const,
};

export const socialTable = {
  margin: '0 auto 14px',
};

export const socialTd = {
  padding: '0 6px',
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
};

export const socialBubble = {
  display: 'inline-block',
  width: '34px',
  height: '34px',
  borderRadius: '50%',
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
  textDecoration: 'none',
};

export const iconImg = {
  display: 'block',
  margin: '7px auto',
  width: '20px',
  height: '20px',
  border: '0',
};

export const copyright = {
  fontSize: '12px',
  color: '#94a3b8',
  fontWeight: '400',
  margin: '0 0 4px',
};

export const subFooter = {
  fontSize: '11.5px',
  color: '#cbd5e1',
  fontWeight: '400',
  margin: '0',
};

// ─── Shared Head CSS ───────────────────────────────────────────────────────
// Allows outer space to naturally follow device theme (white in light, dark in dark)
// while pinning the inner email card to solid white.

export const SHARED_HEAD_CSS = `
  :root {
    color-scheme: light dark;
    supported-color-schemes: light dark;
  }
  body, .email-body {
    background-color: #ffffff;
  }
  .email-container {
    background-color: #ffffff !important;
  }
  @media (prefers-color-scheme: dark) {
    body, .email-body {
      background-color: #0b0f19 !important;
    }
    .email-container {
      background-color: #ffffff !important;
    }
  }
  [data-ogsc] body, body[data-outlook-cycle], [data-ogsc] .email-body {
    background-color: #0b0f19 !important;
  }
  [data-ogsc] .email-container {
    background-color: #ffffff !important;
  }
`;
