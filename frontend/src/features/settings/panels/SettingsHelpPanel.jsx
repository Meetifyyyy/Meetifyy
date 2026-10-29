import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import SafeHtml from '@shared/components/richtext/SafeHtml';
import { supportApi } from '@shared/api/apiClient';
import { IS_MOBILE_BUILD } from '@config';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  RefreshCw,
  Search,
} from '@shared/components/icons';
import Skeleton from '@shared/components/skeletons/Skeleton';
import HelpActions from '@features/info/help/hub/HelpActions';
import HelpFooter from '@features/info/help/hub/HelpFooter';
import HelpView from '@features/info/help/hub/HelpView';
import ServiceStatus from '@features/info/help/hub/ServiceStatus';
import SupportRequestModal from '@features/info/help/hub/SupportRequestModal';
import { HELP_VIEWS, viewFromParams } from '@features/info/help/hub/helpHub';
import settingsStyles from '../pages/SettingsRoute.module.css';
import panelStyles from './SettingsHelpPanel.module.css';

const linkFor = (view) => `/settings/help?view=${view}`;

/**
 * Common questions, grouped. The answers are the help-centre articles (one
 * source of truth, editable from the Admin Dashboard); each one that is about
 * a setting links straight to it. A slug that is not published is skipped,
 * so an unpublished or renamed article can never render an empty row.
 */
const FAQ_GROUPS = [
  {
    title: 'Your account',
    items: [
      { slug: 'how-does-account-verification-work', to: '/settings/verification', action: 'Open Account Verification' },
      { slug: 'how-do-i-change-my-profile-information', to: '/settings/profile', action: 'Edit Profile' },
      { slug: 'how-do-i-sign-out-other-devices', to: '/settings/devices', action: 'Open Devices' },
      { slug: 'how-do-i-delete-my-account', to: '/settings/privacy-security', action: 'Open Privacy & Security' },
    ],
  },
  {
    title: 'Privacy & safety',
    items: [
      { slug: 'who-can-see-my-profile', to: '/settings/privacy', action: 'Open Visibility' },
      { slug: 'how-does-blocking-work', to: '/settings/blocked-contacts', action: 'Open Blocked Contacts' },
      { slug: 'how-do-i-report-a-user-or-content', to: linkFor(HELP_VIEWS.SAFETY), action: 'Open Safety centre' },
      { slug: 'why-cant-i-find-some-students' },
    ],
  },
  {
    title: 'Using Meetifyy',
    items: [
      { slug: 'how-do-i-create-a-post' },
      { slug: 'why-are-my-messages-not-sending' },
      { slug: 'how-do-i-join-or-leave-a-community' },
      { slug: 'how-do-i-create-or-join-an-event' },
      { slug: 'what-is-instant-match' },
      { slug: 'why-am-i-not-receiving-notifications', to: '/settings/notifications', action: 'Open Notifications' },
    ],
  },
];

/**
 * Settings > Help & Support, in the app and on the website.
 *
 * The hub: search and "Browse all help" go to the website's Help & Support
 * page (in the installed app, the route hands it to the system browser; see
 * OpenLegalOnWebsite). Report a problem and Share an idea open in place;
 * Your requests and the Safety centre are `?view=` sub-views, so the Android
 * back button steps out of them.
 */
export default function SettingsHelpPanel() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const view = viewFromParams(params);
  const [modal, setModal] = useState(null);

  return (
    <>
      {view ? <HelpSubView view={view} onOpen={setModal} /> : <HelpHome onOpen={setModal} />}
      <SupportRequestModal
        kind={modal}
        onClose={() => setModal(null)}
        onViewRequests={() => {
          setModal(null);
          navigate(linkFor(HELP_VIEWS.REQUESTS));
        }}
      />
    </>
  );
}

function HelpSubView({ view, onOpen }) {
  return (
    <div className={`${settingsStyles.body} animate-in`}>
      {/* The view's name is the page header's title (SettingsRoute), so it is
          not repeated here. */}
      <div className={panelStyles.viewBody}>
        <HelpView view={view} onOpen={onOpen} />
      </div>
    </div>
  );
}

function HelpHome({ onOpen }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [openFaq, setOpenFaq] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['help-centre'],
    queryFn: () => supportApi.getHelpCentre(),
    staleTime: 10 * 60 * 1000,
  });

  const groups = useMemo(() => {
    const bySlug = new Map((data?.categories ?? []).flatMap((c) => c.articles ?? []).map((a) => [a.slug, a]));
    return FAQ_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => bySlug.has(item.slug)).map((item) => ({ ...item, article: bySlug.get(item.slug) })),
    })).filter((group) => group.items.length > 0);
  }, [data]);

  return (
    <div className={`${settingsStyles.body} animate-in`}>
      <form
        className={panelStyles.searchForm}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = search.trim();
          // On the website this is the help page; in the app the route opens it
          // in the system browser with the search already filled in.
          navigate(q ? `/help-and-support?q=${encodeURIComponent(q)}` : '/help-and-support');
        }}
      >
        <Search size={17} aria-hidden="true" className={panelStyles.searchIcon} />
        <input
          type="search"
          enterKeyHint="search"
          className={panelStyles.searchInput}
          placeholder="Search all help articles"
          aria-label="Search all help articles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      <div className={panelStyles.hubBlock}>
        <ServiceStatus />
        <HelpActions linkFor={linkFor} onOpen={onOpen} />
      </div>

      {isLoading && (
        <>
          <div className={settingsStyles.sectionLabel}>Common questions</div>
          <div className={settingsStyles.group} role="status" aria-label="Loading questions">
            {['75%', '62%', '70%', '56%'].map((w) => (
              <div key={w} className={panelStyles.skeletonItem}>
                <Skeleton type="rect" width={w} height="16px" style={{ borderRadius: '4px' }} />
              </div>
            ))}
          </div>
        </>
      )}

      {isError && (
        <>
          <div className={settingsStyles.sectionLabel}>Common questions</div>
          <div className={settingsStyles.group}>
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
          </div>
        </>
      )}

      {groups.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <div className={settingsStyles.sectionLabel}>{group.title}</div>
          <div className={settingsStyles.group}>
            <div className={panelStyles.faqList}>
              {group.items.map(({ slug, article, to, action }) => {
                const open = openFaq === slug;
                const answerId = `faq-${slug}`;
                return (
                  <div key={slug} className={panelStyles.faqItem}>
                    <button
                      type="button"
                      onClick={() => setOpenFaq(open ? null : slug)}
                      className={panelStyles.faqQuestion}
                      aria-expanded={open}
                      aria-controls={answerId}
                    >
                      <span className={panelStyles.faqQuestionText}>{article.question}</span>
                      <ChevronDown
                        size={16}
                        strokeWidth={2.5}
                        className={`${panelStyles.faqChevron} ${open ? panelStyles.faqChevronOpen : ''}`}
                      />
                    </button>
                    {open && (
                      <div className={panelStyles.faqAnswer} id={answerId}>
                        {article.body ? <SafeHtml html={article.body} /> : <p>{article.summary}</p>}
                        {to && (
                          <Link to={to} className={panelStyles.faqAction}>
                            {action}
                            <ChevronRight size={14} aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ))}

      <div className={settingsStyles.group}>
        <Link to="/help-and-support" className={`${settingsStyles.row} ${panelStyles.linkRow}`}>
          <span className={settingsStyles.rowIcon}>
            <HelpCircle size={20} strokeWidth={2} />
          </span>
          <span className={panelStyles.rowStack}>
            <span className={settingsStyles.rowLabel}>Browse all help</span>
            {IS_MOBILE_BUILD && <span className={panelStyles.rowSub}>Opens in your browser</span>}
          </span>
          <span className={settingsStyles.rowChev}>
            {IS_MOBILE_BUILD ? <ExternalLink size={17} strokeWidth={2.25} /> : <ChevronRight size={18} strokeWidth={2.25} />}
          </span>
        </Link>
      </div>

      <div className={panelStyles.footerWrap}>
        <HelpFooter />
      </div>
    </div>
  );
}
