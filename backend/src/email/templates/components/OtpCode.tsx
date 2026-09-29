import * as React from 'react';
import { color, font } from './tokens';

interface OtpCodeProps {
  otp: string;
  /** Rendered under the code, e.g. "Expires in 10 minutes." */
  footnote?: React.ReactNode;
}

/**
 * The one-time code, one lightly bordered box per digit.
 *
 * The boxes are adjacent inline spans in a single block rather than table
 * cells, so a double-tap still selects the whole code. `otp` may also be a
 * Supabase template variable such as "{{ .Token }}": it is substituted at send
 * time, cannot be split into digits here, and is emitted untouched in one box.
 */
export const OtpCode: React.FC<OtpCodeProps> = ({ otp, footnote }) => {
  const code = (otp || '000000').trim();
  const isTemplateVar = code.includes('{{');

  return (
    <table
      role="presentation"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      width="100%"
      style={panelTable}
    >
      <tbody>
        <tr>
          <td align="center" style={panel}>
            <div style={digitsRow}>
              {isTemplateVar ? (
                <span style={templateBox}>{code}</span>
              ) : (
                code.split('').map((digit, i) => (
                  <span key={i} className="digit" style={digitBox}>
                    {digit}
                  </span>
                ))
              )}
            </div>
            {footnote && <div style={note}>{footnote}</div>}
          </td>
        </tr>
      </tbody>
    </table>
  );
};

const panelTable = {
  margin: '28px 0',
  borderCollapse: 'separate' as const,
};

const panel = {
  backgroundColor: color.tint,
  borderRadius: '16px',
  padding: '28px 12px 24px',
  textAlign: 'center' as const,
};

const digitsRow = {
  fontSize: 0,
  lineHeight: 0,
  whiteSpace: 'nowrap' as const,
};

const digitBox = {
  display: 'inline-block',
  width: '46px',
  height: '56px',
  margin: '0 3px',
  backgroundColor: '#FFFFFF',
  border: '1px solid #D5D2F5',
  borderRadius: '10px',
  boxSizing: 'border-box' as const,
  fontFamily: font.sans,
  fontSize: '26px',
  lineHeight: '54px',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums' as const,
  color: color.ink,
  textAlign: 'center' as const,
};

const templateBox = {
  display: 'inline-block',
  padding: '0 24px',
  backgroundColor: '#FFFFFF',
  border: '1px solid #D5D2F5',
  borderRadius: '10px',
  fontFamily: font.sans,
  fontSize: '26px',
  lineHeight: '54px',
  fontWeight: 600,
  letterSpacing: '6px',
  color: color.ink,
};

const note = {
  fontFamily: font.sans,
  fontSize: '13px',
  lineHeight: '20px',
  color: color.muted,
  margin: '16px 0 0',
};
