import { useState, useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import { getCroppedImg } from './cropImageUtils';
import { X, Check, Loader2 } from '@shared/components/icons';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useDialogFocus } from '@shared/hooks/useDialogFocus';
import styles from './MediaCropper.module.css';

// Read live, not captured at module load or first render: the setting can change
// while the app is open, and the answer is wanted at the moment of the delay.
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export default function MediaCropper({ imageFile, aspect, cropShape = 'rect', onCropComplete, onCancel, onError }) {
  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(true, onCancel);
  // Background stays put while this dialog is open. Counted, so a
  // dialog opened on top of another cannot unlock the page when it closes.
  useScrollLock(true);

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  useEffect(() => {
    if (imageFile) {
      if (typeof imageFile === 'string') {
        setImageSrc(imageFile);
      } else {
        const url = URL.createObjectURL(imageFile);
        setImageSrc(url);
        return () => URL.revokeObjectURL(url);
      }
    }
  }, [imageFile]);

  const onCropCompleteHandler = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const [isClosing, setIsClosing] = useState(false);

  const titleId = useId();
  const zoomId = useId();
  const dialogRef = useRef(null);

  // Escape cancels, unless a crop is already being produced - cancelling then
  // would unmount the dialog under a result that is about to be delivered.
  useDialogFocus(dialogRef, {
    active: Boolean(imageSrc),
    onEscape: () => { if (!isProcessing && !isClosing) onCancel(); },
    getInitialFocus: () => dialogRef.current,
  });

  const handleSmoothClose = (callback) => {
    setIsClosing(true);
    // With reduced motion there is no fade to wait for, so nothing waits.
    if (prefersReducedMotion()) {
      callback();
      return;
    }
    setTimeout(() => {
      callback();
    }, 200);
  };

  const handleConfirm = async () => {
    if (isProcessing || isClosing) return;
    setIsProcessing(true);
    const startTime = Date.now();
    try {
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels);
      if (!croppedBlob || croppedBlob.size === 0) {
        throw new Error('The browser could not create the cropped image. Please try another image.');
      }
      const fileName = (typeof imageFile === 'object' && imageFile?.name)
        ? imageFile.name.replace(/\.[^.]+$/, '.webp')
        : 'cropped.webp';
      const croppedFile = new File([croppedBlob], fileName, {
        type: 'image/webp',
        lastModified: Date.now(),
      });
      croppedFile.previewUrl = URL.createObjectURL(croppedBlob);

      // Minimum spinner display, so a very fast crop does not flash. Skipped when
      // the person has asked for reduced motion: the "Cropping..." label is the
      // feedback, and holding the dialog for a half second adds nothing to it.
      const elapsed = Date.now() - startTime;
      if (elapsed < 500 && !prefersReducedMotion()) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }

      handleSmoothClose(() => onCropComplete(croppedFile));
    } catch (e) {
      const error = e instanceof Error
        ? e
        : new Error('Could not prepare this image. Please try another JPG, PNG, WebP, or GIF.');
      console.error('[media-cropper] crop failed:', error);
      handleSmoothClose(() => {
        if (onError) onError(error);
        else onCancel();
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!imageSrc) return null;

  return createPortal(
    <div
      className={`${styles.overlay} ${isClosing ? styles.closing : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing && !isClosing) {
          handleSmoothClose(onCancel);
        }
      }}
    >
      <div
        ref={dialogRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isProcessing || undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={styles.header}>
          <h3 id={titleId} className={styles.title}>
            Crop Image
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className={styles.closeBtn}
            aria-label="Close"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Scrolls on its own when the window is too short for everything; the
            header and the actions stay put, so Apply is always reachable. */}
        <div className={styles.body}>
          <style>{`
            .customSquircleCropArea {
              border-radius: 24px !important;
            }
            .react-easy-crop_crop-area {
              border-radius: ${cropShape === 'round' ? '50%' : '24px'} !important;
            }
          `}</style>
          <div className={styles.cropArea}>
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onCropComplete={onCropCompleteHandler}
              onZoomChange={setZoom}
              objectFit="contain"
              cropShape={cropShape}
              classes={{
                cropAreaClassName: cropShape === 'round' ? '' : 'customSquircleCropArea'
              }}
              showGrid={true}
            />
          </div>

          {/* Zoom Slider */}
          <div className={styles.zoomRow}>
            <label htmlFor={zoomId} className={styles.zoomLabel}>
              Zoom
            </label>
            <input
              id={zoomId}
              type="range"
              value={zoom}
              min={1}
              max={3}
              step={0.05}
              aria-valuetext={`${Math.round(zoom * 100)}%`}
              onChange={(e) => setZoom(Number(e.target.value))}
              className={styles.zoomSlider}
            />
          </div>
        </div>

        {/* Announced separately: a live region inside a button is not spoken. */}
        <p className={styles.srOnly} role="status">{isProcessing ? 'Cropping image' : ''}</p>

        {/* Action Buttons */}
        <div className={styles.actions}>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className={styles.cancelBtn}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing}
            className={styles.applyBtn}
          >
            {isProcessing ? (
              <>
                <Loader2 size={18} className={styles.spinner} aria-hidden="true" />
                <span>Cropping...</span>
              </>
            ) : (
              <>
                <Check size={18} aria-hidden="true" />
                <span>Apply Crop</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
