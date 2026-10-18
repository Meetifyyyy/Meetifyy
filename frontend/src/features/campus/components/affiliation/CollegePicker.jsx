import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { campusAffiliationApi } from '@shared/api/apiClient';
import { Search } from '@shared/components/icons';
import CollegeLogo from './CollegeLogo';
import { RequestCollegeCard } from './RequestCollege';
import styles from './CampusAffiliation.module.css';

/** Above this many colleges a search box is worth its space. */
const SEARCH_THRESHOLD = 8;

export const COLLEGES_QUERY_KEY = ['academics', 'colleges'];

/**
 * Step one of joining Campus: which college. The list is public reference data
 * (GET /api/academics/colleges); only the email step proves membership.
 */
export default function CollegePicker({ onSelect }) {
  const [query, setQuery] = useState('');
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
    <div className={styles.card}>
      <p className={styles.eyebrow}>Campus</p>
      <h1 className={styles.title}>Find your college</h1>
      <p className={styles.lead}>
        Campus is where you meet people from your own college. Pick yours, then confirm it with your
        college email.
      </p>

      {colleges.length > SEARCH_THRESHOLD && (
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
      )}

      {isLoading ? (
        <ul className={styles.grid} aria-busy="true" aria-label="Loading colleges">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className={styles.skeletonCard} />
          ))}
        </ul>
      ) : isError ? (
        <div className={styles.state} role="alert">
          <p>We couldn&apos;t load the list of colleges.</p>
          <button type="button" className={styles.secondaryBtn} onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      ) : colleges.length === 0 ? (
        <div className={styles.state}>
          <p>No colleges are on Campus yet.</p>
          <RequestCollegeCard compact />
        </div>
      ) : visible.length === 0 ? (
        <div className={styles.state}>
          <p>No college matches &ldquo;{query.trim()}&rdquo;.</p>
          <RequestCollegeCard compact initialName={query.trim()} />
        </div>
      ) : (
        <ul className={styles.grid}>
          {visible.map((college) => (
            <li key={college.id}>
              <button type="button" className={styles.collegeCard} onClick={() => onSelect(college)}>
                <CollegeLogo name={college.name} logoUrl={college.logoUrl} />
                <span className={styles.collegeName}>{college.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Always offered under a list (and under a failed load); the empty and
          no-results states above carry their own copy of it. */}
      {!isLoading && (isError || visible.length > 0) ? <RequestCollegeCard initialName={query.trim()} /> : null}
    </div>
  );
}
