import * as React from 'react';
import { Heading, Text } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import {
  SupportAttachmentItem,
  SupportAttachmentsSection,
  SupportFooterNotice,
  SupportIdPill,
  SupportSummaryCard,
  heading,
  text,
} from './components/SupportDetails';
import { SITE_CONFIG } from '../../config/site.config';

export interface SupportRequestReceivedEmailProps {
  name?: string | null;
  email: string;
  ticketNumber: string;
  categoryLabel: string;
  subject: string;
  description: string;
  submittedAt?: string;
  statusLabel?: string;
  attachments?: SupportAttachmentItem[];
  helpCentreUrl?: string;
}

export const SupportRequestReceivedEmail: React.FC<SupportRequestReceivedEmailProps> = ({
  name,
  ticketNumber,
  categoryLabel,
  subject,
  description,
  attachments = [],
  helpCentreUrl = SITE_CONFIG.supportUrl || `${SITE_CONFIG.frontendUrl}/help-and-support`,
}) => {
  const greeting = name?.trim() ? `Hello ${name.trim()},` : 'Hello,';

  return (
    <BaseLayout previewText={`We received your support request #${ticketNumber}`}>
      <Heading style={heading}>Support Request Received</Heading>

      <Text style={text}>{greeting}</Text>
      <Text style={text}>
        We have received your support request and our team will review it as soon as possible.
      </Text>

      <SupportIdPill ticketNumber={ticketNumber} />

      <Text style={text}>
        Please keep this ID for your reference when contacting us about this request.
      </Text>

      <SupportSummaryCard
        name={name}
        categoryLabel={categoryLabel}
        subject={subject}
        description={description}
      />

      {attachments && attachments.length > 0 && (
        <SupportAttachmentsSection attachments={attachments} />
      )}

      <SupportFooterNotice
        helpCentreUrl={helpCentreUrl}
        isAutomatedConfirmation={true}
      />
    </BaseLayout>
  );
};

export default SupportRequestReceivedEmail;
