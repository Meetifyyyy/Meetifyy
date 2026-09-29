import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Instagram Stories through the app's own native plugin — an
 * `InstagramStories` contract (platform/contracts.ts).
 *
 * The Android half is `InstagramStoriesPlugin.java`: it writes the card into
 * the app cache, exposes it to Instagram through the FileProvider, and fires
 * `com.instagram.share.ADD_TO_STORY` with the Meta App ID Instagram requires.
 * iOS has no implementation yet and reports `unsupported_platform` rather
 * than pretending.
 *
 * Imported only from `src/mobile/`, lazily, so `registerPlugin` never runs in
 * the website's bundle.
 */
const InstagramStoriesNative = registerPlugin('InstagramStories');

/** Native rejections carry `code`; anything else is a bridge failure. */
function toShareError(error) {
  const wrapped = new Error(error?.message || 'Instagram could not be opened');
  wrapped.code = typeof error?.code === 'string' && error.code ? error.code : 'BRIDGE_FAILED';
  return wrapped;
}

export function createCapacitorInstagramStories({ appId }) {
  const supported = Capacitor.getPlatform() === 'android';

  return {
    async availability() {
      if (!supported) return { available: false, reason: 'unsupported_platform' };
      if (!appId) return { available: false, reason: 'not_configured' };
      try {
        const result = await InstagramStoriesNative.isAvailable();
        return result?.available
          ? { available: true }
          : { available: false, reason: 'not_installed' };
      } catch {
        // The probe itself failing is not evidence Instagram is missing; the
        // share call reports the real reason if it is.
        return { available: true };
      }
    },

    async share({ stickerPngBase64, backgroundTopColor, backgroundBottomColor }) {
      if (!supported) {
        const error = new Error('Instagram Stories is not supported on this device yet');
        error.code = 'UNSUPPORTED_PLATFORM';
        throw error;
      }
      try {
        await InstagramStoriesNative.share({
          appId,
          stickerPngBase64,
          backgroundTopColor,
          backgroundBottomColor,
        });
      } catch (error) {
        throw toShareError(error);
      }
    },
  };
}
