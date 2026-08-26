import * as React from 'react';

interface OtpDigitBoxesProps {
  otp: string;
}

export const OtpDigitBoxes: React.FC<OtpDigitBoxesProps> = ({ otp }) => {
  const trimmed = (otp || '000000').trim();

  // If this is a template variable like "{{ .Token }}" from Supabase
  if (trimmed.includes('{{')) {
    return (
      <div style={templateBox}>
        <span style={templateText}>{trimmed}</span>
      </div>
    );
  }

  const digits = trimmed.split('');

  return (
    <table
      role="presentation"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      align="center"
      style={tableWrap}
    >
      <tbody>
        <tr>
          {digits.map((digit, idx) => (
            <td key={idx} style={digitCell}>
              <div style={digitBox}>
                <table
                  role="presentation"
                  border={0}
                  cellPadding={0}
                  cellSpacing={0}
                  style={innerTable}
                >
                  <tbody>
                    <tr>
                      <td align="center" valign="middle" style={digitTextCell}>
                        {digit}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
};

const tableWrap = {
  margin: '0 auto',
};

const digitCell = {
  padding: '0 4px',
  verticalAlign: 'middle' as const,
};

const digitBox = {
  width: '46px',
  height: '56px',
  minWidth: '46px',
  minHeight: '56px',
  backgroundColor: '#ffffff',
  border: '1.5px solid #93c5fd',
  borderRadius: '10px',
  boxShadow: '0 2px 8px rgba(37, 99, 235, 0.08)',
  textAlign: 'center' as const,
};

const innerTable = {
  width: '100%',
  height: '100%',
};

const digitTextCell = {
  color: '#2563eb',
  fontSize: '26px',
  fontWeight: '700',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  lineHeight: '56px',
  textAlign: 'center' as const,
  margin: 0,
  padding: 0,
};

const templateBox = {
  display: 'inline-block',
  backgroundColor: '#ffffff',
  border: '1.5px solid #93c5fd',
  borderRadius: '10px',
  padding: '14px 28px',
  margin: '0 auto',
  boxShadow: '0 2px 8px rgba(37, 99, 235, 0.08)',
};

const templateText = {
  color: '#2563eb',
  fontSize: '26px',
  fontWeight: '700',
  letterSpacing: '8px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};
