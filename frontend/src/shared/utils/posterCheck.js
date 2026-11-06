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
 *
 * A "fine" verdict is final: a real poster never turns black. A "blank" one
 * is not: scripts/backfill-media-thumbnails.ts replaces black posters in
 * place, and a device that kept "blank" forever hid the repaired poster for
 * good. On the installed app that left an empty tile, since its WebView paints
 * no first frame for a `preload="metadata"` video. So a blank verdict holds
 * for BLANK_TTL_MS, then the poster is fetched again past the year-long HTTP
 * cache and probed again. Verdicts saved before this (the value 1) carry no
 * time and count as expired.
 */
const STORAGE_KEY = 'meetifyy_poster_verdicts_v1';
const BLANK_TTL_MS = 24 * 60 * 60 * 1000;
let stored = null; // Map<key, 0 | checkedAt>: 0 = fine, a time = blank, checked then

function loadStored() {
  if (stored) return stored;
  stored = new Map();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    for (const [k, v] of Object.entries(raw ? JSON.parse(raw) : {})) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) stored.set(k, v);
    }
  } catch (_) { /* unavailable or corrupt: start empty */ }
  return stored;
}

function persist(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch (_) { /* quota or disabled: memory only */ }
}

function remember(key, blank) {
  const map = loadStored();
  map.delete(key);
  map.set(key, blank ? Date.now() : 0);
  while (map.size > MAX_RESULTS) map.delete(map.keys().next().value);
  persist(map);
}

/** A stored blank verdict still within its time (1 = legacy, so expired). */
const blankStillHolds = (checkedAt) => checkedAt > 1 && Date.now() - checkedAt < BLANK_TTL_MS;

/** Replace the HTTP-cached copy of `url` with the current object. */
function refetchPastCache(url) {
  if (typeof fetch !== 'function' || !/^https?:\/\//.test(url)) return Promise.resolve();
  return fetch(url, { cache: 'reload', mode: 'no-cors', credentials: 'omit' })
    .then(() => undefined, () => undefined);
}

export function isPosterBlank(url) {
  if (!url || typeof url !== 'string' || url.startsWith('blob:') || url.startsWith('data:')) {
    return Promise.resolve(false);
  }
  const key = cacheKey(url);
  const known = results.get(key);
  if (known) return known;
  const verdict = loadStored().get(key);
  if (verdict === 0 || (verdict !== undefined && blankStillHolds(verdict))) {
    const answer = Promise.resolve(verdict !== 0);
    results.set(key, answer);
    return answer;
  }
  // Never checked, or found blank long enough ago that it may have been
  // regenerated since: in that case the cached copy is the old black one, so
  // refresh it first (the <img> then gets the new one too).
  const ready = verdict === undefined ? Promise.resolve() : refetchPastCache(url);
  const probe = ready.then(() => new Promise((resolve) => {
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
  }));
  results.set(key, probe);
  while (results.size > MAX_RESULTS) results.delete(results.keys().next().value);
  return probe;
}

/**
 * Clear cached data: re-fetch every poster this device found blank, bypassing
 * the browser's HTTP cache, then forget the verdicts.
 *
 * Uploads are cached for a year as immutable, so a black poster that has since
 * been regenerated (scripts/backfill-media-thumbnails.ts) would otherwise stay
 * black on this device for as long as the cached copy lived. A `reload` fetch
 * replaces that cached copy with the current one. Only public addresses: a
 * private one was stored without its signature and cannot be fetched again
 * (its next signed URL is a new cache entry anyway).
 */
export async function refreshBlankPosters() {
  const map = loadStored();
  const blank = [...map].filter(([k, v]) => v !== 0 && /^https?:\/\//.test(k)).map(([k]) => k);
  if (typeof fetch === 'function') {
    await Promise.allSettled(
      blank.map((url) => fetch(url, { cache: 'reload', mode: 'no-cors', credentials: 'omit' })),
    );
  }
  forgetPosterVerdicts();
  return true;
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
