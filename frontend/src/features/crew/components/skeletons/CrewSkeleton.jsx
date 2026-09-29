import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Skeleton from '@shared/components/skeletons/Skeleton';
import { useAuth } from '@shared/context/AuthContext';
import { openVerificationModal } from '@shared/stores/verificationModalStore';
import PageLayout from '@layout/PageLayout';
import PageHeader from '@layout/PageHeader';
import CrewCardSkeleton from '../cards/CrewCardSkeleton';
import CreateActivityCard from '../cards/CreateActivityCard';
import {
  TAB_ALL,
  TAB_MINE,
  TAB_ONE_ON_ONE,
  TAB_SAVED,
  slugToTab,
  tabToSlug,
} from '@features/crew/utils/crewTabs';
import styles from '../../pages/FindYourCrewPage.module.css';

const PLUS_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/**
 * Route fallback for /crew while FindYourCrewPage's code loads.
 *
 * The header — title, subtitle, create button, search field, tabs — is static,
 * so it is the real PageHeader with the same props the page passes (the tab
 * row is derived the same way, from the URL and the signed-in user's college).
 * Only the activity cards and the side panel are placeholders.
 */
export default function CrewSkeleton() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { currentUser, collegeName } = useAuth();

  const hasCollege = Boolean(
    currentUser?.collegeId || currentUser?.college || currentUser?.university || currentUser?.campus,
  );
  const collegeTab = (hasCollege ? collegeName : null) || null;
  const selectedTab = slugToTab(params.get('tab') || 'all', collegeTab);
  const tabs = [TAB_ALL, ...(collegeTab ? [collegeTab] : []), TAB_ONE_ON_ONE, TAB_MINE, TAB_SAVED];

  const handleCreateActivity = useCallback(() => {
    if (currentUser?.verificationStatus !== 'VERIFIED') {
      openVerificationModal('Verify your account to create activities.');
      return;
    }
    navigate('/crew/create');
  }, [currentUser?.verificationStatus, navigate]);

  const handleTabChange = useCallback((tab) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tabToSlug(tab, collegeTab));
      next.delete('view');
      return next;
    });
  }, [setParams, collegeTab]);

  return (
    <PageLayout aria-busy="true">
      <div className={styles.page}>
        <PageHeader
          title="Crew"
          subtitle="Discover activities and people to do them with."
          backPath="/home"
          searchProps={{
            value: '',
            onChange: () => {},
            placeholder: 'Search activities, sports, hangouts...',
            borderless: true,
          }}
          actions={
            <button
              type="button"
              className={styles.createIconBtn}
              onClick={handleCreateActivity}
              aria-label="Create Activity"
              title="Create Activity"
            >
              {PLUS_ICON}
            </button>
          }
          tabs={tabs}
          activeTab={selectedTab}
          onTabChange={handleTabChange}
          tabVariant="pills"
        />

        <div className={styles.layout}>
          <div className={styles.content}>
            {selectedTab === TAB_ALL && (
              <div className={styles.mobileCreateCardWrapper}>
                <CreateActivityCard onCreateActivity={handleCreateActivity} />
              </div>
            )}
            <div className={styles.list}>
              <CrewCardSkeleton />
              <CrewCardSkeleton />
              <CrewCardSkeleton />
            </div>
          </div>

          <div className={styles.sidebarWrapper} aria-hidden="true">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <Skeleton type="rect" height="200px" style={{ display: 'block', borderRadius: 'var(--radius-lg)' }} />
              <Skeleton type="rect" height="150px" style={{ display: 'block', borderRadius: 'var(--radius-lg)' }} />
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
