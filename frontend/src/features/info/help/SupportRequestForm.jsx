import { useEffect, useRef, useState } from 'react';
import { supportApi } from '@shared/api/apiClient';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Send,
  Upload,
  X,
} from '@shared/components/icons';
import CustomSelect from '@shared/components/ui/CustomSelect';
import styles from './HelpSupport.module.css';

const MAX_DESCRIPTION = 10000;
const MIN_DESCRIPTION = 20;
const MAX_SUBJECT = 200;

const EMPTY_FORM = { name: '', email: '', category: '', subject: '', description: '' };

/**
 * Diagnostic context submitted alongside the request.
 *
 * All of it is a convenience for whoever triages the ticket. The server treats
 * every field as untrusted display text and re-reads the user agent from the
 * request header itself, so nothing here is relied on for a decision, and none
 * of it identifies the user beyond what the browser already sends.
 */
function collectBrowserInfo() {
  if (typeof navigator === 'undefined') return {};

  const ua = navigator.userAgent || '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Unknown';

  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown';

  return {
    browser,
    os,
    deviceType: /Mobi|Android/i.test(ua) ? 'mobile' : 'desktop',
    screen: typeof window !== 'undefined' ? `${window.screen?.width}x${window.screen?.height}` : undefined,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Client-side mirror of the server's rules. The server remains the authority. */
function validate(form) {
  const errors = {};

  const name = form.name.trim();
  if (!name) errors.name = 'Enter your name.';
  else if (name.length < 2) errors.name = 'Name must be at least 2 characters.';
  else if (name.length > 100) errors.name = 'Name cannot exceed 100 characters.';

  const email = form.email.trim();
  if (!email) errors.email = 'Enter your email address so we can reply.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'That does not look like a valid email address.';
  } else if (email.length > 254) {
    errors.email = 'Email cannot exceed 254 characters.';
  }

  if (!form.category) errors.category = 'Choose the area your issue relates to.';

  const subject = form.subject.trim();
  if (!subject) errors.subject = 'Add a short subject.';
  else if (subject.length < 3) errors.subject = 'The subject is too short.';
  else if (subject.length > MAX_SUBJECT) errors.subject = `Subject cannot exceed ${MAX_SUBJECT} characters.`;

  const description = form.description.trim();
  if (!description) errors.description = 'Describe what happened.';
  else if (description.length < MIN_DESCRIPTION) {
    errors.description = `Please add a little more detail, at least ${MIN_DESCRIPTION} characters.`;
  } else if (description.length > MAX_DESCRIPTION) {
    errors.description = `Description cannot exceed ${MAX_DESCRIPTION} characters.`;
  }

  return errors;
}

export default function SupportRequestForm({ meta, presetCategory, onClose }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);

  const fileInputRef = useRef(null);
  // Read at submit time rather than held in state: the field is never touched
  // by a real user, so re-rendering on every keystroke into it would be
  // pointless, and keeping it out of `form` keeps it out of the reset path.
  const honeypotRef = useRef(null);
  const errorSummaryRef = useRef(null);
  const successRef = useRef(null);
  const panelRef = useRef(null);
  // Guards against a double submit landing two tickets. `submitting` drives the
  // button, but a second submit event can fire before React has re-rendered.
  const inFlightRef = useRef(false);

  const limits = meta?.attachments;
  const categories = meta?.categories ?? [];

  // A topic chosen from the cards above fills the field in, so picking
  // "Chat & Messaging" and then opening the form does not mean choosing twice.
  useEffect(() => {
    if (presetCategory) setForm((prev) => (prev.category ? prev : { ...prev, category: presetCategory }));
  }, [presetCategory]);

  // Focus moves to the outcome so a screen-reader user is not left at the
  // submit button wondering whether anything happened.
  useEffect(() => {
    if (result) successRef.current?.focus();
  }, [result]);

  useEffect(() => {
    if (submitError) errorSummaryRef.current?.focus();
  }, [submitError]);

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((prev) => ({ ...prev, [key]: value }));
    // Cleared as the user types rather than only on resubmit, so a corrected
    // field stops looking wrong immediately.
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  async function handleFiles(event) {
    const picked = Array.from(event.target.files ?? []);
    if (!picked.length) return;

    // Reset the input so picking the same file again (e.g. after fixing it)
    // fires a change event.
    if (fileInputRef.current) fileInputRef.current.value = '';

    const maxFiles = limits?.maxFiles ?? 5;
    const maxBytes = limits?.maxBytesPerFile ?? 10 * 1024 * 1024;
    const allowed = new Set(limits?.allowedMimeTypes ?? []);

    const remainingSlots = Math.max(0, maxFiles - files.length);
    const toProcess = picked.slice(0, remainingSlots);

    for (const file of toProcess) {
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (allowed.size && !allowed.has(file.type)) {
        setFiles((prev) => [
          ...prev,
          {
            localId,
            name: file.name,
            size: file.size,
            status: 'error',
            error: 'Unsupported file type',
          },
        ]);
        continue;
      }

      if (file.size > maxBytes) {
        setFiles((prev) => [
          ...prev,
          {
            localId,
            name: file.name,
            size: file.size,
            status: 'error',
            error: `Exceeds ${formatBytes(maxBytes)} limit`,
          },
        ]);
        continue;
      }

      // Optimistic item: visible immediately with a spinner while the upload runs.
      setFiles((prev) => [
        ...prev,
        {
          localId,
          name: file.name,
          size: file.size,
          mimeType: file.type,
          status: 'uploading',
        },
      ]);

      try {
        const uploadResult = await supportApi.uploadAttachment(file);
        setFiles((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  status: 'ready',
                  key: uploadResult.key || uploadResult.storageKey,
                  storageKey: uploadResult.key || uploadResult.storageKey,
                  attachmentId: uploadResult.mediaId || uploadResult.attachmentId,
                  url: uploadResult.url,
                }
              : item,
          ),
        );
      } catch (error) {
        setFiles((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  status: 'error',
                  error: error.message || 'Upload failed',
                }
              : item,
          ),
        );
      }
    }
  }

  function removeFile(localId) {
    setFiles((prev) => prev.filter((f) => f.localId !== localId));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (inFlightRef.current) return;

    // Honeypot tripped: silently refuse without sending to the API.
    if (honeypotRef.current && honeypotRef.current.value) {
      setResult({ ticketNumber: 'MFT-000000' });
      return;
    }

    const validationErrors = validate(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      // Focus the first invalid field so keyboard and screen-reader users are
      // carried directly to the problem.
      const firstKey = Object.keys(validationErrors)[0];
      const target = panelRef.current?.querySelector(`[name="${firstKey}"]`);
      target?.focus();
      return;
    }

    // Do not submit while an attachment is half-way through uploading.
    const anyUploading = files.some((f) => f.status === 'uploading');
    if (anyUploading) return;

    // Only successfully uploaded files make it into the ticket payload.
    const readyAttachments = files
      .filter((f) => f.status === 'ready' && (f.key || f.storageKey))
      .map((f) => ({
        key: f.key || f.storageKey,
        filename: f.name,
      }));

    setSubmitting(true);
    setSubmitError(null);
    inFlightRef.current = true;

    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        category: form.category,
        subject: form.subject.trim(),
        description: form.description.trim(),
        attachments: readyAttachments.length ? readyAttachments : undefined,
        clientContext: collectBrowserInfo(),
      };

      const response = await supportApi.submitSupportRequest(payload);
      setResult(response);
      setForm(EMPTY_FORM);
      setFiles([]);
      setErrors({});
    } catch (error) {
      if (error.status === 429) {
        setSubmitError(
          error.message ||
            'You have sent several support requests recently. Please wait a little while before sending another.',
        );
      } else if (error.status >= 500) {
        setSubmitError(
          'Something went wrong on our side and your request was not sent. Please try again in a moment.',
        );
      } else if (!error.status) {
        setSubmitError('We could not reach Meetifyy. Check your connection and try again, your message is still here.');
      } else {
        setSubmitError(error.message || 'Your request could not be sent. Please check the form and try again.');
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  // ── Success ────────────────────────────────────────────────────────────────

  if (result) {
    return (
      <div className={styles.successPanel} ref={successRef} tabIndex={-1} role="status" aria-live="polite">
        <div className={styles.successIcon} aria-hidden="true">
          <CheckCircle2 size={26} />
        </div>
        <h3 className={styles.successTitle}>Support request submitted successfully</h3>

        <p className={styles.successText}>
          Your request has been submitted successfully. Your Request ID is{' '}
          <strong className={styles.requestIdHighlight}>{result.ticketNumber}</strong>. A copy of your request
          details has also been sent to your registered email address. Our support team will review your request and
          work to resolve the issue as soon as possible.
        </p>

        {result.redactedSensitiveContent && (
          <div className={`${styles.alert} ${styles.alertWarn}`} style={{ marginTop: '1.5rem', textAlign: 'left' }}>
            <AlertTriangle size={17} aria-hidden="true" className={styles.alertIcon} />
            <span>
              Part of your message looked like a password or access code, so we removed it before saving. Meetifyy
              support will never ask you for one.
            </span>
          </div>
        )}

        <button
          type="button"
          className={styles.ghostBtn}
          style={{ marginTop: '1.5rem' }}
          onClick={() => {
            setResult(null);
            setErrors({});
          }}
        >
          Send another request
        </button>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  const uploading = files.some((f) => f.status === 'uploading');
  const maxFiles = limits?.maxFiles ?? 5;
  const atFileLimit = files.length >= maxFiles;

  return (
    <form className={styles.formPanel} ref={panelRef} onSubmit={handleSubmit} noValidate>
      <div className={styles.formHeader}>
        <div>
          <h3 className={styles.formTitle}>Create a support request</h3>
          <p className={styles.formSubtitle}>
            We reply by email, usually within one working day. Fields marked with an asterisk are required.
          </p>
        </div>
        {onClose && (
          <button type="button" className={styles.formClose} onClick={onClose} aria-label="Close the support form">
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </div>

      {submitError && (
        <div className={`${styles.alert} ${styles.alertError}`} role="alert" tabIndex={-1} ref={errorSummaryRef}>
          <AlertCircle size={17} aria-hidden="true" className={styles.alertIcon} />
          <span>{submitError}</span>
        </div>
      )}

      <div className={styles.fieldGrid}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="support-name">
            Name <span className={styles.required} aria-hidden="true">*</span>
          </label>
          <input
            id="support-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            aria-required="true"
            maxLength={100}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'support-name-error' : undefined}
            className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
            placeholder="What should we call you?"
            value={form.name}
            onChange={setField('name')}
          />
          {errors.name && (
            <span className={styles.errorText} id="support-name-error">
              <AlertCircle size={13} aria-hidden="true" />
              {errors.name}
            </span>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="support-email">
            Email address <span className={styles.required} aria-hidden="true">*</span>
          </label>
          <input
            id="support-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-required="true"
            maxLength={254}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'support-email-error' : undefined}
            className={`${styles.input} ${errors.email ? styles.inputError : ''}`}
            placeholder="email address"
            value={form.email}
            onChange={setField('email')}
          />
          {errors.email && (
            <span className={styles.errorText} id="support-email-error">
              <AlertCircle size={13} aria-hidden="true" />
              {errors.email}
            </span>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="support-category">
            Issue category <span className={styles.required} aria-hidden="true">*</span>
          </label>
          <CustomSelect
            id="support-category"
            name="category"
            value={form.category}
            onChange={setField('category')}
            options={categories}
            placeholder="Choose a category"
            required
            aria-required="true"
            aria-invalid={Boolean(errors.category)}
            aria-describedby={errors.category ? 'support-category-error' : undefined}
            error={Boolean(errors.category)}
          />
          {errors.category && (
            <span className={styles.errorText} id="support-category-error">
              <AlertCircle size={13} aria-hidden="true" />
              {errors.category}
            </span>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="support-subject">
            Subject <span className={styles.required} aria-hidden="true">*</span>
          </label>
          <input
            id="support-subject"
            name="subject"
            type="text"
            required
            aria-required="true"
            maxLength={MAX_SUBJECT}
            aria-invalid={Boolean(errors.subject)}
            aria-describedby={errors.subject ? 'support-subject-error' : undefined}
            className={`${styles.input} ${errors.subject ? styles.inputError : ''}`}
            placeholder="A one-line summary"
            value={form.subject}
            onChange={setField('subject')}
          />
          {errors.subject && (
            <span className={styles.errorText} id="support-subject-error">
              <AlertCircle size={13} aria-hidden="true" />
              {errors.subject}
            </span>
          )}
        </div>

        <div className={`${styles.field} ${styles.fieldFull}`}>
          <label className={styles.label} htmlFor="support-description">
            Description <span className={styles.required} aria-hidden="true">*</span>
          </label>
          <textarea
            id="support-description"
            name="description"
            required
            aria-required="true"
            maxLength={MAX_DESCRIPTION}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? 'support-description-error' : 'support-description-hint'}
            className={`${styles.textarea} ${errors.description ? styles.inputError : ''}`}
            placeholder="What happened, what you expected, and anything you have already tried."
            value={form.description}
            onChange={setField('description')}
          />
          <div className={styles.charCount} aria-hidden="true">
            {form.description.length} / {MAX_DESCRIPTION}
          </div>
          {errors.description ? (
            <span className={styles.errorText} id="support-description-error">
              <AlertCircle size={13} aria-hidden="true" />
              {errors.description}
            </span>
          ) : (
            <span className={styles.hint} id="support-description-hint">
              Never include your password, verification codes or payment details. Support will never ask for them.
            </span>
          )}
        </div>

        <div className={`${styles.field} ${styles.fieldFull}`}>
          <span className={styles.label} id="support-attachments-label">
            Attachment <span className={styles.optional}>(optional)</span>
          </span>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className={styles.srOnly}
            aria-labelledby="support-attachments-label"
            accept={limits?.allowedMimeTypes?.join(',')}
            onChange={handleFiles}
          />
          <button
            type="button"
            className={styles.dropZone}
            disabled={atFileLimit}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={18} aria-hidden="true" style={{ color: '#a8a29e' }} />
            <span className={styles.dropZoneText}>
              {atFileLimit ? 'Attachment limit reached' : 'Add a screenshot or file'}
            </span>
            <span className={styles.dropZoneHint}>
              PNG, JPG, WEBP, GIF, PDF or TXT. Up to {maxFiles} files,{' '}
              {limits ? formatBytes(limits.maxBytesPerFile) : '10 MB'} each.
            </span>
          </button>

          {files.length > 0 && (
            <ul className={styles.fileList}>
              {files.map((file) => (
                <li
                  key={file.localId}
                  className={`${styles.fileItem} ${file.status === 'error' ? styles.fileError : ''}`}
                >
                  {file.status === 'uploading' ? (
                    <Loader2 size={15} aria-hidden="true" className={styles.spin} />
                  ) : file.status === 'error' ? (
                    <AlertCircle size={15} aria-hidden="true" />
                  ) : (
                    <Check size={15} aria-hidden="true" className={styles.fileDone} />
                  )}
                  <span className={styles.fileName}>{file.name}</span>
                  <span className={styles.fileMeta}>
                    {file.status === 'uploading'
                      ? 'Uploading'
                      : file.status === 'error'
                        ? file.error
                        : formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    className={styles.fileRemove}
                    onClick={() => removeFile(file.localId)}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/*
        Honeypot. Positioned off-screen rather than hidden with display:none,
        and marked aria-hidden with a negative tabindex so no real person,
        sighted or otherwise, can reach it by accident.
      */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor="support-website">Leave this field empty</label>
        <input ref={honeypotRef} id="support-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className={styles.formActions}>
        <button type="submit" className={styles.primaryBtn} disabled={submitting || uploading}>
          {submitting ? (
            <>
              <Loader2 size={16} aria-hidden="true" className={styles.spin} />
              Sending
            </>
          ) : (
            <>
              <Send size={16} aria-hidden="true" />
              Submit request
            </>
          )}
        </button>
        {uploading && (
          <span className={styles.hint}>Waiting for your attachments to finish uploading.</span>
        )}
      </div>
    </form>
  );
}
