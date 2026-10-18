import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from '@shared/components/icons';
import { accountEmailApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useCampusAffiliation } from '@shared/hooks/useCampusAffiliation';
import { useCampusAffiliationActions } from '@shared/hooks/useCampusAffiliationActions';
import { describeCampusOtpError } from '@shared/lib/campusAccess';
import { showToast } from '@shared/utils/toast';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import PersonalEmailForm from '@shared/components/AccountEmail/PersonalEmailForm';
import styles from '@shared/components/AccountEmail/AccountEmail.module.css';

export const ACCOUNT_EMAIL_QUERY_KEY = ['account', 'email'];

/**
 * Settings → Account → Email.
 *
 * Two addresses, kept apart on purpose: the login email (what you sign in
 * with) and the verified college email (what opens Campus). Changing the first
 * goes through a code sent to the new address plus the current password;
 * changing the second happens on the Campus page, where it is verified.
 */
export default function SettingsEmailPanel() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const campus = useCampusAffiliation();
  const { removeAffiliation } = useCampusAffiliationActions();
  const [changing, setChanging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removePassword, setRemovePassword] = useState('');
  const [removeError, setRemoveError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);

  // The server's view of both addresses; the cached user is the fallback for
  // an API that predates this route.
  const { data: emailInfo, refetch } = useQuery({
    queryKey: [...ACCOUNT_EMAIL_QUERY_KEY, currentUser?.id],
    queryFn: () => accountEmailApi.get(),
    enabled: Boolean(currentUser?.id),
    retry: false,
    staleTime: 30 * 1000,
  });

  const loginEmail = currentUser?.email || emailInfo?.email || '';
  const affiliation = campus.isActive ? campus.affiliation : null;
  const collegeEmail = affiliation?.email || emailInfo?.collegeEmail || '';
  const collegeName = affiliation?.collegeName || '';
  const sameAsCollege =
    Boolean(currentUser?.profileCompletion?.needsPersonalEmail) || Boolean(emailInfo?.needsPersonalEmail);

  const doRemove = async () => {
    setConfirmOpen(false);
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await removeAffiliation(removePassword);
      setRemovePassword('');
      setRemoving(false);
      refetch();
      showToast('College email removed', 'success');
    } catch (err) {
      setRemoveError(describeCampusOtpError(err));
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <div className="animate-in">
      <section className={styles.card} aria-labelledby="settings-login-email">
        <h3 id="settings-login-email" className={styles.cardTitle}>
          Login email
        </h3>
        <div className={styles.kv}>
          <span className={styles.kvLabel}>You sign in with</span>
          <span className={styles.kvValue}>{loginEmail || 'Not set'}</span>
        </div>
        {sameAsCollege && !changing ? (
          <p className={styles.note}>
            You sign in with your college email. Add a personal email so you keep access after you
            graduate.
          </p>
        ) : null}
        {changing ? (
          <PersonalEmailForm
            submitLabel={sameAsCollege ? 'Add personal email' : 'Change email'}
            onCancel={() => setChanging(false)}
            onDone={(email) => {
              setChanging(false);
              refetch();
              showToast(email ? `You now sign in with ${email}` : 'Email updated', 'success');
            }}
          />
        ) : (
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryBtn} onClick={() => setChanging(true)}>
              {sameAsCollege ? 'Add personal email' : 'Change personal email'}
            </button>
          </div>
        )}
      </section>

      <section className={styles.card} aria-labelledby="settings-college-email">
        <h3 id="settings-college-email" className={styles.cardTitle}>
          College email
        </h3>
        {affiliation ? (
          <>
            <div className={styles.kv}>
              <span className={styles.kvLabel}>{collegeName || 'College'}</span>
              <span className={styles.kvValue}>{collegeEmail || 'Verified'}</span>
            </div>
            <p className={styles.text}>This verified address is what opens Campus. You don&apos;t sign in with it unless it is also your login email.</p>
            {removing ? (
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (removePassword) setConfirmOpen(true);
                }}
                noValidate
              >
                <p className={styles.note}>
                  Removing it closes Campus for you until you verify a college email again.
                </p>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="remove-college-password">
                    Current password
                  </label>
                  <input
                    id="remove-college-password"
                    className={styles.input}
                    type="password"
                    autoComplete="current-password"
                    value={removePassword}
                    onChange={(e) => {
                      setRemovePassword(e.target.value);
                      if (removeError) setRemoveError(null);
                    }}
                    disabled={removeBusy}
                  />
                </div>
                <div className={styles.error} role="alert" aria-live="polite">
                  {removeError ? (
                    <>
                      <AlertCircle size={14} aria-hidden="true" />
                      <span>{removeError}</span>
                    </>
                  ) : null}
                </div>
                <div className={styles.actions}>
                  <button type="submit" className={styles.dangerBtn} disabled={removeBusy || !removePassword}>
                    {removeBusy ? (
                      <>
                        <Loader2 size={16} className="spin" aria-hidden="true" />
                        <span>Removing…</span>
                      </>
                    ) : (
                      <span>Remove college email</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => {
                      setRemoving(false);
                      setRemovePassword('');
                      setRemoveError(null);
                    }}
                    disabled={removeBusy}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => navigate('/campus?verify=change')}
                >
                  Change college email
                </button>
                <button type="button" className={styles.linkBtn} onClick={() => setRemoving(true)}>
                  Remove college email
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className={styles.text}>
              No verified college email yet. Verify one to open Campus: your college directory,
              events and communities.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.primaryBtn} onClick={() => navigate('/campus')}>
                Verify college email
              </button>
            </div>
          </>
        )}
      </section>

      <ConfirmModal
        visible={confirmOpen}
        title="Remove college email?"
        description="You will lose access to Campus until you verify a college email again."
        confirmText="Remove"
        cancelText="Keep it"
        isDestructive
        onConfirm={doRemove}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
