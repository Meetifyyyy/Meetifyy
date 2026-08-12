import { useState, useRef, useEffect } from 'react';
import { X, ImagePlus, CalendarRange, AlertCircle } from 'lucide-react';
import { getMediaUrl } from '@shared/api/apiClient';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import { showToast } from '@shared/utils/toast';
import { useCreateCampusEvent, useUpdateCampusEvent, usePublishCampusEvent } from '@shared/hooks/useCampusEvents';
import { toLocalDate, toLocalTime, combineDateTime, isSafeRegistrationUrl, formatCardDate } from '../utils/formatEvent';
import MediaCropper from '@shared/components/media/MediaCropper';
import CustomDatePicker from '@shared/components/ui/CustomDatePicker';
import CustomTimePicker from '@shared/components/ui/CustomTimePicker';
import styles from './CampusEventForm.module.css';

/**
 * Create / edit modal for Campus Representatives. Image selection opens the
 * shared MediaCropper first; the cropped WebP blob then flows through
 * processAndUploadImage (compress → presigned-upload → confirm). No raw file
 * reaches the backend uncropped.
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
    // Split into separate date + time fields for cleaner UX.
    startDate:     toLocalDate(event?.startTime) || '',
    startTimeOnly: toLocalTime(event?.startTime) || '',
    endDate:       toLocalDate(event?.endTime) || '',
    endTimeOnly:   toLocalTime(event?.endTime) || '',
    posterUrl: event?.posterUrl || '',
  });

  // posterPreview holds a safe-to-display URL (blob or media URL).
  // cropTarget holds the raw File waiting to be cropped.
  const [posterPreview, setPosterPreview] = useState(
    event?.posterUrl ? getMediaUrl(event.posterUrl) : '',
  );
  const [cropTarget, setCropTarget] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');

  // Refs for cleanup, body scrolling and abort
  const abortRef = useRef(null);
  const bodyRef = useRef(null);
  const activeBlobUrlRef = useRef(null); // Tracks the local blob URL shown in posterPreview

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  // Abort any in-flight upload on unmount, cleanup object URLs, and lock background scroll
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      abortRef.current?.abort();
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // ── Step 1: File selected → open cropper ──────────────────────────────────
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    // Reset so the same file can be re-selected after a cancel
    e.target.value = '';
    if (!file) return;

    // Double-guard: MIME type AND extension — blocks spoofed files, SVG,
    // TIFF, HEIC, BMP and anything that slips past accept="image/..."
    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const ALLOWED_EXT  = /\.(jpe?g|png|webp|gif)$/i;
    if (!ALLOWED_MIME.includes(file.type) || !ALLOWED_EXT.test(file.name)) {
      const errMsg = 'Only JPG, PNG, WebP, or GIF images are allowed.';
      setError(errMsg);
      setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      const errMsg = 'Image must be under 20 MB.';
      setError(errMsg);
      setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
      return;
    }

    setError('');

    // Abort any previous in-flight upload first
    abortRef.current?.abort();
    abortRef.current = null;

    // Open the cropper with the raw file. MediaCropper handles its own object URL lifecycle.
    setCropTarget(file);
  };

  // ── Step 2: Crop applied → compress + upload ──────────────────────────────
  const handleCropComplete = async (croppedFile) => {
    setCropTarget(null);

    // Show the cropped result immediately so the user sees it right away.
    // croppedFile.previewUrl is set by MediaCropper; fall back to creating one.
    const previewUrl = croppedFile.previewUrl || URL.createObjectURL(croppedFile);

    // Revoke previous blob URL if we created one earlier to prevent memory leak
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
    }
    activeBlobUrlRef.current = previewUrl;
    setPosterPreview(previewUrl);

    // Clear stale error, start progress
    setError('');
    setUploading(true);
    setUploadProgress(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const uploadedKey = await processAndUploadImage(croppedFile, {
        preset: 'poster',
        onProgress: (p) => setUploadProgress(p),
        signal: controller.signal,
      });

      // Clear blob URL tracking now that we have a real backend key
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
      set({ posterUrl: uploadedKey });
      // Keep posterPreview showing the blob URL or update to real URL
      setPosterPreview(getMediaUrl(uploadedKey));
    } catch (err) {
      // Abort is expected when user replaces the image mid-upload — don't show error toast
      if (err?.name === 'AbortError') return;

      const errMsg = err?.message || 'Image upload failed. Tap to try again.';
      setError(errMsg);
      setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      abortRef.current = null;
    }
  };


  // ── Step 2 alt: Crop cancelled ─────────────────────────────────────────────
  const handleCropCancel = () => {
    setCropTarget(null);
  };

  // ── Date/Time synchronization helpers ────────────────────────────────────
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
      posterUrl: form.posterUrl || undefined,
    };
  };

  const submit = async () => {
    const v = validate();
    if (v) {
      setError(v);
      setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
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
      showToast(isEdit ? 'Event updated' : 'Event published', 'success');
      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      const errMsg = err?.message || 'Something went wrong. Please try again.';
      setError(errMsg);
      setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
    }
  };

  const busy = uploading || createMut.isPending || updateMut.isPending || publishMut.isPending;

  return (
    <>
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
                    <img className={styles.posterPreview} src={posterPreview} alt="Poster preview" />
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
                          {uploadProgress < 100 ? `${uploadProgress}%` : 'Finishing…'}
                        </span>
                      </div>
                    )}
                    {/* Upload-failed overlay — visible when there's an error and upload is idle */}
                    {!uploading && error && !form.posterUrl && (
                      <div className={styles.uploadFailedOverlay}>
                        <span className={styles.uploadFailedIcon}>!</span>
                        <span className={styles.uploadFailedText}>Not saved — tap to retry</span>
                      </div>
                    )}
                    {/* Change overlay on hover (only when not uploading or errored) */}
                    {!uploading && (
                      <div className={styles.changeOverlay}>
                        <ImagePlus size={18} />
                        <span>{error && !form.posterUrl ? 'Retry upload' : 'Change poster'}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <span className={styles.posterHint}>
                    <ImagePlus size={28} />
                    <span>{uploading ? 'Uploading…' : 'Click to upload event poster'}</span>
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
                  accept="image/jpeg,image/png,image/webp,image/gif"
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
                  Multi-day · 
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

      {/* Crop editor — rendered outside the form modal via portal */}
      {cropTarget && (
        <MediaCropper
          imageFile={cropTarget}
          aspect={3 / 4}
          cropShape="rect"
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}
    </>
  );
}
