import { useState, useRef, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  Camera,
  RefreshCw,
  Check,
  X,
  AlertCircle,
  CheckCircle2,
} from '@shared/components/icons';
import styles from './VerificationCameraCapture.module.css';

/**
 * VerificationCameraCapture
 *
 * A camera capture component with minimal, icon-only controls.
 * Features:
 * - Direct camera viewfinder with facingMode support (defaults to front/selfie).
 * - Adaptive mirroring (mirrored when front-facing, normal when rear-facing).
 * - Mobile-only icon flip camera button for devices with multiple cameras.
 * - Minimal white circular capture shutter button.
 * - Icon-only photo review actions (Retake, Confirm).
 * - Guaranteed stream track cleanup on capture, cancel, retry, and unmount.
 */
export default function VerificationCameraCapture({
  value,
  onChange,
  isSubmitting = false,
}) {
  const [cameraState, setCameraState] = useState('idle'); // 'idle' | 'starting' | 'active' | 'captured' | 'error'
  const [facingMode, setFacingMode] = useState('user'); // 'user' | 'environment'
  const [capturedImage, setCapturedImage] = useState(null); // { file: File, previewUrl: string } | null
  const [confirmedPreviewUrl, setConfirmedPreviewUrl] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [activeStream, setActiveStream] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Sync confirmed preview URL when value changes
  useEffect(() => {
    if (value && value instanceof File) {
      const url = URL.createObjectURL(value);
      setConfirmedPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else if (!value) {
      setConfirmedPreviewUrl(null);
    }
  }, [value]);

  // Safely stop all active camera tracks
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      try {
        const tracks = streamRef.current.getTracks();
        tracks.forEach((track) => {
          try {
            track.stop();
          } catch (e) {
            console.error('Error stopping media track:', e);
          }
        });
      } catch (e) {
        console.error('Error accessing media stream tracks:', e);
      }
      streamRef.current = null;
    }
    setActiveStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Connect stream to video element whenever activeStream or video mounts
  useEffect(() => {
    if (videoRef.current && activeStream) {
      videoRef.current.srcObject = activeStream;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch((err) => {
          console.warn('Video auto-play warning:', err);
        });
      };
    }
  }, [activeStream, cameraState]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (capturedImage?.previewUrl) {
        URL.revokeObjectURL(capturedImage.previewUrl);
      }
    };
  }, [stopCamera, capturedImage]);

  // Check for multiple video input devices
  const checkMultipleCameras = useCallback(async () => {
    if (navigator.mediaDevices?.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      } catch {
        // Fallback: keep default
      }
    }
  }, []);

  // Start device camera and trigger permissions
  const startCamera = useCallback(
    async (mode = facingMode) => {
      stopCamera();
      setErrorMessage(null);
      setCameraState('starting');

      // A page served over plain http from anything other than localhost is not
      // a secure context, and browsers do not expose `navigator.mediaDevices`
      // there at all. That is an origin problem, not a browser-support problem,
      // and saying "your browser doesn't support this" sends people to change
      // the one thing that isn't wrong. It is worth naming because this app is
      // routinely opened over a LAN IP for device testing.
      if (!window.isSecureContext) {
        setErrorMessage(
          'The camera is only available over a secure (https) connection. ' +
            'Open this page via https, or use localhost when testing.'
        );
        setCameraState('error');
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMessage('Camera access is not supported by your browser.');
        setCameraState('error');
        return;
      }

      // Whether a prompt is even reachable. When this already reads `denied`
      // before we ask, the browser will reject without showing anything, so a
      // "try again" message would be a lie. Not all browsers implement the
      // camera descriptor, hence the guarded read.
      let priorPermission = null;
      try {
        priorPermission = (
          await navigator.permissions?.query({ name: 'camera' })
        )?.state;
      } catch {
        // Descriptor unsupported (Firefox, older Safari) - fall through and let
        // getUserMedia itself be the source of truth.
      }

      try {
        let stream = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
        } catch (constraintError) {
          // Retry without constraints ONLY when the constraints were the
          // problem. This used to catch everything, so a refused permission was
          // immediately retried -- which asks the browser a second time, can
          // show a second prompt, and replaces the original error with the
          // retry's, losing the reason the first attempt failed.
          if (constraintError?.name !== 'OverconstrainedError' &&
              constraintError?.name !== 'ConstraintNotSatisfiedError') {
            throw constraintError;
          }
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;
        setActiveStream(stream);

        await checkMultipleCameras();
        setCameraState('active');
      } catch (err) {
        console.error('Camera initialization error:', err);
        let msg = 'Unable to access camera. Please check camera permissions.';
        if (
          err.name === 'NotAllowedError' ||
          err.name === 'PermissionDeniedError'
        ) {
          // Two different situations arrive as the same error, and they need
          // different instructions. If permission already read `denied` before
          // we asked, no prompt was ever shown -- the block is remembered from
          // a previous refusal or imposed by the page's permissions policy, and
          // retrying alone will never succeed. If it read `prompt`, the user
          // saw the request and dismissed it, so retrying genuinely works.
          msg =
            priorPermission === 'denied'
              ? 'Camera access is blocked for this site, so no permission prompt appears. ' +
                'Open your browser\u2019s site settings (the icon at the left of the address bar), ' +
                'set Camera to Allow, then retry.'
              : 'Camera permission was not granted. Choose \u201cAllow\u201d when your browser asks, then retry.';
        } else if (
          err.name === 'NotFoundError' ||
          err.name === 'DevicesNotFoundError'
        ) {
          msg = 'No camera device found on this system.';
        } else if (
          err.name === 'NotReadableError' ||
          err.name === 'TrackStartError'
        ) {
          msg = 'Camera is currently in use by another application.';
        }
        setErrorMessage(msg);
        setCameraState('error');
        stopCamera();
      }
    },
    [facingMode, stopCamera, checkMultipleCameras]
  );

  // Switch between front and rear cameras
  const toggleFacingMode = useCallback(() => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    startCamera(nextMode);
  }, [facingMode, startCamera]);

  // Capture frame to canvas and JPEG File
  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    try {
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (facingMode === 'user') {
        // Mirror front camera to match live selfie viewfinder
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(video, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            setErrorMessage('Failed to process captured image. Please try again.');
            setCameraState('error');
            return;
          }

          const file = new File([blob], `verification-selfie-${Date.now()}.jpg`, {
            type: 'image/jpeg',
          });
          const previewUrl = URL.createObjectURL(blob);

          // Clean up any previous unconfirmed preview
          if (capturedImage?.previewUrl) {
            URL.revokeObjectURL(capturedImage.previewUrl);
          }

          setCapturedImage({ file, previewUrl });
          stopCamera();
          setCameraState('captured');
        },
        'image/jpeg',
        0.92
      );
    } catch (err) {
      console.error('Error capturing photo:', err);
      setErrorMessage('Failed to capture photo. Please try again.');
      setCameraState('error');
    }
  }, [facingMode, capturedImage, stopCamera]);

  // Discard captured photo and reopen camera
  const handleRetake = useCallback(() => {
    if (capturedImage?.previewUrl) {
      URL.revokeObjectURL(capturedImage.previewUrl);
    }
    setCapturedImage(null);
    startCamera(facingMode);
  }, [capturedImage, facingMode, startCamera]);

  // Confirm captured photo
  const handleConfirm = useCallback(() => {
    if (!capturedImage) return;
    onChange(capturedImage.file);
    setCapturedImage(null);
    setCameraState('idle');
  }, [capturedImage, onChange]);

  // Cancel and return to idle
  const handleCancel = useCallback(() => {
    stopCamera();
    if (capturedImage?.previewUrl) {
      URL.revokeObjectURL(capturedImage.previewUrl);
    }
    setCapturedImage(null);
    setErrorMessage(null);
    setCameraState('idle');
  }, [stopCamera, capturedImage]);

  // Retake from confirmed state
  const handleRetakeConfirmed = useCallback(() => {
    onChange(null);
    startCamera('user');
  }, [onChange, startCamera]);

  // 1. Confirmed State (Photo already captured & confirmed)
  if (value && cameraState === 'idle') {
    return (
      <div className={styles.wrapper}>
        <div className={styles.confirmedCard}>
          <div className={styles.confirmedPreviewGroup}>
            {confirmedPreviewUrl ? (
              <img
                src={confirmedPreviewUrl}
                alt="Captured selfie preview"
                className={styles.confirmedThumbnail}
              />
            ) : (
              <div className={styles.confirmedThumbnail} />
            )}
            <div className={styles.confirmedInfo}>
              <div className={styles.confirmedStatus}>
                <CheckCircle2 size={16} />
                <span>Selfie captured</span>
              </div>
              <span className={styles.confirmedMeta}>Ready for verification</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRetakeConfirmed}
            disabled={isSubmitting}
            className={styles.retakeIconAction}
            title="Retake photo"
            aria-label="Retake photo"
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </div>
    );
  }

  // 2. Error State
  if (cameraState === 'error') {
    return (
      <div className={styles.wrapper}>
        <div className={styles.errorBox}>
          <div className={styles.errorContent}>
            <span className={styles.errorIcon}>
              <AlertCircle size={22} strokeWidth={2} />
            </span>
            <span>{errorMessage || 'Camera encountered an error.'}</span>
          </div>
          <button
            type="button"
            onClick={() => startCamera(facingMode)}
            className={styles.retryBtn}
            title="Retry Camera"
            aria-label="Retry Camera"
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </div>
    );
  }

  // 3. Live Viewfinder or Captured Review State
  if (
    cameraState === 'starting' ||
    cameraState === 'active' ||
    cameraState === 'captured'
  ) {
    const isLive = cameraState === 'active' || cameraState === 'starting';
    const isCaptured = cameraState === 'captured';

    return (
      <div className={styles.wrapper}>
        <div className={styles.viewportContainer}>
          {/* Live Video Feed */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`${styles.videoElement} ${
              facingMode === 'user' ? styles.mirrored : ''
            }`}
            style={{ display: isLive ? 'block' : 'none' }}
          />

          {/* Captured Image Review */}
          {isCaptured && capturedImage?.previewUrl && (
            <img
              src={capturedImage.previewUrl}
              alt="Captured frame review"
              className={styles.capturedImage}
            />
          )}

          {/* Loading Overlay - Text only */}
          {cameraState === 'starting' && (
            <div className={styles.loadingOverlay}>
              <span className={styles.loadingText}>Starting camera...</span>
            </div>
          )}

          {/* Top Bar Overlay (Icon-only controls) */}
          <div className={styles.topOverlay}>
            <div className={styles.topOverlayLeft}>
              {/* Flip camera: Mobile only and only when active with multiple cameras */}
              {cameraState === 'active' && hasMultipleCameras && (
                <button
                  type="button"
                  onClick={toggleFacingMode}
                  className={`${styles.iconBtn} ${styles.flipBtn}`}
                  title="Switch camera"
                  aria-label="Switch front and rear camera"
                >
                  <RefreshCw size={15} />
                </button>
              )}
            </div>

            <div className={styles.topOverlayRight}>
              <button
                type="button"
                onClick={handleCancel}
                className={styles.iconBtn}
                title="Close camera"
                aria-label="Close camera"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Bottom Controls Overlay - Only when live active */}
          {cameraState === 'active' && (
            <div className={styles.bottomOverlay}>
              <button
                type="button"
                onClick={handleCapture}
                className={styles.shutterOuter}
                title="Take photo"
                aria-label="Take photo"
              >
                <div className={styles.shutterInner} />
              </button>
            </div>
          )}

          {/* Review Actions Overlay (Icon-Only Retake & Confirm) */}
          {isCaptured && (
            <div className={styles.reviewOverlay}>
              <div className={styles.reviewGlassPill}>
                <button
                  type="button"
                  onClick={handleRetake}
                  className={styles.retakeBtn}
                  title="Retake photo"
                  aria-label="Retake photo"
                >
                  <RefreshCw size={19} />
                </button>

                <button
                  type="button"
                  onClick={handleConfirm}
                  className={styles.confirmBtn}
                  title="Use this photo"
                  aria-label="Use this photo"
                >
                  <Check size={22} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 4. Default / Idle State: Minimal Camera Trigger Button
  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        onClick={() => startCamera(facingMode)}
        disabled={isSubmitting}
        className={styles.triggerButton}
      >
        <Camera size={18} color="var(--color-text-light)" />
        <span>Take a selfie with camera</span>
      </button>
    </div>
  );
}

VerificationCameraCapture.propTypes = {
  value: PropTypes.any,
  onChange: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool,
};
