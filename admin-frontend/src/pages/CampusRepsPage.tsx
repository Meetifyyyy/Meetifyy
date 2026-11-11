import React, { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Search, X, Megaphone, Loader2, Building2, ShieldCheck, UserCheck, ShieldAlert, AlertCircle, RefreshCw, Mail } from '../components/icons';
import { useConfirm } from '../components/ConfirmProvider';
import { Dropdown } from '../components/Dropdown';
import { LoadingState } from '../components/LoadingState';
import { useDebounced } from '../hooks/useDebounced';
import UserAvatar from '../components/UserAvatar';
import './campus-reps.css';

interface RepUser {
  id: string;
  username: string;
  displayName?: string | null;
  email?: string;
  avatar?: string | null;
  isCampusRep: boolean;
  college?: { id: string; name: string } | null;
}

const RepIdentity: React.FC<{ user: RepUser; avatarSize?: number }> = ({ user, avatarSize = 40 }) => (
  <div className="rep-identity">
    <UserAvatar user={user} size={avatarSize} />
    <div><span className="rep-name">{user.displayName || user.username}</span><span className="rep-handle">@{user.username}</span></div>
  </div>
);

const RepError: React.FC<{ message: string; onRetry?: () => void; onDismiss?: () => void }> = ({ message, onRetry, onDismiss }) => (
  <div className="rep-error" role="alert">
    <AlertCircle size={18} aria-hidden="true" /><span>{message}</span>
    {onRetry && <button className="btn-secondary" onClick={onRetry}><RefreshCw size={16} />Try again</button>}
    {onDismiss && <button className="rep-clear" aria-label="Dismiss action error" onClick={onDismiss}><X size={18} /></button>}
  </div>
);

export const CampusRepsPage: React.FC = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [activeView, setActiveView] = useState<'assign' | 'current'>('assign');
  const [search, setSearch] = useState('');
  const searchTerm = search.trim();
  const debouncedSearch = useDebounced(searchTerm, 300);
  const [campusFilter, setCampusFilter] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: repsData, isLoading: repsLoading, isFetching: repsFetching, error: repsError, refetch: refetchReps } = useQuery({
    queryKey: ['adminCampusReps'],
    queryFn: () => apiRequest('/admin/users/campus-reps'),
  });
  const reps = useMemo<RepUser[]>(() => repsData?.data ?? [], [repsData]);
  const repsByCollegeId = useMemo(() => {
    const map = new Map<string, RepUser>();
    reps.forEach((rep) => { if (rep.college?.id) map.set(rep.college.id, rep); });
    return map;
  }, [reps]);
  const repsByCampus = useMemo(() => {
    const map = new Map<string, { id: string; name: string; reps: RepUser[] }>();
    reps.forEach((rep) => {
      const id = rep.college?.id || 'no-campus';
      if (!map.has(id)) map.set(id, { id, name: rep.college?.name || 'No campus', reps: [] });
      map.get(id)!.reps.push(rep);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [reps]);
  const selectedCampus = repsByCampus.some((campus) => campus.id === campusFilter) ? campusFilter : '';
  const visibleCampuses = selectedCampus ? repsByCampus.filter((campus) => campus.id === selectedCampus) : repsByCampus;

  const { data: searchData, isFetching: searchFetching, error: searchError, refetch: refetchSearch } = useQuery({
    queryKey: ['adminRepCandidates', debouncedSearch],
    queryFn: () => apiRequest(`/admin/users/rep-candidates?search=${encodeURIComponent(debouncedSearch)}`),
    enabled: activeView === 'assign' && debouncedSearch.length > 0,
  });
  const searchResults: RepUser[] = searchData?.data ?? [];
  const searchWaiting = searchTerm !== debouncedSearch || searchFetching;

  const setRepMutation = useMutation({
    mutationFn: ({ id, isCampusRep }: { id: string; isCampusRep: boolean }) =>
      apiRequest(`/admin/users/${id}/campus-rep`, { method: 'POST', body: JSON.stringify({ isCampusRep }) }),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminCampusReps'] });
      queryClient.invalidateQueries({ queryKey: ['adminRepCandidates'] });
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] });
      queryClient.invalidateQueries({ queryKey: ['adminUser'] });
    },
    onError: (error: Error) => setActionError(error.message || 'Could not update the representative role.'),
  });

  const confirmRevoke = (user: RepUser) => confirm({
    title: `Revoke Campus Representative from @${user.username}?`,
    description: 'They lose the representative role and its badge across the app.',
    consequences: ['The role can be granted again at any time.'],
    severity: 'moderate',
    confirmLabel: 'Revoke role',
    onConfirm: () => setRepMutation.mutateAsync({ id: user.id, isCampusRep: false }),
  });
  const confirmAssign = (user: RepUser) => confirm({
    title: `Make @${user.username} the Campus Representative?`,
    description: 'They gain the representative role and badge for their campus, and can publish official Campus Events.',
    consequences: ['Each campus can have one representative. An existing representative must be revoked before another can be assigned.'],
    severity: 'moderate',
    confirmLabel: 'Assign role',
    onConfirm: () => setRepMutation.mutateAsync({ id: user.id, isCampusRep: true }),
  });

  const busy = setRepMutation.isPending;
  const revokeButton = (user: RepUser) => (
    <button className="rep-action rep-action-revoke" disabled={busy}
      onClick={() => confirmRevoke(user)} aria-label={`Revoke role from @${user.username}`} title="Revoke representative role">
      {busy && setRepMutation.variables?.id === user.id ? <Loader2 size={17} className="spin" /> : <ShieldAlert size={17} aria-hidden="true" />}
      <span className="rep-action-label">Revoke role</span>
    </button>
  );

  return (
    <div className="admin-page campus-reps-page">
      <div className="page-header">
        <div><h2 className="page-title">Campus Representatives</h2>
          <p className="page-subtitle">Manage campus roles and access to official Campus Events. One representative per campus.</p>
        </div>
      </div>

      <div className="reps-summary" aria-label="Campus representative totals">
        <dl className="rep-summary-card"><dt><span>Active representatives</span><Megaphone size={22} aria-hidden="true" /></dt>
          <dd>{repsLoading ? '…' : repsError && !repsData ? '—' : reps.length.toLocaleString()}</dd></dl>
        <dl className="rep-summary-card is-campuses"><dt><span>Campuses covered</span><Building2 size={22} aria-hidden="true" /></dt>
          <dd>{repsLoading ? '…' : repsError && !repsData ? '—' : repsByCollegeId.size.toLocaleString()}</dd></dl>
      </div>

        <div className="rep-view-tabs" role="tablist" aria-label="Representative management">
          {([
            { id: 'assign', label: 'Assign representative', icon: UserCheck },
            { id: 'current', label: 'Current representatives', icon: Megaphone },
          ] as const).map(({ id, label, icon: Icon }, index) => (
            <button key={id} id={`rep-tab-${id}`} role="tab" aria-selected={activeView === id}
              aria-controls={`rep-panel-${id}`} tabIndex={activeView === id ? 0 : -1}
              onClick={() => setActiveView(id)}
              onKeyDown={(event) => {
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1
                  : event.key === 'ArrowRight' ? (index + 1) % 2 : event.key === 'ArrowLeft' ? (index - 1 + 2) % 2 : null;
                if (next === null) return;
                event.preventDefault();
                setActiveView(next === 0 ? 'assign' : 'current');
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({ preventScroll: true });
              }}>
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </div>
      <div className="rep-management-panel">
        {actionError && <RepError message={actionError} onDismiss={() => setActionError(null)} />}
        {repsError && <RepError message={(repsError as Error).message || 'Could not load representatives.'} onRetry={() => refetchReps()} />}

      {activeView === 'assign' && <section className="rep-assignment-panel" role="tabpanel" id="rep-panel-assign" aria-labelledby="rep-tab-assign" tabIndex={0}>
        <div className="rep-section-heading">
          <div><h3 id="rep-assign-title">Assign a representative</h3><p>Find a student by name, username, or email.</p></div>
          <span className="rep-section-symbol" aria-hidden="true"><UserCheck size={22} /></span>
        </div>
        <div className="rep-search">
          <Search size={18} aria-hidden="true" />
          <input ref={searchRef} type="search" className="input-control" aria-label="Search representative candidates"
            autoCapitalize="none" spellCheck={false} placeholder="Search students…" value={search} onChange={(event) => setSearch(event.target.value)} />
          {search && <button className="rep-clear" aria-label="Clear candidate search" onClick={() => { setSearch(''); searchRef.current?.focus({ preventScroll: true }); }}><X size={18} /></button>}
        </div>

        {!searchTerm ? (
          <div className="rep-search-hint"><Search size={18} aria-hidden="true" /><span>Search to see candidates and campus availability.</span></div>
        ) : searchWaiting ? (
          <LoadingState label="Finding students…" compact />
        ) : searchError ? (
          <RepError message={(searchError as Error).message || 'Could not search students.'} onRetry={() => refetchSearch()} />
        ) : searchResults.length === 0 ? (
          <div className="rep-empty"><Search size={28} aria-hidden="true" /><h4>No matching students</h4><p>Try another name, username, or email.</p></div>
        ) : (
          <div className="rep-candidates-panel">
            <div className="rep-results-caption" role="status">{searchResults.length} matching student{searchResults.length === 1 ? '' : 's'}{searchResults.length === 20 ? ' · Refine your search for more specific results' : ''}</div>
            <div className="rep-table-frame">
            <table className="rep-candidates-table" role="table" aria-label="Representative candidates">
              <thead><tr><th>Student</th><th>Campus</th><th>Availability</th><th>Action</th></tr></thead>
              <tbody>{searchResults.map((user) => {
                const currentRep = user.college?.id ? repsByCollegeId.get(user.college.id) : undefined;
                const collegeTaken = Boolean(currentRep && currentRep.id !== user.id);
                const rosterUnknown = repsLoading || Boolean(repsError);
                const reason = !user.college?.id ? 'A campus affiliation is required.'
                  : rosterUnknown ? 'Campus availability could not be checked. Refresh the representative list.'
                    : collegeTaken ? `Represented by @${currentRep!.username}. Revoke their role before assigning another student.` : null;
                const label = user.isCampusRep ? 'Representative' : !user.college?.id ? 'No campus' : rosterUnknown ? 'Not checked' : collegeTaken ? 'Campus occupied' : 'Available';
                const tone = user.isCampusRep ? 'green' : collegeTaken ? 'amber' : reason ? 'neutral' : 'violet';
                return <tr key={user.id}>
                  <td className="rep-candidate-identity"><RepIdentity user={user} /></td>
                  <td className="rep-candidate-campus" data-has-campus={Boolean(user.college?.id)}><span>{user.college?.name || 'No campus affiliation'}</span>{reason && <small id={`rep-reason-${user.id}`}>{reason}</small>}</td>
                  <td className="rep-candidate-status"><span className={`rep-pill tone-${tone}`}>{label}</span></td>
                  <td className="rep-candidate-action">{user.isCampusRep ? revokeButton(user) : (
                    <button className="rep-action rep-action-assign" disabled={busy || Boolean(reason)}
                      aria-describedby={reason ? `rep-reason-${user.id}` : undefined}
                      title={reason ?? 'Assign representative role'} aria-label={`Assign role to @${user.username}`} onClick={() => confirmAssign(user)}>
                      <UserCheck size={17} aria-hidden="true" /><span className="rep-action-label">Assign role</span>
                    </button>
                  )}</td>
                </tr>;
              })}</tbody>
            </table>
            </div>
          </div>
        )}
      </section>}

      {activeView === 'current' && <section className="rep-roster-section" role="tabpanel" id="rep-panel-current" aria-labelledby="rep-tab-current" tabIndex={0}>
        <div className="rep-roster-toolbar">
          <div className="rep-section-heading"><div><h3 id="rep-roster-title">Representatives by campus</h3><p>{repsFetching && !repsLoading ? 'Updating representatives…' : 'Current role holders across your campuses.'}</p></div></div>
          <div className="rep-campus-filter"><Dropdown aria-label="Filter representatives by campus" value={selectedCampus} onChange={(event) => setCampusFilter(event.target.value)} disabled={repsLoading || Boolean(repsError) || !repsByCampus.length}>
            <option value="">All campuses</option>{repsByCampus.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
          </Dropdown></div>
        </div>
        {repsLoading ? <LoadingState label="Loading representatives…" /> : !repsError && reps.length === 0 ? (
          <div className="rep-empty rep-roster-empty"><Megaphone size={32} aria-hidden="true" /><h4>No representatives yet</h4><p>Choose a student from the Assign representative tab to get started.</p></div>
        ) : (
          <div className="rep-campus-grid">{visibleCampuses.map((campus) => (
            <article className="rep-campus-card" key={campus.id} aria-label={`${campus.name} representatives`}>
              <header className="rep-campus-heading"><span className="rep-campus-symbol" aria-hidden="true"><Building2 size={20} /></span><h4>{campus.name}</h4><span className="rep-pill tone-green"><ShieldCheck size={13} aria-hidden="true" />Assigned</span></header>
              <div className="rep-campus-members">{campus.reps.map((user) => <div className="rep-member" key={user.id}>
                <RepIdentity user={user} avatarSize={36} />
                <div className="rep-member-email"><Mail size={15} aria-hidden="true" /><span>{user.email || 'Email unavailable'}</span></div>
                <div className="rep-member-action">{revokeButton(user)}</div>
              </div>)}</div>
            </article>
          ))}</div>
        )}
      </section>}
      </div>
    </div>
  );
};
