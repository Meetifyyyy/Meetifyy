/**
 * The Instagram Story flow as one state machine, so the panel only renders.
 *
 *   preparing ──▶ ready ──share()──▶ opening ──▶ shared
 *       │           │                   │
 *       ▼           ▼                   ▼
 *     error     unavailable           error ──retry()──▶ preparing | ready
 *
 * `preparing` renders the card and asks the device whether Instagram can take
 * it, in parallel. The card rendered here is the exact PNG that is sent —
 * the preview is an object URL of the same bytes — so what the person sees is
 * what Instagram receives.
 *
 * Nothing is left spinning: every await is followed by a transition, a
 * failure is always a visible `error`, and a result arriving after the panel
 * closed is discarded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '@config';
import { buildStoryModel, STORY_BACKGROUND } from '@shared/lib/share/story/model';
import { ensureFonts, renderStoryCard } from '@shared/lib/share/story/renderer';
import { prefetchStoryImages } from '@shared/lib/share/story/images';
import { createCapacitorInstagramStories } from '../../platform/capacitor/instagramStories';
import { fetchImageNatively } from '../../platform/capacitor/nativeImageFetch';

let service = null;
function instagram() {
  service ??= createCapacitorInstagramStories({ appId: config.app.facebookAppId });
  return service;
}

const MESSAGES = {
  not_installed: 'Instagram isn’t installed on this phone. Install it, then try again.',
  INSTAGRAM_NOT_INSTALLED: 'Instagram isn’t installed on this phone. Install it, then try again.',
  not_configured: 'Instagram Stories isn’t set up in this version of Meetifyy.',
  MISSING_APP_ID: 'Instagram Stories isn’t set up in this version of Meetifyy.',
  unsupported_platform: 'Sharing to Instagram Stories isn’t available on this device yet.',
  UNSUPPORTED_PLATFORM: 'Sharing to Instagram Stories isn’t available on this device yet.',
  RENDER_FAILED: 'We couldn’t create the story card.',
  INVALID_ASSET: 'We couldn’t create the story card.',
  FILE_ERROR: 'The story card couldn’t be handed to Instagram.',
  LAUNCH_FAILED: 'Instagram couldn’t be opened.',
  BRIDGE_FAILED: 'Instagram couldn’t be opened.',
};

export function storyMessage(code) {
  return MESSAGES[code] || 'Something went wrong while preparing your story.';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Cards already drawn, newest last. Reopening the panel for the same content
 * within a few minutes shows the finished card at once instead of redrawing
 * and re-encoding it. The key is the whole model, so any change in what the
 * card says (a new like count, an edited bio) draws a fresh one.
 */
const CARD_TTL_MS = 5 * 60 * 1000;
const CARD_CACHE_MAX = 3;
const cardCache = new Map();

function cachedCard(key) {
  const hit = cardCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CARD_TTL_MS) {
    cardCache.delete(key);
    return null;
  }
  return hit;
}

function rememberCard(key, entry) {
  cardCache.set(key, { ...entry, at: Date.now() });
  while (cardCache.size > CARD_CACHE_MAX) cardCache.delete(cardCache.keys().next().value);
}

/**
 * Called while the share sheet is still open: loads the typeface and starts
 * the picture downloads, so by the time the panel opens only drawing and
 * encoding are left. Does no drawing, so it is cheap to run speculatively.
 */
export function warmInstagramStory(content) {
  try {
    const model = buildStoryModel(content);
    if (!model) return;
    void ensureFonts();
    prefetchStoryImages(model.imageUrls, fetchImageNatively);
  } catch {
    /* a warm-up never surfaces an error */
  }
}

export function useInstagramStory(content) {
  const [state, setState] = useState({ phase: 'preparing' });
  const card = useRef(null);
  const generation = useRef(0);

  const prepare = useCallback(async () => {
    const run = ++generation.current;
    const current = () => run === generation.current;
    setState({ phase: 'preparing' });

    try {
      const model = buildStoryModel(content);
      if (!model) throw Object.assign(new Error('nothing to share'), { code: 'RENDER_FAILED' });

      const key = JSON.stringify(model);
      const [availability, rendered] = await Promise.all([
        instagram().availability(),
        cachedCard(key) ||
          // Native download: the media bucket sends no CORS headers.
          renderStoryCard(model, { fetchImage: fetchImageNatively }),
      ]);
      if (!current()) return;

      // The preview shows as soon as the PNG exists. The base64 the native
      // bridge needs is made alongside and only awaited when "Share" is
      // pressed, so it never delays the card appearing.
      const base64 = rendered.base64 || blobToBase64(rendered.blob);
      base64.catch(() => {});
      rememberCard(key, { blob: rendered.blob, width: rendered.width, height: rendered.height, base64 });

      if (card.current) URL.revokeObjectURL(card.current.previewUrl);
      card.current = {
        previewUrl: URL.createObjectURL(rendered.blob),
        base64,
        width: rendered.width,
        height: rendered.height,
      };

      setState(
        availability.available
          ? { phase: 'ready' }
          : { phase: 'unavailable', code: availability.reason },
      );
    } catch (error) {
      if (!current()) return;
      setState({ phase: 'error', code: error?.code || 'RENDER_FAILED', retry: 'prepare' });
    }
  }, [content]);

  useEffect(() => {
    prepare();
    return () => {
      // Discard anything still in flight, and free the preview.
      generation.current += 1;
      if (card.current) URL.revokeObjectURL(card.current.previewUrl);
      card.current = null;
    };
  }, [prepare]);

  const share = useCallback(async () => {
    const asset = card.current;
    if (!asset) return;
    const run = generation.current;
    setState({ phase: 'opening' });
    try {
      await instagram().share({
        stickerPngBase64: await asset.base64,
        backgroundTopColor: STORY_BACKGROUND.top,
        backgroundBottomColor: STORY_BACKGROUND.bottom,
      });
      if (run === generation.current) setState({ phase: 'shared' });
    } catch (error) {
      if (run !== generation.current) return;
      const code = error?.code || 'BRIDGE_FAILED';
      setState(
        code === 'INSTAGRAM_NOT_INSTALLED' || code === 'MISSING_APP_ID'
          ? { phase: 'unavailable', code }
          : { phase: 'error', code, retry: 'share' },
      );
    }
  }, []);

  const retry = useCallback(() => {
    if (state.retry === 'share' && card.current) setState({ phase: 'ready' });
    else prepare();
  }, [prepare, state.retry]);

  return { state, card: card.current, share, retry };
}
