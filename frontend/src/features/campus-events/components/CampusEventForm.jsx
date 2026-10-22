import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ImagePlus, CalendarRange } from '@shared/components/icons';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { getMediaUrl } from '@shared/api/apiClient';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  ALLOWED_IMAGE_ACCEPT,
} from '@shared/constants/mediaLimits';
import { showToast } from '@shared/utils/toast';
import { blockIfOffline, offlineMessage, submitErrorMessage } from '@shared/lib/offlineGuard';
import { useCreateCampusEvent, useUpdateCampusEvent, usePublishCampusEvent } from '@shared/hooks/useCampusEvents';
import { toLocalDate, toLocalTime, combineDateTime, isSafeRegistrationUrl } from '../utils/formatEvent';
import {
  formatDateLabel,
  formatDuration,
  formatTime12,
  minutesToTime,
  timeToMinutes,
  toISODate,
} from '../utils/eventDateTime';
import { EventDateField, EventTimeField } from './EventDateTimeFields';
import { useKeyboardOverlayForm } from './useKeyboardOverlayForm';
import styles from './CampusEventForm.module.css';

/** Length of the leave animation (`.leaving` in the stylesheet) in ms. */
const EXIT_MS = 220;

// Human-readable label per upload phase reported by the media pipeline.
const PHASE_LABELS = {
  preparing: 'Preparing',
  uploading: 'Uploading',
  uploaded: 'Finishing',
  finishing: 'Finishing',
  done: 'Done',
};

// Stage-specific diagnostics for tracing event-poster uploads in browser console.
const logUploadStage = (stage, detail = {}) => {
  console.info(`[campus-event-upload] ${stage}`, detail);
};

/**
 * Create / edit modal for Campus Events.
 *
 * UX Flow:
 *  1. File selected -> immediate local object URL preview in the upload box.
 *  2. Background pipeline -> compression & direct presigned upload with real-time progress.
 *  3. On success -> store authoritative storage key, preserve preview.
 *  4. On failure -> keep local preview visible, surface immediate error toast & retry badge.
 *  5. On submit -> wait for any active upload to complete, block on error, or save event.
 */
export default function CampusEventForm({ event = null, onClose, onSaved }) {
  const isEdit = Boolean(event?.id);

  // Leaving plays the entrance backwards: the page slides down first and is
  // only then removed. Every way out (X, backdrop, Back, Escape, a save) goes
  // through `close`, so none of them cuts the animation short.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef(0);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const leave = useCallback((afterLeave) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    closeTimerRef.current = window.setTimeout(() => {
      afterLeave?.();
      onCloseRef.current?.();
    }, reduced ? 0 : EXIT_MS);
  }, []);
  const close = useCallback(() => leave(), [leave]);
  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  useOverlayBack(true, close);

  const bodyRef = useRef(null);
  const footerRef = useRef(null);
  const keyboardProps = useKeyboardOverlayForm({ bodyRef, footerRef });
  useScrollLock(true);
  // Single day: one date, a start and an end time. Multi-day: each end has its
  // own date. The payload is the same either way (startTime / endTime).
  const [multiDay, setMultiDay] = useState(
    Boolean(event?.endTime && toLocalDate(event.startTime) !== toLocalDate(event.endTime)),
  );
  const createMut = useCreateCampusEvent();
  const updateMut = useUpdateCampusEvent();
  const publishMut = usePublishCampusEvent();

  const [form, setForm] = useState({
    title: event?.title || '',
    description: event?.description || '',
    hostedBy: event?.hostedBy || '',
    venue: event?.venue || '',
    registrationUrl: event?.registrationUrl || '',
    startDate:     toLocalDate(event?.startTime) || '',
    startTimeOnly: toLocalTime(event?.startTime) || '',
    endDate:       toLocalDate(event?.endTime) || '',
    endTimeOnly:   toLocalTime(event?.endTime) || '',
    posterUrl: event?.posterUrl || '',
  });

  // posterPreview holds a displayable URL (blob URL or backend media URL).
  const [posterPreview, setPosterPreview] = useState(
    event?.posterUrl ? getMediaUrl(event.posterUrl) : '',
  );
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState('preparing');
  const [error, setError] = useState('');

  // Refs for tracking active object URL, upload controller, selected raw file, and confirmed key
  const abortRef = useRef(null);
  const activeBlobUrlRef = useRef(null);
  const selectedFileRef = useRef(null);
  const posterKeyRef = useRef(event?.posterUrl || '');
  const posterUploadRef = useRef(null);
  /**
   * One key for the lifetime of this dialog, resent on every submit attempt.
   * The server keys creation on it, so a double-click or a retry after a
   * timeout resolves to the event the first attempt already created instead of
   * a second one. Regenerated only when the dialog is reopened.
   */
  const idempotencyKeyRef = useRef(
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  // Synchronize when event prop changes
  useEffect(() => {
    if (event?.id) {
      posterKeyRef.current = event.posterUrl || '';
      if (!activeBlobUrlRef.current) {
        setPosterPreview(event.posterUrl ? getMediaUrl(event.posterUrl) : '');
      }
    }
  }, [event]);

  // Clean up object URLs and abort in-flight uploads on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (activeBlobUrlRef.current) {
        try { URL.revokeObjectURL(activeBlobUrlRef.current); } catch (_) {}
        activeBlobUrlRef.current = null;
      }
    };
  }, []);

  // ── Background Upload Runner ───────────────────────────────────────────────
  const startPosterUpload = (file, previewUrl) => {
    // Abort previous in-flight upload
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError('');
    setUploading(true);
    setUploadProgress(0);
    setUploadPhase('preparing');
    posterKeyRef.current = '';
    set({ posterUrl: '' });

    const uploadPromise = (async () => {
      try {
        logUploadStage('UPLOAD_STARTED', { folder: 'events', type: file.type, size: file.size });
        const result = await processAndUploadImage(
          file,
          'events',
          { maxWidthOrHeight: 1920 },
          (p, phase) => {
            setUploadProgress(p);
            if (phase) setUploadPhase(phase);
          },
          controller.signal,
        );

        const uploadedKey = result?.key;
        if (!uploadedKey) {
          throw new Error('Image upload failed');
        }

        logUploadStage('UPLOAD_SUCCESS', { key: uploadedKey });
        posterKeyRef.current = uploadedKey;
        set({ posterUrl: uploadedKey });
        logUploadStage('URL_RETURNED', { key: uploadedKey, url: getMediaUrl(uploadedKey) });
        return uploadedKey;
      } catch (err) {
        if (err?.name === 'AbortError') {
          logUploadStage('UPLOAD_ABORTED');
          throw err;
        }
        const errMsg = err?.message || 'Image upload failed';
        logUploadStage('UPLOAD_FAILED', { message: errMsg });
        setError(errMsg);
        showToast(errMsg, 'error');
        throw err;
      } finally {
        setUploading(false);
        setUploadProgress(0);
        abortRef.current = null;
      }
    })();

    posterUploadRef.current = uploadPromise;
    uploadPromise.catch(() => {}); // prevent unhandled promise rejection
  };

  // ── Step 1: File selected → instant preview + background upload ────────────
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    // Reset file input value so selecting the same file after an error triggers onChange
    e.target.value = '';
    if (!file) return;
    logUploadStage('SELECTED', { name: file.name, type: file.type, size: file.size });

    // Double-guard validation: MIME type AND extension
    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const ALLOWED_EXT  = /\.(jpe?g|png|webp|gif)$/i;
    if (!ALLOWED_MIME.includes(file.type) || !ALLOWED_EXT.test(file.name)) {
      const errMsg = 'Invalid image format';
      setError(errMsg);
      showToast(errMsg, 'error');
      return;
    }
    if (file.size > MAX_COVERED_IMAGE_SIZE_BYTES) {
      const errMsg = COVERED_IMAGE_SIZE_ERROR_MESSAGE;
      setError(errMsg);
      showToast(errMsg, 'error');
      return;
    }

    logUploadStage('VALIDATED', { type: file.type, size: file.size });

    // Revoke previous blob URL if exists
    if (activeBlobUrlRef.current) {
      try { URL.revokeObjectURL(activeBlobUrlRef.current); } catch (_) {}
    }

    // Create immediate local preview URL
    const localPreviewUrl = URL.createObjectURL(file);
    activeBlobUrlRef.current = localPreviewUrl;
    selectedFileRef.current = file;

    // Display the preview immediately inside the upload box
    setPosterPreview(localPreviewUrl);

    // Kick off the upload in the background
    startPosterUpload(file, localPreviewUrl);
  };

  // ── Retry Upload ───────────────────────────────────────────────────────────
  const handleRetryUpload = (e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    if (selectedFileRef.current && !uploading) {
      startPosterUpload(selectedFileRef.current, posterPreview);
    }
  };

  // ── Date/Time synchronization helpers ──────────────────────────────────────
  const handleStartDateChange = (val) => {
    setForm((prev) => {
      const next = { ...prev, startDate: val };
      // Single day has no end date of its own; multi-day never ends before it starts.
      if (!multiDay || !prev.endDate || prev.endDate < val) next.endDate = val;
      return next;
    });
  };

  // Moving the start moves the end with it, keeping the event's length (an hour
  // when no end was set yet) - the way calendars do it, so a start that is
  // changed after the end was chosen cannot silently end up before it. Only
  // when both fall on one day and the result stays inside it.
  const handleStartTimeChange = (val) => {
    setForm((prev) => {
      const next = { ...prev, startTimeOnly: val };
      const oneDay = !multiDay || prev.endDate === prev.startDate;
      const start = timeToMinutes(val);
      if (!oneDay || start === null) return next;
      const prevStart = timeToMinutes(prev.startTimeOnly);
      const prevEnd = timeToMinutes(prev.endTimeOnly);
      let length = null;
      if (prevEnd === null) length = 60;
      else if (prevStart !== null && prevEnd > prevStart) length = prevEnd - prevStart;
      const end = length === null ? '' : minutesToTime(start + length);
      if (end) next.endTimeOnly = end;
      return next;
    });
  };

  const changeMultiDay = (value) => {
    if (value === multiDay) return;
    setMultiDay(value);
    // Back to one day: the end date follows the start again.
    if (!value) set({ endDate: form.startDate });
  };

  const today = toISODate(new Date());
  const startMinutes = timeToMinutes(form.startTimeOnly);
  const endMinutes = timeToMinutes(form.endTimeOnly);
  const effectiveEndDate = multiDay ? form.endDate : form.startDate;
  const endsSameDay = Boolean(form.startDate) && effectiveEndDate === form.startDate;
  const whenSummary = (() => {
    if (!form.startDate || startMinutes === null || endMinutes === null || !effectiveEndDate) return null;
    const start = new Date(combineDateTime(form.startDate, form.startTimeOnly));
    const end = new Date(combineDateTime(effectiveEndDate, form.endTimeOnly));
    if (!(end > start)) {
      return {
        warn: true,
        text: multiDay
          ? 'The end is not after the start.'
          : 'The end is not after the start. Ends after midnight? Choose Multi-day.',
      };
    }
    const length = formatDuration(Math.round((end - start) / 60000));
    const text = endsSameDay
      ? `${formatDateLabel(form.startDate)} · ${formatTime12(form.startTimeOnly)} to ${formatTime12(form.endTimeOnly)}`
      : `${formatDateLabel(form.startDate)}, ${formatTime12(form.startTimeOnly)} to ${formatDateLabel(effectiveEndDate)}, ${formatTime12(form.endTimeOnly)}`;
    return { warn: false, text: `${text} · ${length}` };
  })();

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = () => {
    if (!form.title.trim()) return 'Event title is required.';
    if (!form.hostedBy.trim()) return 'Organizer name is required.';
    if (!form.venue.trim()) return 'Venue is required.';
    if (!form.startDate) return 'Start date is required.';
    if (!form.startTimeOnly) return 'Start time is required.';
    if (multiDay && !form.endDate) return 'End date is required.';
    if (!form.endTimeOnly) return 'End time is required.';
    const start = combineDateTime(form.startDate, form.startTimeOnly);
    const end   = combineDateTime(multiDay ? form.endDate : form.startDate, form.endTimeOnly);
    if (!start) return 'Start date or time is invalid.';
    if (!end)   return 'End date or time is invalid.';

    const now = new Date();
    if (new Date(start) < new Date(now.getTime() - 5 * 60 * 1000)) {
      return 'Event start date and time cannot be in the past.';
    }

    if (new Date(end) <= new Date(start)) return 'End time must be after start time.';
    if (form.registrationUrl && !isSafeRegistrationUrl(form.registrationUrl)) {
      return 'Registration link must be a valid http or https URL.';
    }
    return '';
  };

  const buildPayload = () => {
    const startISO = new Date(combineDateTime(form.startDate, form.startTimeOnly)).toISOString();
    const endISO   = new Date(combineDateTime(multiDay ? form.endDate : form.startDate,   form.endTimeOnly)).toISOString();
    return {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      hostedBy: form.hostedBy.trim(),
      venue: form.venue.trim(),
      registrationUrl: form.registrationUrl.trim() || undefined,
      eventDate: startISO,
      startTime: startISO,
      endTime: endISO,
      // Prefer the authoritative ref holding the confirmed uploaded key
      posterUrl: posterKeyRef.current || form.posterUrl || undefined,
    };
  };

  const submit = async () => {
    const v = validate();
    if (v) {
      setError(v);
      showToast(v, 'error');
      return;
    }

    // Offline, before the poster is awaited (its failure would read as "Poster
    // upload failed"). The form keeps every field and the chosen poster.
    if (blockIfOffline('event')) {
      setError(offlineMessage('event'));
      return;
    }

    // Await any in-flight poster upload
    if (posterUploadRef.current) {
      try {
        await posterUploadRef.current;
      } catch (err) {
        if (err?.name !== 'AbortError') {
          const errMsg = 'Poster upload failed';
          setError(errMsg);
          showToast(errMsg, 'error');
          return;
        }
      }
    }

    // Block submit if a new image was selected but upload failed and was not resolved
    if (activeBlobUrlRef.current && !posterKeyRef.current) {
      const errMsg = 'Poster upload failed';
      setError(errMsg);
      showToast(errMsg, 'error');
      return;
    }

    setError('');
    try {
      const payload = buildPayload();
      let saved;
      if (isEdit) {
        saved = await updateMut.mutateAsync({ id: event.id, data: payload });
        if (saved?.status === 'DRAFT') {
          saved = await publishMut.mutateAsync(event.id);
        }
      } else {
        // One call, not create-then-publish. The old pair was not atomic: if
        // the publish failed the rep saw an error while the draft it had just
        // created stayed behind, invisible in every discovery scope.
        saved = await createMut.mutateAsync({
          ...payload,
          idempotencyKey: idempotencyKeyRef.current,
          publish: true,
        });
        if (saved?.status === 'DRAFT') {
          saved = await publishMut.mutateAsync(saved.id);
        }
      }
      logUploadStage('DB_SAVED', { eventId: saved?.id, posterUrl: saved?.posterUrl || payload.posterUrl || null });
      showToast(isEdit ? 'Event updated' : 'Event published', 'success');
      leave(() => onSaved?.(saved));
    } catch (err) {
      const errMsg = submitErrorMessage(err, "Couldn't save event");
      setError(errMsg);
      showToast(errMsg, 'error');
    }
  };

  const busy = uploading || createMut.isPending || updateMut.isPending || publishMut.isPending;

  // `data-bars-ignore`: in the installed app the status and navigation bars keep
  // following the page underneath while this is open. Sampled through the form
  // they took its colour at once, while the sheet was still sliding up.
  return createPortal(
    <div className={`${styles.overlay} ${closing ? styles.leaving : ''}`} data-bars-ignore {...keyboardProps} onClick={close}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={isEdit ? "Edit event" : "Create campus event"} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{isEdit ? 'Edit event' : 'Create campus event'}</h2>
          <button className={styles.closeBtn} onClick={close} aria-label="Close"><X size={20} /></button>
        </div>

        <div className={styles.body} ref={bodyRef}>

          {/* ── Poster upload ───────────────────────────────────────────── */}
          <div className={styles.field}>
            <span className={styles.label}>Event poster image</span>
            <label
              className={`${styles.posterUpload}${uploading ? ` ${styles.posterBusy}` : ''}`}
              aria-label="Upload event poster"
            >
              {posterPreview ? (
                <div className={styles.previewContainer}>
                  <img
                    className={styles.posterPreview}
                    src={posterPreview}
                    alt="Poster preview"
                    onLoad={() => {
                      if (posterKeyRef.current) logUploadStage('UI_RENDERED', { key: posterKeyRef.current, surface: 'form-preview' });
                    }}
                    onError={() => {
                      if (posterKeyRef.current) {
                        const message = "Couldn't display poster";
                        logUploadStage('UI_RENDER_FAILED', { key: posterKeyRef.current, message });
                        setError(message);
                        showToast(message, 'error');
                      }
                    }}
                  />
                  {/* Progress overlay while uploading */}
                  {uploading && (
                    <div className={styles.uploadOverlay}>
                      <div className={styles.progressTrack}>
                        <div
                          className={styles.progressBar}
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <span className={styles.uploadLabel}>
                        {PHASE_LABELS[uploadPhase] || 'Uploading'} · {uploadProgress}%
                      </span>
                    </div>
                  )}
                  {/* Upload-failed overlay — visible when there's an error and upload is idle */}
                  {!uploading && error && !posterKeyRef.current && (
                    <div
                      className={styles.uploadFailedOverlay}
                      onClick={handleRetryUpload}
                      role="button"
                      tabIndex={0}
                    >
                      <span className={styles.uploadFailedIcon}>!</span>
                      <span className={styles.uploadFailedText}>Upload failed — tap to retry</span>
                    </div>
                  )}
                  {/* Change overlay on hover (when idle and not failed) */}
                  {!uploading && (!error || Boolean(posterKeyRef.current)) && (
                    <div className={styles.changeOverlay}>
                      <ImagePlus size={18} />
                      <span>Change poster</span>
                    </div>
                  )}
                </div>
              ) : (
                <span className={styles.posterHint}>
                  <ImagePlus size={28} />
                  <span>
                    {uploading
                      ? `${PHASE_LABELS[uploadPhase] || 'Uploading'} · ${uploadProgress}%`
                      : 'Click to upload event poster'}
                  </span>
                  {uploading && (
                    <div className={styles.progressTrackBare}>
                      <div className={styles.progressBar} style={{ width: `${uploadProgress}%` }} />
                    </div>
                  )}
                </span>
              )}
              <input
                className={styles.hiddenFile}
                type="file"
                accept={ALLOWED_IMAGE_ACCEPT}
                disabled={uploading}
                onChange={handleFileSelect}
              />
            </label>
          </div>

          {/* ── Text fields ─────────────────────────────────────────────── */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="event-title">Event title *</label>
            <input id="event-title" className={styles.input} value={form.title} maxLength={50}
              onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Hackathon 2026" />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="event-hostedBy">Hosted by (organizer) *</label>
            <input id="event-hostedBy" className={styles.input} value={form.hostedBy} maxLength={50}
              onChange={(e) => set({ hostedBy: e.target.value })} placeholder="e.g. GLA Coding Club" />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="event-description">Description</label>
            <textarea id="event-description" className={styles.textarea} value={form.description} maxLength={500}
              onChange={(e) => set({ description: e.target.value })} placeholder="What's this event about?" />
          </div>

          {/* ── When ────────────────────────────────────────────────────── */}
          <div className={styles.when} role="group" aria-labelledby="event-when-label">
            <span id="event-when-label" className={styles.label}>When *</span>

            <div className={styles.segment} role="radiogroup" aria-label="Event length">
              <button
                type="button"
                role="radio"
                aria-checked={!multiDay}
                className={`${styles.segmentBtn} ${!multiDay ? styles.segmentOn : ''}`}
                onClick={() => changeMultiDay(false)}
              >
                Single day
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={multiDay}
                className={`${styles.segmentBtn} ${multiDay ? styles.segmentOn : ''}`}
                onClick={() => changeMultiDay(true)}
              >
                Multi-day
              </button>
            </div>

            {multiDay ? (
              <>
                <div className={styles.dateTimeRow}>
                  <div className={`${styles.field} ${styles.dateCol}`}>
                    <label className={styles.subLabel} htmlFor="event-start-date">Start date</label>
                    <EventDateField id="event-start-date" value={form.startDate} min={today}
                      onChange={handleStartDateChange} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.subLabel} htmlFor="event-start-time">Start time</label>
                    <EventTimeField id="event-start-time" value={form.startTimeOnly}
                      onChange={handleStartTimeChange} placeholder="Start" />
                  </div>
                </div>
                <div className={styles.dateTimeRow}>
                  <div className={`${styles.field} ${styles.dateCol}`}>
                    <label className={styles.subLabel} htmlFor="event-end-date">End date</label>
                    <EventDateField id="event-end-date" value={form.endDate}
                      min={form.startDate || today} onChange={(val) => set({ endDate: val })} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.subLabel} htmlFor="event-end-time">End time</label>
                    <EventTimeField id="event-end-time" value={form.endTimeOnly}
                      after={endsSameDay ? form.startTimeOnly : ''}
                      onChange={(val) => set({ endTimeOnly: val })} placeholder="End" />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className={styles.field}>
                  <label className={styles.subLabel} htmlFor="event-date">Date</label>
                  <EventDateField id="event-date" value={form.startDate} min={today}
                    onChange={handleStartDateChange} />
                </div>
                <div className={styles.dateTimeRow}>
                  <div className={styles.field}>
                    <label className={styles.subLabel} htmlFor="event-start-time">Starts</label>
                    <EventTimeField id="event-start-time" value={form.startTimeOnly}
                      onChange={handleStartTimeChange} placeholder="Start" />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.subLabel} htmlFor="event-end-time">Ends</label>
                    <EventTimeField id="event-end-time" value={form.endTimeOnly}
                      after={form.startTimeOnly}
                      onChange={(val) => set({ endTimeOnly: val })} placeholder="End" />
                  </div>
                </div>
              </>
            )}

            <p
              className={`${styles.whenSummary} ${whenSummary?.warn ? styles.whenWarn : ''} ${whenSummary ? '' : styles.whenHint}`}
              aria-live="polite"
            >
              <CalendarRange size={14} aria-hidden="true" />
              <span>{whenSummary ? whenSummary.text : multiDay ? 'Choose when it starts and ends.' : 'Choose a date, then a start and end time.'}</span>
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="event-venue">Venue *</label>
            <input id="event-venue" className={styles.input} value={form.venue} maxLength={100}
              onChange={(e) => set({ venue: e.target.value })} placeholder="e.g. Main Auditorium" />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="event-registrationUrl">Registration link</label>
            <input id="event-registrationUrl" className={styles.input} value={form.registrationUrl} type="url" maxLength={2048}
              onChange={(e) => set({ registrationUrl: e.target.value })} placeholder="https://forms.gle/…" />
          </div>

        </div>

        <div className={styles.footer} ref={footerRef}>
          {/* Here, not at the end of the scrolling body: a refusal has to be
              seen where the button is, however far down the form is. */}
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.btnPrimary} onClick={submit} disabled={busy || closing}>
            {isEdit ? 'Save changes' : 'Publish event'}
          </button>
        </div>
      </div>
    </div>, document.body
  );
}
