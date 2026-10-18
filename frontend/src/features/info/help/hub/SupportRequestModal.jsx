import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supportApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useSheetDrag } from '@shared/hooks/useSheetDrag';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import CustomSelect from '@shared/components/ui/CustomSelect';
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ImagePlus,
  Info,
  Lightbulb,
  Loader2,
  X,
} from '@shared/components/icons';
import { collectDiagnostics, diagnosticsRows } from './diagnostics';
import { useSupportAttachments } from './useSupportAttachments';
import styles from './SupportRequestModal.module.css';

/** Mirrors CreateSupportRequestDto / CreateAccountSupportRequestDto. */
const LIMITS = { subjectMin: 3, subjectMax: 200, descriptionMin: 20, descriptionMax: 10000, nameMin: 2, nameMax: 100 };

const FREQUENCIES = ['Every time', 'Sometimes', 'Just once'];

const COPY = {
  problem: {
    type: 'PROBLEM',
    title: 'Report a problem',
    icon: Bug,
    intro: 'Tell us what went wrong and we will look into it.',
    categoryLabel: 'What is it about?',
    subjectLabel: 'Summary',
    subjectPlaceholder: 'e.g. Photos will not upload in chat',
    descriptionLabel: 'What happened?',
    descriptionHint: 'What were you doing, what did you expect, and what happened instead?',
    imagesLabel: 'Screenshots',
    submit: 'Send report',
    doneTitle: 'Report sent',
    doneText: 'We will look into it and reply by email.',
  },
  idea: {
    type: 'IDEA',
    title: 'Share an idea',
    icon: Lightbulb,
    intro: 'Something you wish Meetifyy did, or did differently? Every idea is read by the team.',
    categoryLabel: 'Which part of Meetifyy?',
    subjectLabel: 'Your idea in a line',
    subjectPlaceholder: 'e.g. Let community admins pin a post',
    descriptionLabel: 'Tell us more',
    descriptionHint: 'What should it do, and how would it help you or your campus?',
    imagesLabel: 'Images or sketches',
    submit: 'Send idea',
    doneTitle: 'Thanks for the idea',
    doneText: 'The team reads every one. We will email you if we have questions.',
  },
};

/** Ideas are not safety reports; a safety concern is filed as a problem. */
const NOT_FOR_IDEAS = new Set(['SAFETY_REPORTING']);

/** A real address to reply to; never the internal `@meetifyy.user` placeholder. */
function accountAddress(user) {
  // The sign-in address: it may be personal, and it outlives a college email.
  const email = user?.email || user?.collegeEmail || '';
  return email.endsWith('@meetifyy.user') ? '' : email;
}

function validate(form, { guest }) {
  const errors = {};
  if (guest) {
    if (form.name.trim().length < LIMITS.nameMin) errors.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = 'Enter an email address we can reply to.';
  }
  if (!form.category) errors.category = 'Choose what this is about.';
  const subject = form.subject.trim();
  if (subject.length < LIMITS.subjectMin) errors.subject = `Add a short summary (at least ${LIMITS.subjectMin} characters).`;
  const description = form.description.trim();
  if (description.length < LIMITS.descriptionMin) {
    errors.description = `A little more detail, please (at least ${LIMITS.descriptionMin} characters).`;
  }
  return errors;
}

function errorMessage(error) {
  if (!error?.status) return 'We could not reach Meetifyy. Check your connection and try again. Nothing you wrote has been lost.';
  if (error.status === 429) return error.message || 'You have sent several requests recently. Please wait a little before sending another.';
  if (error.status >= 500) return 'Something went wrong on our side and this was not sent. Please try again in a moment.';
  return error.message || 'This could not be sent. Check the form and try again.';
}

/**
 * "Report a problem" and "Share an idea". A bottom sheet on phones and a
 * centred dialog on larger screens, like ReportModal.
 *
 * Signed in, the request is filed as the account (`POST requests/mine`), so it
 * always appears in Your requests and nobody retypes a name or address. Signed
 * out (the website), it asks for both and uses the public route.
 *
 * @param {object} p
 * @param {'problem'|'idea'|null} p.kind  null = closed
 * @param {() => void} p.onClose
 * @param {() => void} [p.onViewRequests]  shown after success when signed in
 */
export default function SupportRequestModal({ kind, onClose, onViewRequests }) {
  const open = Boolean(kind);
  // Remounting the body per opening resets every field, upload and result.
  return open ? <ModalBody key={kind} kind={kind} onClose={onClose} onViewRequests={onViewRequests} /> : null;
}

function ModalBody({ kind, onClose, onViewRequests }) {
  const copy = COPY[kind];
  const { currentUser } = useAuth();
  const guest = !currentUser;
  const queryClient = useQueryClient();
  const uid = useId();
  const id = (name) => `${uid}-${name}`;

  const { data: meta } = useQuery({
    queryKey: ['support', 'form-meta'],
    queryFn: ({ signal }) => supportApi.getFormMeta({ signal }),
    staleTime: 10 * 60 * 1000,
  });
  const attachments = useSupportAttachments(meta?.attachments);

  const [form, setForm] = useState({
    name: currentUser?.displayName || '',
    email: '',
    category: '',
    subject: '',
    description: '',
    frequency: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);

  // A second tap can land before React re-renders the disabled button.
  const inFlight = useRef(false);
  const honeypot = useRef(null);
  const formRef = useRef(null);
  const doneRef = useRef(null);
  const errorRef = useRef(null);
  // Where the user was when they opened this: the most useful context we have.
  const pageContext = useRef(typeof window !== 'undefined' ? window.location.pathname : '');

  const close = () => {
    if (!submitting) onClose();
  };
  useOverlayBack(true, close);
  const sheetRef = useSheetDrag(close, { enabled: !submitting });
  useScrollLock(true);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (result) doneRef.current?.focus();
  }, [result]);
  useEffect(() => {
    if (submitError) errorRef.current?.focus();
  }, [submitError]);

  const categories = (meta?.categories ?? []).filter((c) => kind === 'problem' || !NOT_FOR_IDEAS.has(c.value));

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  async function submit(e) {
    e.preventDefault();
    if (inFlight.current || attachments.uploading) return;

    const found = validate(form, { guest });
    if (Object.keys(found).length) {
      setErrors(found);
      formRef.current?.querySelector(`[name="${Object.keys(found)[0]}"]`)?.focus();
      return;
    }

    let description = form.description.trim();
    if (kind === 'problem' && form.frequency) description += `\n\nHow often: ${form.frequency}`;

    const payload = {
      type: copy.type,
      category: form.category,
      subject: form.subject.trim(),
      description,
      attachments: attachments.refs.length ? attachments.refs : undefined,
      browserInfo: collectDiagnostics(),
      pageContext: pageContext.current || undefined,
    };

    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = guest
        ? await supportApi.submitRequest({
            ...payload,
            name: form.name.trim(),
            email: form.email.trim(),
            website: honeypot.current?.value || undefined,
          })
        : await supportApi.submitMyRequest(payload);
      setResult(response);
      attachments.reset();
      // The new request belongs at the top of Your requests the next time it shows.
      queryClient.invalidateQueries({ queryKey: ['support', 'my-requests'] });
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const Icon = copy.icon;
  const replyTo = guest ? form.email.trim() : accountAddress(currentUser);

  return createPortal(
    <div className={styles.overlay} onClick={close} role="presentation">
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id('title')}
        onClick={(e) => e.stopPropagation()}
        data-kind={kind}
      >
        <div className="sheet-handle" data-sheet-handle aria-hidden="true" />
        <header className={styles.header}>
          <span className={styles.headIcon} aria-hidden="true">
            <Icon size={18} />
          </span>
          <h2 id={id('title')} className={styles.title}>
            {copy.title}
          </h2>
          <button type="button" className={styles.close} onClick={close} aria-label="Close" disabled={submitting}>
            <X size={18} />
          </button>
        </header>

        {result ? (
          <div className={styles.done} ref={doneRef} tabIndex={-1} role="status">
            <span className={styles.doneIcon} aria-hidden="true">
              <CheckCircle2 size={30} />
            </span>
            <p className={styles.doneTitle}>{copy.doneTitle}</p>
            <p className={styles.doneText}>
              {copy.doneText}
              {replyTo ? ` Replies go to ${replyTo}.` : ''}
            </p>
            <p className={styles.ticket}>
              Request ID <strong>{result.ticketNumber}</strong>
            </p>
            {result.redactedSensitiveContent && (
              <p className={styles.notice}>
                Part of your message looked like a password or code, so we removed it before saving. Meetifyy will never ask you for one.
              </p>
            )}
            <div className={styles.actions}>
              {!guest && onViewRequests && (
                <button type="button" className={styles.secondaryBtn} onClick={onViewRequests}>
                  View your requests
                </button>
              )}
              <button type="button" className={styles.primaryBtn} onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
            <p className={styles.intro}>{copy.intro}</p>

            {submitError && (
              <div className={styles.errorBox} role="alert" tabIndex={-1} ref={errorRef}>
                <AlertCircle size={16} aria-hidden="true" />
                <span>{submitError}</span>
              </div>
            )}

            {guest && (
              <div className={styles.row2}>
                <Field id={id('name')} label="Your name" error={errors.name}>
                  <input
                    id={id('name')}
                    name="name"
                    className={styles.input}
                    value={form.name}
                    onChange={set('name')}
                    maxLength={LIMITS.nameMax}
                    autoComplete="name"
                    aria-invalid={Boolean(errors.name)}
                  />
                </Field>
                <Field id={id('email')} label="Email for our reply" error={errors.email}>
                  <input
                    id={id('email')}
                    name="email"
                    type="email"
                    inputMode="email"
                    className={styles.input}
                    value={form.email}
                    onChange={set('email')}
                    autoComplete="email"
                    aria-invalid={Boolean(errors.email)}
                  />
                </Field>
              </div>
            )}

            <Field id={id('category')} label={copy.categoryLabel} error={errors.category}>
              <CustomSelect
                id={id('category')}
                name="category"
                value={form.category}
                onChange={set('category')}
                options={categories}
                placeholder={meta ? 'Choose an area' : 'Loading…'}
                disabled={!meta}
                error={Boolean(errors.category)}
                aria-invalid={Boolean(errors.category)}
              />
            </Field>

            {form.category === 'SAFETY_REPORTING' && (
              <p className={styles.safety} role="note">
                If anyone is in immediate danger, call <a href="tel:112">112</a> first.
              </p>
            )}

            <Field id={id('subject')} label={copy.subjectLabel} error={errors.subject}>
              <input
                id={id('subject')}
                name="subject"
                className={styles.input}
                value={form.subject}
                onChange={set('subject')}
                maxLength={LIMITS.subjectMax}
                placeholder={copy.subjectPlaceholder}
                aria-invalid={Boolean(errors.subject)}
              />
            </Field>

            <Field
              id={id('description')}
              label={copy.descriptionLabel}
              hint={copy.descriptionHint}
              error={errors.description}
              counter={`${form.description.length.toLocaleString()} / ${LIMITS.descriptionMax.toLocaleString()}`}
            >
              <textarea
                id={id('description')}
                name="description"
                className={`${styles.input} ${styles.textarea}`}
                value={form.description}
                onChange={set('description')}
                maxLength={LIMITS.descriptionMax}
                rows={5}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={id('description-hint')}
              />
            </Field>

            {kind === 'problem' && (
              <fieldset className={styles.fieldset}>
                <legend className={styles.label}>
                  How often does it happen? <span className={styles.optional}>Optional</span>
                </legend>
                <div className={styles.chips}>
                  {FREQUENCIES.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={styles.chip}
                      aria-pressed={form.frequency === f}
                      onClick={() => set('frequency')(form.frequency === f ? '' : f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            <div className={styles.field}>
              <span className={styles.label}>
                {copy.imagesLabel} <span className={styles.optional}>Optional, up to {attachments.maxFiles}</span>
              </span>
              <div className={styles.thumbs}>
                {attachments.files.map((f) => (
                  <div key={f.localId} className={styles.thumb} data-status={f.status} title={f.error || f.name}>
                    {f.preview ? <img src={f.preview} alt={f.name} /> : <AlertCircle size={18} aria-hidden="true" />}
                    {f.status === 'uploading' && (
                      <span className={styles.thumbOverlay} aria-label="Uploading">
                        <Loader2 size={18} className={styles.spin} />
                      </span>
                    )}
                    {f.status === 'error' && <span className={styles.thumbError}>{f.error}</span>}
                    <button
                      type="button"
                      className={styles.thumbRemove}
                      onClick={() => attachments.remove(f.localId)}
                      aria-label={`Remove ${f.name}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {attachments.canAddMore && (
                  <label className={styles.addThumb}>
                    <ImagePlus size={20} aria-hidden="true" />
                    <span>Add</span>
                    <input
                      type="file"
                      accept={attachments.accept}
                      multiple
                      className={styles.fileInput}
                      onChange={(e) => {
                        attachments.add(e.target.files ?? []);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>
            </div>

            {kind === 'problem' && (
              <details className={styles.diagnostics}>
                <summary>
                  <Info size={15} aria-hidden="true" className={styles.diagIcon} />
                  <span>Your app version and device details are included to help us fix this.</span>
                  <span className={styles.diagMore}>What&rsquo;s included</span>
                </summary>
                <dl className={styles.diagList}>
                  {diagnosticsRows().map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}

            {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
            {guest && (
              <input
                ref={honeypot}
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className={styles.honeypot}
              />
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.secondaryBtn} onClick={close} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className={styles.primaryBtn} disabled={submitting || attachments.uploading}>
                {submitting ? (
                  <>
                    <Loader2 size={16} className={styles.spin} aria-hidden="true" /> Sending…
                  </>
                ) : attachments.uploading ? (
                  'Uploading…'
                ) : (
                  copy.submit
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Field({ id, label, hint, error, counter, children }) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {counter && <span className={styles.counter}>{counter}</span>}
      </div>
      {hint && (
        <p className={styles.hint} id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
