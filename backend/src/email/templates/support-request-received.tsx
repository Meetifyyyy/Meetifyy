import * as React from 'react';
import { Heading, Hr, Link, Text } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { DetailTable, QuotedBlock, TicketBadge, heading, mutedText, text } from './components/SupportDetails';
import { SITE_CONFIG } from '../../config/site.config';

export interface SupportRequestReceivedEmailProps {
  name?: string | null;
  email: string;
  ticketNumber: string;
  categoryLabel: string;
  subject: string;
  description: string;
  submittedAt: string;
  statusLabel: string;
  /** Display names only. The files themselves are never attached to this email. */
  attachmentNames?: string[];
  deviceSummary?: string | null;
  pageContext?: string | null;
  helpCentreUrl?: string;
  supportEmail?: string;
}

/**
 * Sent to the person who filed the request, the moment it is filed.
 *
 * Its job is to be their receipt, so it mirrors the form back to them field by
 * field: what they typed, what they attached, and the device details we
 * collected alongside it. People file support requests from a form they then
 * close, and this is often the only record they keep of what they actually
 * said.
 *
 * Nothing internal appears here - no priority, no assignment, no admin links.
 * Those live in the separate notification that goes to the support inbox.
 */
export const SupportRequestReceivedEmail = ({
  name,
  email,
  ticketNumber,
  categoryLabel,
  subject,
  description,
  submittedAt,
  statusLabel,
  attachmentNames = [],
  deviceSummary,
  pageContext,
  helpCentreUrl = SITE_CONFIG.frontendUrl,
  supportEmail = SITE_CONFIG.supportEmail,
}: SupportRequestReceivedEmailProps) => (
  <BaseLayout previewText={`We've received your support request (${ticketNumber})`}>
    <Heading style={heading}>Support Request Received</Heading>

    <Text style={text}>Hi {name?.trim() || 'there'},</Text>
    <Text style={text}>
      Thanks for getting in touch. A member of the Meetifyy support team will look into this and reply to you by
      email. Please keep the Request ID below - it is how we identify your request in any future messages.
    </Text>

    <TicketBadge ticketNumber={ticketNumber} />

    <DetailTable
      title="What you sent us"
      rows={[
        ...(name?.trim() ? [{ label: 'Name', value: name.trim() }] : []),
        { label: 'Email', value: email },
        { label: 'Category', value: categoryLabel },
        { label: 'Subject', value: subject },
        { label: 'Submitted', value: submittedAt },
        { label: 'Status', value: statusLabel },
      ]}
    />

    <QuotedBlock label="Description">{description}</QuotedBlock>

    {attachmentNames.length > 0 && (
      <DetailTable
        title={`Attachment${attachmentNames.length === 1 ? '' : 's'}`}
        rows={attachmentNames.map((filename, index) => ({
          label: attachmentNames.length === 1 ? 'File' : `File ${index + 1}`,
          value: filename,
        }))}
      />
    )}

    {(deviceSummary || pageContext) && (
      <DetailTable
        title="Device details we recorded"
        rows={[
          ...(deviceSummary ? [{ label: 'Device', value: deviceSummary }] : []),
          ...(pageContext ? [{ label: 'Page', value: pageContext }] : []),
        ]}
      />
    )}

    <Hr style={{ borderColor: '#e6ebf1', margin: '24px 0' }} />

    <Text style={text}>
      <strong>Need to add something?</strong>
      <br />
      Just reply to this email. Your reply stays attached to request {ticketNumber}, so there is no need to fill in the
      form again, and no need to be signed in.
    </Text>

    <Text style={mutedText}>
      You may also find an answer straight away in our{' '}
      <Link href={helpCentreUrl} style={{ color: '#2563EB' }}>
        Help &amp; Support centre
      </Link>
      {supportEmail ? (
        <>
          , or you can write to us at{' '}
          <Link href={`mailto:${supportEmail}`} style={{ color: '#2563EB' }}>
            {supportEmail}
          </Link>
        </>
      ) : null}
      .
    </Text>

    <Text style={mutedText}>
      Meetifyy will never ask you for your password, verification codes or payment details by email. If a message
      claiming to be from us does, please do not reply to it.
    </Text>

    <Hr style={{ borderColor: '#e6ebf1', margin: '24px 0' }} />

    <Text style={{ ...mutedText, marginBottom: 0 }}>
      This is an automated message confirming that we received your request. A member of the support team will reply
      to you personally.
    </Text>
  </BaseLayout>
);

export default SupportRequestReceivedEmail;
