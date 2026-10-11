import * as React from 'react';
import { Heading, Section, Text } from '@react-email/components';
import { cls, color, font, type } from './tokens';

/** Eyebrow + serif headline + lede: the opening of every email. */
export const Headline: React.FC<{
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}> = ({ eyebrow, title, children }) => (
  <>
    {eyebrow && (
      <Text className={cls.accent} style={type.eyebrow}>
        {eyebrow}
      </Text>
    )}
    <Heading as="h1" className={`headline ${cls.ink}`} style={type.headline}>
      {title}
    </Heading>
    {children && (
      <Text className={cls.body} style={type.lede}>
        {children}
      </Text>
    )}
  </>
);

/** A paragraph of body copy. */
export const Paragraph: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Text className={cls.body} style={type.body}>
    {children}
  </Text>
);

/** Small automated-mail notice. */
export const Notice: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Text className={cls.muted} style={type.small}>
    {children}
  </Text>
);

/** Sign-off at the foot of a message. */
export const Signoff: React.FC<{ team?: string }> = ({
  team = 'The Meetifyy Team',
}) => (
  <Text className={cls.body} style={signoff}>
    Thanks,
    <br />
    <span className={cls.ink} style={signoffName}>
      {team}
    </span>
  </Text>
);

export interface DetailRowItem {
  label: string;
  value: React.ReactNode;
}

/**
 * Key/value facts (session, change details) as hairline-ruled rows under a
 * small caps title. Stacks label over value on narrow screens.
 */
export const DetailList: React.FC<{
  title: string;
  rows: DetailRowItem[];
}> = ({ title, rows }) => (
  <Section style={detailWrap}>
    <Text className={cls.ink} style={detailTitle}>
      {title}
    </Text>
    <table
      role="presentation"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      style={{ width: '100%', borderCollapse: 'collapse' }}
    >
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.label}>
            <td
              className={`stack stack-label ${cls.muted}`}
              style={{
                ...detailLabel,
                borderBottom:
                  i === rows.length - 1
                    ? 'none'
                    : `1px solid ${color.hairline}`,
              }}
            >
              {row.label}
            </td>
            <td
              className={`stack stack-value ${cls.ink}`}
              style={{
                ...detailValue,
                borderBottom:
                  i === rows.length - 1
                    ? 'none'
                    : `1px solid ${color.hairline}`,
              }}
            >
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </Section>
);

type CalloutTone = 'info' | 'warn' | 'danger';

const tones: Record<
  CalloutTone,
  { bg: string; title: string; text: string; rule: string }
> = {
  info: {
    bg: 'rgba(92,71,250,0.10)',
    title: '#3A2BB8',
    text: '#3B3866',
    rule: 'rgba(92,71,250,0.30)',
  },
  warn: {
    bg: 'rgba(245,158,11,0.12)',
    title: '#8A4B00',
    text: '#5F4218',
    rule: 'rgba(245,158,11,0.38)',
  },
  danger: {
    bg: 'rgba(239,68,68,0.10)',
    title: '#A3202F',
    text: '#5E2A30',
    rule: 'rgba(239,68,68,0.34)',
  },
};

/** A tinted panel for something the reader must not miss. */
export const Callout: React.FC<{
  tone?: CalloutTone;
  title: string;
  children: React.ReactNode;
}> = ({ tone = 'info', title, children }) => {
  const t = tones[tone];
  return (
    <Section
      style={{
        backgroundColor: t.bg,
        border: `1px solid ${t.rule}`,
        borderRadius: '14px',
        padding: '18px 20px',
        margin: '24px 0',
      }}
    >
      <Text
        className={`co-${tone}-t`}
        style={{
          fontFamily: font.sans,
          fontSize: '14px',
          lineHeight: '20px',
          fontWeight: 700,
          color: t.title,
          margin: '0 0 4px',
        }}
      >
        {title}
      </Text>
      <Text
        className={`co-${tone}-x`}
        style={{
          fontFamily: font.sans,
          fontSize: '14px',
          lineHeight: '22px',
          color: t.text,
          margin: 0,
        }}
      >
        {children}
      </Text>
    </Section>
  );
};

/** Numbered next steps, ruled like the detail list. */
export const Steps: React.FC<{ title: string; items: string[] }> = ({
  title,
  items,
}) => (
  <Section style={detailWrap}>
    <Text className={cls.ink} style={detailTitle}>
      {title}
    </Text>
    <table
      role="presentation"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      style={{ width: '100%', borderCollapse: 'collapse' }}
    >
      <tbody>
        {items.map((item, i) => {
          const rule =
            i === items.length - 1 ? 'none' : `1px solid ${color.hairline}`;
          return (
            <tr key={item}>
              <td
                className={cls.accent}
                style={{ ...stepNumber, borderBottom: rule }}
              >
                {String(i + 1).padStart(2, '0')}
              </td>
              <td
                className={cls.ink}
                style={{ ...stepText, borderBottom: rule }}
              >
                {item}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </Section>
);

const signoff = {
  fontFamily: font.sans,
  fontSize: '15px',
  lineHeight: '24px',
  color: color.body,
  margin: '32px 0 0',
};

const signoffName = {
  fontWeight: 600,
  color: color.ink,
};

const detailWrap = {
  margin: '28px 0',
};

const detailTitle = {
  ...type.label,
  margin: '0 0 8px',
  paddingBottom: '10px',
  borderBottom: `1px solid ${color.rule}`,
};

const detailLabel = {
  fontFamily: font.sans,
  fontSize: '13px',
  lineHeight: '20px',
  color: color.muted,
  padding: '14px 16px 14px 0',
  width: '130px',
  verticalAlign: 'top' as const,
};

const detailValue = {
  fontFamily: font.sans,
  fontSize: '14px',
  lineHeight: '20px',
  fontWeight: 600,
  color: color.ink,
  padding: '14px 0',
  verticalAlign: 'top' as const,
  wordBreak: 'break-word' as const,
};

const stepNumber = {
  fontFamily: font.sans,
  fontSize: '12px',
  fontWeight: 600,
  color: color.accent,
  padding: '15px 16px 15px 0',
  width: '40px',
  verticalAlign: 'top' as const,
};

const stepText = {
  fontFamily: font.sans,
  fontSize: '14.5px',
  lineHeight: '22px',
  color: color.ink,
  padding: '14px 0',
  verticalAlign: 'top' as const,
};
