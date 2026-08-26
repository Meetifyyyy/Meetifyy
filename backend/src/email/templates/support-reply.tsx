import * as React from 'react';
import { Heading, Hr, Link, Section, Text } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { DetailTable, TicketBadge, heading, mutedText, text } from './components/SupportDetails';
import { SITE_CONFIG } from '../../config/site.config';

export interface SupportReplyEmailProps {
  name?: string | null;
  ticketNumber: string;
  subject: string;
  /** Already sanitized upstream - see sanitizeReplyHtml. */
  replyHtml: string;
  statusLabel: string;
  statusMessage: string;
  repliedAt: string;
  supportEmail?: string;
  helpCentreUrl?: string;
}

/**
 * An admin's reply to the user.
 *
 * The body is whatever the admin wrote in the Admin Dashboard - there is no
 * canned resolution text, because a support reply that does not address the
 * specific issue is worse than none. What the template does add is the frame
 * around it: which request this is about, what state that request is now in,
 * and how to keep talking.
 *
 * Only `replyHtml` is interpolated as markup, and it has already been passed
 * through the reply sanitizer before being stored. Nothing internal - notes,
 * assignment, priority, moderation context - is available to this template at
 * all, so none of it can leak into a user's inbox by mistake.
 */
export const SupportReplyEmail = ({
  name,
  ticketNumber,
  subject,
  replyHtml,
  statusLabel,
  statusMessage,
  repliedAt,
  supportEmail = SITE_CONFIG.supportEmail,
  helpCentreUrl = SITE_CONFIG.frontendUrl,
}: SupportReplyEmailProps) => (
  <BaseLayout previewText={`Re: ${subject} (${ticketNumber})`}>
    <Heading style={heading}>A reply from Meetifyy Support</Heading>

    <Text style={text}>Hi {name?.trim() || 'there'},</Text>
    <Text style={text}>
      We've got an update on your support request. Here's what our team said:
    </Text>

    <Section style={replyBox}>
      <div style={replyBody} dangerouslySetInnerHTML={{ __html: replyHtml }} />
    </Section>

    <DetailTable
      rows={[
        { label: 'Request ID', value: ticketNumber },
        { label: 'Subject', value: subject },
        { label: 'Status', value: statusLabel },
        { label: 'Replied', value: repliedAt },
      ]}
    />

    <Text style={text}>{statusMessage}</Text>

    <Hr style={{ borderColor: '#e6ebf1', margin: '24px 0' }} />

    <TicketBadge ticketNumber={ticketNumber} />

    <Text style={mutedText}>
      Reply to this email to continue the conversation - please keep {ticketNumber} in the message so we can match it
      to the right request. You don't need to be signed in.
      {supportEmail ? (
        <>
          {' '}
          You can also write to{' '}
          <Link href={`mailto:${supportEmail}`} style={{ color: '#2563EB' }}>
            {supportEmail}
          </Link>
          .
        </>
      ) : null}
    </Text>

    <Text style={mutedText}>
      More answers are in our{' '}
      <Link href={helpCentreUrl} style={{ color: '#2563EB' }}>
        Help &amp; Support centre
      </Link>
      . Meetifyy will never ask you for your password or verification codes by email.
    </Text>

    <Text style={text}>
      Thanks,
      <br />
      <strong>The Meetifyy Support Team</strong>
    </Text>
  </BaseLayout>
);

const replyBox = {
  backgroundColor: '#ffffff',
  border: '1px solid #e6ebf1',
  borderLeft: '4px solid #2563EB',
  padding: '4px 20px',
  borderRadius: '8px',
  marginBottom: '24px',
};

const replyBody = {
  fontSize: '16px',
  lineHeight: '24px',
  color: '#050F24',
  wordBreak: 'break-word' as const,
};

export default SupportReplyEmail;
