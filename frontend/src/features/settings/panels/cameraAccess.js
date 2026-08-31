const CONSTRAINT_ERROR_NAMES = new Set([
  'OverconstrainedError',
  'ConstraintNotSatisfiedError',
]);

export function requestCameraStream(mediaDevices, facingMode = 'user') {
  // Keep this as the first browser API call in the click path. In particular,
  // do not await Permissions API checks before requesting the stream: support
  // for the camera permission descriptor is inconsistent, and the media request
  // itself is what triggers the browser's native prompt.
  const request = mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  return request.catch((error) => {
    if (!CONSTRAINT_ERROR_NAMES.has(error?.name)) {
      throw error;
    }

    return mediaDevices.getUserMedia({ video: true, audio: false });
  });
}

export async function readCameraPermissionState(permissions) {
  if (!permissions?.query) return 'unknown';

  try {
    const state = (await permissions.query({ name: 'camera' }))?.state;
    return state === 'prompt' || state === 'granted' || state === 'denied'
      ? state
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function isCameraBlockedByPermissionsPolicy(doc) {
  const policy = doc?.permissionsPolicy || doc?.featurePolicy;
  if (!policy?.allowsFeature) return false;

  try {
    return policy.allowsFeature('camera') === false;
  } catch {
    return false;
  }
}

export function getCameraErrorMessage(
  error,
  { permissionState = 'unknown', blockedByPolicy = false } = {},
) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      if (blockedByPolicy) {
        return 'Camera access is disabled by this page’s permissions policy. Open Meetifyy directly in a secure browser tab and try again.';
      }
      if (permissionState === 'denied') {
        return 'Camera access is blocked for this site. Open your browser’s site settings, set Camera to Allow, then retry.';
      }
      return 'Camera access was not granted. Retry and choose “Allow” when your browser asks.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera could not start. It may already be in use by another application or browser tab.';
    case 'SecurityError':
      return 'The browser blocked camera access for this page. Open Meetifyy directly over HTTPS and check the site’s camera permission.';
    case 'AbortError':
      return 'Camera startup was interrupted. Close any other camera app and retry.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'This camera does not support the requested video settings.';
    case 'TypeError':
      return 'The browser could not start the camera with the requested settings.';
    default:
      return 'Unable to access the camera. Check that a camera is connected and try again.';
  }
}
