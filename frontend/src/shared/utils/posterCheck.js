import { useEffect, useState } from 'react';
import { isBlankFrame } from './blankFrame';

/**
 * Whether a stored video poster is a flat (black) image.
 *
 * Posters uploaded before the generator rejected blank frames are solid
 * black (every post video checked on development was). Shown as the poster,
 * that is a black card in place of the video. The image is probed through a
 * separate CORS request so the <img> or <video> showing it is never put at
 * risk: a probe that cannot read the pixels says "not blank".
 *
 * Results are kept per address without its query string, since a signed URL
 * changes on every signing while the object behind it does not.
 */
const results = new Map();
const MAX_RESULTS = 500;

const cacheKey = (url) => String(url).split('?')[0];

/*
 * Verdicts are kept on the device too. The probe is a second, CORS, request
 * for the image (cached apart from the <img>'s own), so without this every
 * poster was downloaded twice in every session. Each poster is now checked
 * once per device. Only old uploads can be blank (the generator refuses flat
 * frames now), so the list stays small; it is capped all the same.
 */
const STORAGE_KEY = 'meetifyy_poster_verdicts_v1';
let stored = null; // Map<key, 0 | 1>, 1 = blank

function loadStored() {
  if (stored) return stored;
  stored = new Map();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    for (const [k, v] of Object.entries(raw ? JSON.parse(raw) : {})) {
      if (v === 0 || v === 1) stored.set(k, v);
    }
  } catch (_) { /* unavailable or corrupt: start empty */ }
  return stored;
}

function remember(key, blank) {
  const map = loadStored();
  map.delete(key);
  map.set(key, blank ? 1 : 0);
  while (map.size > MAX_RESULTS) map.delete(map.keys().next().value);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch (_) { /* quota or disabled: memory only */ }
}

export function isPosterBlank(url) {
  if (!url || typeof url !== 'string' || url.startsWith('blob:') || url.startsWith('data:')) {
    return Promise.resolve(false);
  }
  const key = cacheKey(url);
  const known = results.get(key);
  if (known) return known;
  const verdict = loadStored().get(key);
  if (verdict !== undefined) {
    const answer = Promise.resolve(verdict === 1);
    results.set(key, answer);
    return answer;
  }
  const probe = new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') { resolve(false); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      const blank = isBlankFrame(img);
      remember(key, blank);
      resolve(blank);
    };
    // Unreadable here (no CORS, offline): not remembered, so a later session
    // may still find out. Never treated as blank.
    img.onerror = () => resolve(false);
    img.src = url;
  });
  results.set(key, probe);
  while (results.size > MAX_RESULTS) results.delete(results.keys().next().value);
  return probe;
}

/** Sign-out: the next account starts with no record of this one's media. */
export function forgetPosterVerdicts() {
  results.clear();
  stored = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* storage disabled */ }
}

/** Calls `onBlank` once if the poster at `url` turns out to be flat. */
export function whenPosterBlank(url, onBlank) {
  void isPosterBlank(url).then((blank) => { if (blank) onBlank(); });
}

/** `url`, or null once it is known to be a blank poster. */
export function useUsablePoster(url) {
  const [blankFor, setBlankFor] = useState(null);
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    void isPosterBlank(url).then((blank) => { if (live && blank) setBlankFor(cacheKey(url)); });
    return () => { live = false; };
  }, [url]);
  if (!url) return null;
  return blankFor === cacheKey(url) ? null : url;
}
