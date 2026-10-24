import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  GraduationCap,
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
import { describeCampusOtpError, formatEligibleDate } from '@shared/lib/campusAccess';
import { showToast } from '@shared/utils/toast';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import PersonalEmailForm from '@shared/components/AccountEmail/PersonalEmailForm';
import { REAUTH_CANCELLED, useReauth } from '@shared/components/AccountEmail/ReauthModal';
import { withReauth } from '@shared/components/AccountEmail/withReauth';
import rs from '../pages/SettingsRoute.module.css';
import local from './SettingsEmailPanel.module.css';

export const ACCOUNT_EMAIL_QUERY_KEY = ['account', 'email'];

/** A cooldown end the server sent, if it is still in the future. */
function activeUntil(iso) {
  const at = iso ? new Date(iso).getTime() : 0;
  return Number.isFinite(at) && at > Date.now() ? iso : null;
}

/**
 * Settings → Account → Email.
 *
 * Two addresses, kept apart on purpose: the login email (what you sign in
 * with) and the verified college email (what opens Campus). Changing either,
 * or removing the college email, starts with "confirm it's you"; each may
 * change once every 30 days. The server enforces both — the disabled rows here
 * only say so up front, with the date from the server in local time.
 */
export default function SettingsEmailPanel() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const campus = useCampusAffiliation();
  const { removeAffiliation } = useCampusAffiliationActions();
  const [changing, setChanging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const removeReauth = useReauth('college_email_remove', {
    description: "For your security, confirm it's you before removing your college email.",
  });

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
  const personalUntil = activeUntil(emailInfo?.cooldowns?.personal);
  const collegeUntil = activeUntil(emailInfo?.cooldowns?.college);

  // Confirm what removal does, then confirm it's you, then remove.
  const doRemove = async () => {
    setConfirmOpen(false);
    if (removeBusy) return;
    setRemoveBusy(true);
    try {
      await withReauth(removeReauth, (reauthToken) => removeAffiliation(reauthToken));
      removeReauth.invalidate();
      refetch();
      showToast('College email removed', 'success');
    } catch (err) {
      if (err?.code !== REAUTH_CANCELLED) showToast(describeCampusOtpError(err), 'error');
    } finally {
      setRemoveBusy(false);
    }
  };

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
        {changing && !personalUntil ? (
          <div className={local.formWrap}>
            <PersonalEmailForm
              submitLabel={sameAsCollege ? 'Add personal email' : 'Change email'}
              alignActionsEnd
              reauthFirst
              onCancel={() => setChanging(false)}
              onDone={(email) => {
                setChanging(false);
                refetch();
                showToast(email ? `You now sign in with ${email}` : 'Email updated', 'success');
              }}
            />
          </div>
        ) : personalUntil ? (
          <div className={local.infoRow} aria-disabled="true">
            <span className={rs.rowIcon} aria-hidden="true">
              <Clock size={18} />
            </span>
            <span className={rs.rowText}>
              <span className={rs.rowLabel}>Change sign-in email</span>
              <span className={rs.rowDesc}>
                For account security, you can change this again on {formatEligibleDate(personalUntil)}
              </span>
            </span>
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
            {collegeUntil ? (
              <div className={local.infoRow} aria-disabled="true">
                <span className={rs.rowIcon} aria-hidden="true">
                  <Clock size={18} />
                </span>
                <span className={rs.rowText}>
                  <span className={rs.rowLabel}>Change college email</span>
                  <span className={rs.rowDesc}>
                    For account security, you can change this again on {formatEligibleDate(collegeUntil)}
                  </span>
                </span>
              </div>
            ) : (
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
            )}
            {/* Never blocked by the cooldown: giving up access is always allowed. */}
            <button
              type="button"
              className={`${rs.row} ${rs.rowDanger}`}
              onClick={() => setConfirmOpen(true)}
              disabled={removeBusy}
            >
              <span className={rs.rowIcon} aria-hidden="true">
                <Trash2 size={18} />
              </span>
              <span className={rs.rowText}>
                <span className={rs.rowLabel}>{removeBusy ? 'Removing…' : 'Remove college email'}</span>
                <span className={rs.rowDesc}>Closes Campus until you verify again</span>
              </span>
            </button>
          </>
        ) : collegeUntil ? (
          <div className={local.infoRow} aria-disabled="true">
            <span className={rs.rowIcon} aria-hidden="true">
              <Clock size={18} />
            </span>
            <span className={rs.rowText}>
              <span className={rs.rowLabel}>Verify your college email</span>
              <span className={rs.rowDesc}>
                For account security, you can add one again on {formatEligibleDate(collegeUntil)}
              </span>
            </span>
          </div>
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
        For account security, each email can be changed once every 30 days.
      </p>

      <ConfirmModal
        visible={confirmOpen}
        title="Remove college email?"
        description="Campus, your college directory and campus communities close for you straight away. Your posts, profile and other communities stay. You can add a college email again after 30 days."
        confirmText="Continue"
        cancelText="Keep it"
        isDestructive
        onConfirm={doRemove}
        onCancel={() => setConfirmOpen(false)}
      />
      {removeReauth.modal}
    </div>
  );
}
