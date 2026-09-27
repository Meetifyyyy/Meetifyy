import { Compass, AlertCircle, Plus } from '@shared/components/icons';
import { useExploreCommunities } from '@shared/hooks/useCommunities';
import CommunityRow from './CommunityRow';
import CommunityRowSkeleton from './CommunityRowSkeleton';
import SectionHeading from './SectionHeading';
import EmptyPanel from './EmptyPanel';
import listStyles from './CommunityList.module.css';

/**
 * Discovery: every community, public and private together. Searching has its
 * own page (/communities/search), opened from the header.
 */
export default function ExploreCommunities({ onCreate }) {
  const {
    communities,
    isLoading,
    isError,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useExploreCommunities();

  return (
    <section className={listStyles.section} aria-busy={isFetching} aria-label="Communities">
      <SectionHeading title="Discover" meta="Public and private" />
      {isLoading && <CommunityRowSkeleton count={5} />}

      {!isLoading && isError && communities.length === 0 && (
        <div className={listStyles.state} role="alert">
          <span className={listStyles.stateIcon}><AlertCircle size={22} /></span>
          <h2 className={listStyles.stateTitle}>Couldn’t load communities</h2>
          <p className={listStyles.stateText}>Check your connection and try again.</p>
          <div className={listStyles.stateActions}>
            <button type="button" className={listStyles.secondaryBtn} onClick={() => refetch()}>Try again</button>
          </div>
        </div>
      )}

      {!isLoading && !isError && communities.length === 0 && (
        <EmptyPanel
          icon={<Compass size={22} />}
          title="Nothing to discover yet"
          actions={(
            <button type="button" className={listStyles.primaryBtn} onClick={onCreate}>
              <Plus size={16} /> Create a community
            </button>
          )}
        >
          No one has started a community here. Start the first one and invite people in.
        </EmptyPanel>
      )}

      {!isLoading && communities.length > 0 && (
        <>
          <div className={listStyles.list}>
            {communities.map((c) => (
              <CommunityRow key={c.id} community={c} variant="explore" />
            ))}
          </div>
          {hasNextPage && (
            <div className={listStyles.more}>
              <button
                type="button"
                className={listStyles.secondaryBtn}
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
