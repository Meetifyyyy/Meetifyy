import * as React from 'react';
import { Section } from '@react-email/components';
import { BaseLayout } from './components/BaseLayout';
import { SupportFooterNotice } from './components/SupportDetails';
import { SITE_CONFIG } from '../../config/site.config';

export interface SupportReplyEmailProps {
  ticketNumber: string;
  replyHtml: string;
  helpCentreUrl?: string;
}

export const SupportReplyEmail: React.FC<SupportReplyEmailProps> = ({
  ticketNumber,
  replyHtml,
  helpCentreUrl = SITE_CONFIG.supportUrl || `${SITE_CONFIG.frontendUrl}/help-and-support`,
}) => {
  return (
    <BaseLayout previewText={`Update on your support request #${ticketNumber}`}>
      <Section style={replyContainer}>
        <div
          style={replyBody}
          dangerouslySetInnerHTML={{ __html: replyHtml }}
        />
      </Section>

      <SupportFooterNotice
        helpCentreUrl={helpCentreUrl}
        isAutomatedConfirmation={false}
      />
    </BaseLayout>
  );
};

const replyContainer = {
  padding: '8px 0 16px',
};

const replyBody = {
  fontSize: '15px',
  lineHeight: '26px',
  color: '#1e293b',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: '0',
  wordBreak: 'break-word' as const,
};

export default SupportReplyEmail;
