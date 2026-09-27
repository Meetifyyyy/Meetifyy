import Skeleton from '@shared/components/skeletons/Skeleton';
import CommunityRowSkeleton from './CommunityRowSkeleton';
import pageStyles from '../../pages/CommunitiesRoute.module.css';

/** Route fallback for /communities, laid out like the page it stands in for. */
export default function CommunitiesPageSkeleton() {
  return (
    <main className="centre" aria-hidden="true">
      <div className={pageStyles.box}>
        <div style={{ padding: '0.9rem 0' }}>
          <Skeleton type="text" width="150px" height="1.4rem" style={{ margin: 0 }} />
        </div>
        <CommunityRowSkeleton count={5} />
      </div>
    </main>
  );
}
