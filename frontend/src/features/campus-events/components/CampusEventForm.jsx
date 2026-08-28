import { useState, useRef, useEffect } from 'react';
import { X, ImagePlus, CalendarRange } from '@shared/components/icons';
import { getMediaUrl } from '@shared/api/apiClient';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  ALLOWED_IMAGE_ACCEPT,
} from '@shared/constants/mediaLimits';
import { showToast } from '@shared/utils/toast';
import { useCreateCampusEvent, useUpdateCampusEvent, usePublishCampusEvent } from '@shared/hooks/useCampusEvents';
import { toLocalDate, toLocalTime, combineDateTime, isSafeRegistrationUrl, formatCardDate } from '../utils/formatEvent';
import CustomDatePicker from '@shared/components/ui/CustomDatePicker';
import CustomTimePicker from '@shared/components/ui/CustomTimePicker';
import styles from './CampusEventForm.module.css';

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
  const bodyRef = useRef(null);
  const activeBlobUrlRef = useRef(null);
  const selectedFileRef = useRef(null);
  const posterKeyRef = useRef(event?.posterUrl || '');
  const posterUploadRef = useRef(null);

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
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      abortRef.current?.abort();
      if (activeBlobUrlRef.current) {
        try { URL.revokeObjectURL(activeBlobUrlRef.current); } catch (_) {}
        activeBlobUrlRef.current = null;
      }
      document.body.style.overflow = originalOverflow;
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
        setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
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
      setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
      return;
    }
    if (file.size > MAX_COVERED_IMAGE_SIZE_BYTES) {
      const errMsg = COVERED_IMAGE_SIZE_ERROR_MESSAGE;
      setError(errMsg);
      showToast(errMsg, 'error');
      setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
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
      if (!prev.endDate || prev.endDate < val) {
        next.endDate = val;
      }
      return next;
    });
  };

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = () => {
    if (!form.title.trim()) return 'Event title is required.';
    if (!form.hostedBy.trim()) return 'Organizer name is required.';
    if (!form.venue.trim()) return 'Venue is required.';
    if (!form.startDate) return 'Start date is required.';
    if (!form.startTimeOnly) return 'Start time is required.';
    if (!form.endDate) return 'End date is required.';
    if (!form.endTimeOnly) return 'End time is required.';
    const start = combineDateTime(form.startDate, form.startTimeOnly);
    const end   = combineDateTime(form.endDate, form.endTimeOnly);
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
    const endISO   = new Date(combineDateTime(form.endDate,   form.endTimeOnly)).toISOString();
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
      setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
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
          setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
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
        saved = await createMut.mutateAsync(payload);
        if (saved?.id) {
          saved = await publishMut.mutateAsync(saved.id);
        }
      }
      logUploadStage('DB_SAVED', { eventId: saved?.id, posterUrl: saved?.posterUrl || payload.posterUrl || null });
      showToast(isEdit ? 'Event updated' : 'Event published', 'success');
      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      const errMsg = err?.message || "Couldn't save event";
      setError(errMsg);
      showToast(errMsg, 'error');
      setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
    }
  };

  const busy = uploading || createMut.isPending || updateMut.isPending || publishMut.isPending;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{isEdit ? 'Edit event' : 'Create campus event'}</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close"><X size={20} /></button>
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
            <span className={styles.label}>Event title *</span>
            <input className={styles.input} value={form.title} maxLength={50}
              onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Hackathon 2026" />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Hosted by (organizer) *</span>
            <input className={styles.input} value={form.hostedBy} maxLength={50}
              onChange={(e) => set({ hostedBy: e.target.value })} placeholder="e.g. GLA Coding Club" />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Description</span>
            <textarea className={styles.textarea} value={form.description} maxLength={500}
              onChange={(e) => set({ description: e.target.value })} placeholder="What's this event about?" />
          </div>

          {/* ── Date & time ─────────────────────────────────────────────── */}
          {/* Starts row */}
          <div className={styles.dateTimeGroup}>
            <span className={styles.dateTimeGroupLabel}>Starts *</span>
            <div className={styles.dateTimeRow}>
              <div className={styles.dateBox}>
                <CustomDatePicker
                  value={form.startDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(val) => handleStartDateChange(val)}
                />
              </div>
              <div className={styles.timeBox}>
                <CustomTimePicker
                  value={form.startTimeOnly}
                  onChange={(val) => set({ startTimeOnly: val })}
                />
              </div>
            </div>
          </div>

          {/* Ends row */}
          <div className={styles.dateTimeGroup}>
            <span className={styles.dateTimeGroupLabel}>Ends *</span>
            <div className={styles.dateTimeRow}>
              <div className={styles.dateBox}>
                <CustomDatePicker
                  value={form.endDate}
                  min={form.startDate || new Date().toISOString().split('T')[0]}
                  onChange={(val) => set({ endDate: val })}
                />
              </div>
              <div className={styles.timeBox}>
                <CustomTimePicker
                  value={form.endTimeOnly}
                  onChange={(val) => set({ endTimeOnly: val })}
                />
              </div>
            </div>
          </div>

          {/* Multi-day badge — visible when start and end are on different dates */}
          {form.startDate && form.endDate && form.startDate !== form.endDate && (
            <div className={styles.multiDayBadge}>
              <CalendarRange size={14} />
              <span>
                Multi-day · 
                {formatCardDate(
                  combineDateTime(form.startDate, form.startTimeOnly || '00:00'),
                  combineDateTime(form.endDate,   form.endTimeOnly   || '23:59'),
                )}
              </span>
            </div>
          )}

          <div className={styles.field}>
            <span className={styles.label}>Venue *</span>
            <input className={styles.input} value={form.venue} maxLength={100}
              onChange={(e) => set({ venue: e.target.value })} placeholder="e.g. Main Auditorium" />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Registration link</span>
            <input className={styles.input} value={form.registrationUrl} type="url" maxLength={2048}
              onChange={(e) => set({ registrationUrl: e.target.value })} placeholder="https://forms.gle/…" />
          </div>

          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={styles.footer}>
          <button className={styles.btnPrimary} onClick={submit} disabled={busy}>
            {isEdit ? 'Save changes' : 'Publish event'}
          </button>
        </div>
      </div>
    </div>
  );
}
