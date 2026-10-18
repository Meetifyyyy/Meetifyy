import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  Loader2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from '@shared/components/icons';
import { accountEmailApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useCampusAffiliation } from '@shared/hooks/useCampusAffiliation';
import { useCampusAffiliationActions } from '@shared/hooks/useCampusAffiliationActions';
import { describeCampusOtpError } from '@shared/lib/campusAccess';
import { showToast } from '@shared/utils/toast';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import PersonalEmailForm from '@shared/components/AccountEmail/PersonalEmailForm';
import styles from '@shared/components/AccountEmail/AccountEmail.module.css';
import rs from '../pages/SettingsRoute.module.css';
import local from './SettingsEmailPanel.module.css';

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

  const removeForm = (
    <form
      className={local.formWrap}
      onSubmit={(e) => {
        e.preventDefault();
        if (removePassword) setConfirmOpen(true);
      }}
      noValidate
    >
      <p className={styles.note}>Removing it closes Campus for you until you verify a college email again.</p>
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
      <div className={`${styles.actions} ${styles.actionsEnd}`}>
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
      </div>
    </form>
  );

  return (
    <div className={`${rs.body} animate-in`}>
      <h3 id="settings-login-email" className={rs.sectionLabel}>
        Sign-in email
      </h3>
      <section className={`${rs.group} ${local.group}`} aria-labelledby="settings-login-email">
        <div className={local.infoRow}>
          <span className={rs.rowIcon} aria-hidden="true">
            <Mail size={18} />
          </span>
          <span className={rs.rowText}>
            <span className={local.value}>{loginEmail || 'Not set'}</span>
            <span className={rs.rowDesc}>You sign in with this address</span>
          </span>
        </div>
        {sameAsCollege && !changing ? (
          <p className={local.notice}>
            This is your college email. Add a personal email so you keep your account after you graduate.
          </p>
        ) : null}
        {changing ? (
          <div className={local.formWrap}>
            <PersonalEmailForm
              submitLabel={sameAsCollege ? 'Add personal email' : 'Change email'}
              alignActionsEnd
              onCancel={() => setChanging(false)}
              onDone={(email) => {
                setChanging(false);
                refetch();
                showToast(email ? `You now sign in with ${email}` : 'Email updated', 'success');
              }}
            />
          </div>
        ) : (
          <button type="button" className={rs.row} onClick={() => setChanging(true)}>
            <span className={rs.rowIcon} aria-hidden="true">
              {sameAsCollege ? <Plus size={18} /> : <Pencil size={18} />}
            </span>
            <span className={rs.rowText}>
              <span className={rs.rowLabel}>{sameAsCollege ? 'Add personal email' : 'Change sign-in email'}</span>
              <span className={rs.rowDesc}>We&apos;ll send a code to the new address</span>
            </span>
            <span className={rs.rowChev} aria-hidden="true">
              <ChevronRight size={18} strokeWidth={2.25} />
            </span>
          </button>
        )}
      </section>

      <h3 id="settings-college-email" className={rs.sectionLabel}>
        College email
      </h3>
      <section className={`${rs.group} ${local.group}`} aria-labelledby="settings-college-email">
        {affiliation ? (
          <>
            <div className={local.infoRow}>
              <span className={rs.rowIcon} aria-hidden="true">
                <GraduationCap size={18} />
              </span>
              <span className={rs.rowText}>
                <span className={local.value}>{collegeEmail || 'Verified'}</span>
                <span className={rs.rowDesc}>{collegeName || 'Your college'}</span>
              </span>
              <span className={local.chip}>
                <CheckCircle2 size={13} aria-hidden="true" />
                Verified
              </span>
            </div>
            {removing ? (
              removeForm
            ) : (
              <>
                <button type="button" className={rs.row} onClick={() => navigate('/campus?verify=change')}>
                  <span className={rs.rowIcon} aria-hidden="true">
                    <RefreshCw size={18} />
                  </span>
                  <span className={rs.rowText}>
                    <span className={rs.rowLabel}>Change college email</span>
                    <span className={rs.rowDesc}>Verify a different address on the Campus page</span>
                  </span>
                  <span className={rs.rowChev} aria-hidden="true">
                    <ChevronRight size={18} strokeWidth={2.25} />
                  </span>
                </button>
                <button type="button" className={`${rs.row} ${rs.rowDanger}`} onClick={() => setRemoving(true)}>
                  <span className={rs.rowIcon} aria-hidden="true">
                    <Trash2 size={18} />
                  </span>
                  <span className={rs.rowText}>
                    <span className={rs.rowLabel}>Remove college email</span>
                    <span className={rs.rowDesc}>Closes Campus until you verify again</span>
                  </span>
                </button>
              </>
            )}
          </>
        ) : (
          <button type="button" className={rs.row} onClick={() => navigate('/campus')}>
            <span className={rs.rowIcon} aria-hidden="true">
              <ShieldCheck size={18} />
            </span>
            <span className={rs.rowText}>
              <span className={rs.rowLabel}>Verify your college email</span>
              <span className={rs.rowDesc}>Opens your college directory, events and communities</span>
            </span>
            <span className={rs.rowChev} aria-hidden="true">
              <ChevronRight size={18} strokeWidth={2.25} />
            </span>
          </button>
        )}
      </section>
      <p className={local.footnote}>
        Your college email opens Campus. It isn&apos;t used to sign in unless it&apos;s also your sign-in email.
      </p>

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
