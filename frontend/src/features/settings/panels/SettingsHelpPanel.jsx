import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supportApi } from '@shared/api/apiClient';
import { config } from '@config';
import {
  ChevronDown,
  ChevronRight,
  Mail,
  HelpCircle,
  RefreshCw,
  AlertCircle,
} from '@shared/components/icons';
import Skeleton from '@shared/components/skeletons/Skeleton';
import settingsStyles from '../pages/SettingsRoute.module.css';
import panelStyles from './SettingsHelpPanel.module.css';

/** Target article slugs relevant to Settings: Account Deletion, Notifications, Privacy, Reporting */
const SETTINGS_FAQ_SLUGS = [
  'how-do-i-delete-my-account',
  'why-am-i-not-receiving-notifications',
  'how-does-blocking-work',
  'how-do-i-report-a-user-or-content',
];

/**
 * SettingsHelpPanel
 *
 * Fully integrated Help & Support section within Settings.
 * - Displays targeted FAQs for Account Deletion, Notifications, Privacy, and Reporting.
 * - Perfectly matches standard Settings layout rhythm, container widths, and row styles.
 * - Dynamic FAQ accordion with rich list/paragraph layout formatting.
 * - No hardcoded fallback support email address.
 * - Action button linking directly to the full Support Centre.
 */
export default function SettingsHelpPanel() {
  const [openFaq, setOpenFaq] = useState(null);

  const {
    data: helpData,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['help-centre'],
    queryFn: () => supportApi.getHelpCentre(),
    staleTime: 10 * 60 * 1000,
  });

  const topArticles = useMemo(() => {
    if (!helpData) return [];

    const allArticles = (helpData.categories || []).flatMap((c) => c.articles || []);

    // Filter and order specifically by the requested Settings topics
    const targeted = SETTINGS_FAQ_SLUGS.map((slug) =>
      allArticles.find((a) => a.slug === slug)
    ).filter(Boolean);

    if (targeted.length > 0) {
      return targeted;
    }

    // Graceful fallback to featured articles if custom slugs differ
    if (helpData.featured && helpData.featured.length > 0) {
      return helpData.featured.slice(0, 4);
    }

    return allArticles.slice(0, 4);
  }, [helpData]);

  // Read purely from config without fallback hardcoded email
  const supportEmail = config?.app?.supportEmail;

  return (
    <div className={`${settingsStyles.body} animate-in`}>
      {/* Frequently Asked Questions Section */}
      <div className={`${settingsStyles.sectionLabel} ${panelStyles.firstSectionLabel}`}>
        Frequently Asked Questions
      </div>

      <div className={settingsStyles.group}>
        {/* Loading State */}
        {isLoading && (
          <div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={panelStyles.skeletonItem}>
                <Skeleton type="rect" width="75%" height="16px" style={{ borderRadius: '4px' }} />
                <Skeleton type="rect" width="16px" height="16px" style={{ borderRadius: '4px' }} />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className={panelStyles.errorNotice}>
            <AlertCircle size={18} color="var(--color-danger, #ef4444)" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <p className={panelStyles.errorTitle}>Unable to load help topics</p>
              <p className={panelStyles.errorSubtext}>Please check your connection and try again.</p>
            </div>
            <button type="button" onClick={() => refetch()} className={panelStyles.retryBtn}>
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !isError && topArticles.length === 0 && (
          <div className={panelStyles.emptyNotice}>
            No help articles available at the moment.
          </div>
        )}

        {/* FAQ Accordion Rows */}
        {!isLoading && !isError && topArticles.length > 0 && (
          <div className={panelStyles.faqList}>
            {topArticles.map((item, i) => {
              const isItemOpen = openFaq === i;
              return (
                <div key={item.id || item.slug || i} className={panelStyles.faqItem}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isItemOpen ? null : i)}
                    className={panelStyles.faqQuestion}
                    aria-expanded={isItemOpen}
                  >
                    <span className={panelStyles.faqQuestionText}>{item.question}</span>
                    <ChevronDown
                      size={16}
                      strokeWidth={2.5}
                      className={`${panelStyles.faqChevron} ${isItemOpen ? panelStyles.faqChevronOpen : ''}`}
                    />
                  </button>
                  {isItemOpen && (
                    <div className={panelStyles.faqAnswer}>
                      {item.body ? (
                        <div dangerouslySetInnerHTML={{ __html: item.body }} />
                      ) : (
                        <p>{item.summary || item.excerpt || ''}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Contact & Support Section */}
      <div className={settingsStyles.sectionLabel}>Contact &amp; Support</div>
      <div className={settingsStyles.group}>
        {supportEmail && (
          <>
            <a
              href={`mailto:${supportEmail}?subject=Support%20Request`}
              className={`${settingsStyles.row} ${panelStyles.linkRow}`}
            >
              <span className={settingsStyles.rowIcon}>
                <Mail size={20} strokeWidth={2} />
              </span>
              <span className={settingsStyles.rowLabel}>Email {supportEmail}</span>
              <span className={settingsStyles.rowChev}>
                <ChevronRight size={18} strokeWidth={2.25} />
              </span>
            </a>
            <div className={settingsStyles.divider} />
          </>
        )}

        <Link
          to="/help-and-support"
          className={`${settingsStyles.row} ${panelStyles.linkRow}`}
        >
          <span className={settingsStyles.rowIcon}>
            <HelpCircle size={20} strokeWidth={2} />
          </span>
          <span className={settingsStyles.rowLabel}>Support Centre</span>
          <span className={settingsStyles.rowChev}>
            <ChevronRight size={18} strokeWidth={2.25} />
          </span>
        </Link>
      </div>
    </div>
  );
}
