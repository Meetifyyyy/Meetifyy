import { useState } from 'react';
import { X, ImagePlus } from 'lucide-react';
import { getMediaUrl } from '@shared/api/apiClient';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import { showToast } from '@shared/utils/toast';
import { useCreateCampusEvent, useUpdateCampusEvent, usePublishCampusEvent } from '@shared/hooks/useCampusEvents';
import { toDatetimeLocal, isSafeRegistrationUrl } from '../utils/formatEvent';
import styles from './CampusEventForm.module.css';

/**
 * Create / edit modal for Campus Representatives. Uploads the poster via the
 * shared media endpoint, then creates or updates the event and optionally
 * publishes it in one flow.
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
    eventDate: toDatetimeLocal(event?.eventDate)?.slice(0, 10) || '',
    startTime: toDatetimeLocal(event?.startTime) || '',
    endTime: toDatetimeLocal(event?.endTime) || '',
    posterUrl: event?.posterUrl || '',
  });
  const [posterPreview, setPosterPreview] = useState(event?.posterUrl ? getMediaUrl(event.posterUrl) : '');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handlePoster = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { setError('Poster must be an image.'); return; }
    setError('');
    setPosterPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      // Reuse the shared pipeline: compresses to web-optimized webp (preserving
      // the poster's natural aspect ratio and enough quality for text) and
      // uploads a lightweight derived thumbnail for the grid. No manual resizing.
      const res = await processAndUploadImage(
        file,
        'events',
        { maxWidthOrHeight: 1920, initialQuality: 0.82 },
        null,
        null,
        { derivedThumbnail: true },
      );
      set({ posterUrl: res.key || res.publicUrl });
    } catch (err) {
      setError('Poster upload failed. Please try again.');
      setPosterPreview(form.posterUrl ? getMediaUrl(form.posterUrl) : '');
    } finally {
      setUploading(false);
    }
  };

  const validate = () => {
    if (!form.title.trim()) return 'Title is required.';
    if (!form.hostedBy.trim()) return 'Organizer (hosted by) is required.';
    if (!form.eventDate) return 'Event date is required.';
    if (!form.startTime || !form.endTime) return 'Start and end time are required.';
    if (new Date(form.endTime) <= new Date(form.startTime)) return 'End time must be after start time.';
    if (form.registrationUrl && !isSafeRegistrationUrl(form.registrationUrl)) {
      return 'Registration link must be a valid http(s) URL.';
    }
    return '';
  };

  const buildPayload = () => ({
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    hostedBy: form.hostedBy.trim(),
    venue: form.venue.trim() || undefined,
    registrationUrl: form.registrationUrl.trim() || undefined,
    eventDate: new Date(form.eventDate).toISOString(),
    startTime: new Date(form.startTime).toISOString(),
    endTime: new Date(form.endTime).toISOString(),
    posterUrl: form.posterUrl || undefined,
  });

  const submit = async (publish) => {
    const v = validate();
    if (v) { setError(v); return; }
    setError('');
    try {
      const payload = buildPayload();
      let saved;
      if (isEdit) {
        saved = await updateMut.mutateAsync({ id: event.id, data: payload });
        if (publish && saved.status === 'DRAFT') saved = await publishMut.mutateAsync(event.id);
      } else {
        saved = await createMut.mutateAsync(payload);
        if (publish) saved = await publishMut.mutateAsync(saved.id);
      }
      showToast(publish ? 'Event published' : 'Draft saved', 'success');
      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
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

        <div className={styles.body}>
          <label className={styles.posterUpload}>
            {posterPreview ? (
              <img className={styles.posterPreview} src={posterPreview} alt="Poster preview" />
            ) : (
              <span className={styles.posterHint}>
                <ImagePlus size={26} />
                {uploading ? 'Uploading…' : 'Upload event poster'}
              </span>
            )}
            <input className={styles.hiddenFile} type="file" accept="image/*" onChange={handlePoster} />
          </label>

          <div className={styles.field}>
            <span className={styles.label}>Event title *</span>
            <input className={styles.input} value={form.title} maxLength={120}
              onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Hackathon 2026" />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Hosted by (organizer) *</span>
            <input className={styles.input} value={form.hostedBy} maxLength={120}
              onChange={(e) => set({ hostedBy: e.target.value })} placeholder="e.g. GLA Coding Club" />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Description</span>
            <textarea className={styles.textarea} value={form.description} maxLength={4000}
              onChange={(e) => set({ description: e.target.value })} placeholder="What's this event about?" />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Event date *</span>
            <input className={styles.input} type="date" value={form.eventDate}
              onChange={(e) => set({ eventDate: e.target.value })} />
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <span className={styles.label}>Starts *</span>
              <input className={styles.input} type="datetime-local" value={form.startTime}
                onChange={(e) => set({ startTime: e.target.value })} />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Ends *</span>
              <input className={styles.input} type="datetime-local" value={form.endTime}
                onChange={(e) => set({ endTime: e.target.value })} />
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Venue</span>
            <input className={styles.input} value={form.venue} maxLength={200}
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
          <button className={styles.btnSecondary} onClick={() => submit(false)} disabled={busy}>
            Save draft
          </button>
          <button className={styles.btnPrimary} onClick={() => submit(true)} disabled={busy}>
            {isEdit ? 'Save & publish' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
