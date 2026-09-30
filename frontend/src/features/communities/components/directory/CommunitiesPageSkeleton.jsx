import { useSearchParams } from 'react-router-dom';
import { Plus, Search } from '@shared/components/icons';
import CommunityRowSkeleton from './CommunityRowSkeleton';
import SectionHeading from './SectionHeading';
import listStyles from './CommunityList.module.css';
import pageStyles from '../../pages/CommunitiesRoute.module.css';

const TABS = [
  { id: 'yours', label: 'Yours' },
  { id: 'explore', label: 'Explore' },
];

/**
 * Route fallback for /communities, laid out like the page it stands in for.
 * The header (title, search and create buttons, tabs) is static, so it is
 * drawn for real — it only shows while the page's code loads, so its controls
 * are inert. Only the list is a placeholder.
 */
export default function CommunitiesPageSkeleton() {
  const [params] = useSearchParams();
  const tab = params.get('tab') === 'explore' ? 'explore' : 'yours';

  return (
    <main className={`centre ${pageStyles.page}`} aria-busy="true">
      <div className={pageStyles.box}>
        <div className={pageStyles.header} aria-hidden="true">
          <div className={pageStyles.topBar}>
            <h1 className={pageStyles.title}>Communities</h1>
            <div className={pageStyles.topActions}>
              <button type="button" className={pageStyles.iconBtn} tabIndex={-1}>
                <Search size={20} strokeWidth={2.5} />
              </button>
              <button type="button" className={`${pageStyles.iconBtn} ${pageStyles.iconBtnPrimary}`} tabIndex={-1}>
                <Plus size={20} strokeWidth={2.75} />
              </button>
            </div>
          </div>
          <div data-tab={tab} className={pageStyles.tabs}>
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                tabIndex={-1}
                className={`${pageStyles.tab} ${tab === id ? pageStyles.tabActive : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className={listStyles.section}>
          {tab === 'explore' && <SectionHeading title="Discover" meta="Public and private" />}
          <CommunityRowSkeleton count={tab === 'explore' ? 5 : 4} />
        </section>
      </div>
    </main>
  );
}
