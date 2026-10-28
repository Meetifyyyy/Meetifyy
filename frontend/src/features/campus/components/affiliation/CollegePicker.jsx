import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { campusAffiliationApi } from '@shared/api/apiClient';
import { Plus, RefreshCw, School, Search, WifiOff } from '@shared/components/icons';
import CampusHero from './CampusHero';
import CollegeLogo from './CollegeLogo';
import { RequestCollegeCard, RequestCollegeDialog } from './RequestCollege';
import styles from './CampusAffiliation.module.css';

/** Name-bar widths for the loading cards, varied so they read as a set. */
const SKELETON_WIDTHS = ['64%', '48%', '72%', '56%', '68%', '44%'];

/** Above this many colleges a search box is worth its space. */
const SEARCH_THRESHOLD = 8;

export const COLLEGES_QUERY_KEY = ['academics', 'colleges'];

/**
 * Step one of joining Campus: which college. The list is public reference data
 * (GET /api/academics/colleges); only the email step proves membership.
 *
 * It fills the screen it is given (CampusJoinFlow's `.screen`): a heading and
 * the search field at the top, the colleges as a grid of square cards (logo,
 * name beneath), and the
 * "can't find yours?" request pinned to the bottom edge when the list is short.
 * `onCancel` is set only when someone is changing a college they already have.
 */
/**
 * The loading-failed, nothing-yet and no-match states: one centred block (icon,
 * a short title, one line of help, the action) that sits in the middle of the
 * space between the heading and the request card.
 */
function PickerState({ icon: Icon, title, children, action, alert = false }) {
  return (
    <div className={styles.state} role={alert ? 'alert' : undefined}>
      <span className={styles.stateIcon} aria-hidden="true">
        <Icon size={24} />
      </span>
      <p className={styles.stateTitle}>{title}</p>
      <p className={styles.stateText}>{children}</p>
      {action ? <div className={styles.stateAction}>{action}</div> : null}
    </div>
  );
}

export default function CollegePicker({ onSelect, onCancel = null }) {
  const [query, setQuery] = useState('');
  const [requesting, setRequesting] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: COLLEGES_QUERY_KEY,
    queryFn: () => campusAffiliationApi.listColleges(),
    staleTime: 10 * 60 * 1000,
  });

  const colleges = useMemo(() => {
    const list = Array.isArray(data?.colleges) ? data.colleges : Array.isArray(data) ? data : [];
    return list
      .filter((c) => c && c.id && c.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const term = query.trim().toLowerCase();
  const visible = term ? colleges.filter((c) => c.name.toLowerCase().includes(term)) : colleges;

  return (
    <div className={styles.picker}>
      <CampusHero />
      {colleges.length > SEARCH_THRESHOLD && (
        <div className={styles.pickerHead}>
          <label className={styles.search}>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search colleges"
              aria-label="Search colleges"
              autoComplete="off"
            />
          </label>
        </div>
      )}

      <div className={styles.pickerBody}>
        {isLoading ? (
          <ul className={styles.grid} aria-busy="true" aria-label="Loading colleges">
            {SKELETON_WIDTHS.map((width, i) => (
              <li key={i} className={styles.skeletonCell}>
                <span className={styles.skeletonLogo} />
                <span className={styles.skeletonLine} style={{ width }} />
              </li>
            ))}
          </ul>
        ) : isError ? (
          <PickerState
            alert
            icon={WifiOff}
            title="Couldn't load colleges"
            action={
              <button type="button" className={styles.secondaryBtn} onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw size={16} aria-hidden="true" />
                <span>{isFetching ? 'Retrying…' : 'Try again'}</span>
              </button>
            }
          >
            Check your connection and try again.
          </PickerState>
        ) : colleges.length === 0 ? (
          <PickerState
            icon={School}
            title="No colleges yet"
            action={
              <button type="button" className={styles.primaryBtn} onClick={() => setRequesting(true)}>
                <Plus size={16} aria-hidden="true" />
                <span>Add your campus</span>
              </button>
            }
          >
            Add yours and we&apos;ll let you know when it opens.
          </PickerState>
        ) : visible.length === 0 ? (
          <PickerState
            icon={Search}
            title={`No match for “${query.trim()}”`}
            action={
              <button type="button" className={styles.secondaryBtn} onClick={() => setRequesting(true)}>
                <Plus size={16} aria-hidden="true" />
                <span>Add your campus</span>
              </button>
            }
          >
            Check the spelling, or add it.
          </PickerState>
        ) : (
          <ul className={styles.grid}>
            {visible.map((college) => (
              <li key={college.id} className={styles.gridItem}>
                <button type="button" className={styles.collegeCard} onClick={() => onSelect(college)}>
                  <CollegeLogo name={college.name} logoUrl={college.logoUrl} className={styles.cardLogo} />
                  <span className={styles.cardName}>{college.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Always offered under a list (and under a failed load); the empty and
            no-results states above carry their own request button. The footer
            sits at the bottom of the screen when the list is short. */}
        {!isLoading && (isError || visible.length > 0) ? (
          <div className={styles.pickerFoot}>
            <RequestCollegeCard initialName={query.trim()} />
          </div>
        ) : null}

        {requesting ? (
          <RequestCollegeDialog initialName={query.trim()} onClose={() => setRequesting(false)} />
        ) : null}

        {onCancel ? (
          <p className={styles.note} style={{ textAlign: 'center' }}>
            <button type="button" className={styles.linkBtn} onClick={onCancel}>
              Keep my current college email
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
