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


/** Session copies of posters the probe downloaded fresh: key -> blob: URL. */
const fresh = new Map();
const MAX_FRESH = 150;

function rememberFresh(key, blobUrl) {
  const old = fresh.get(key);
  if (old && old !== blobUrl) URL.revokeObjectURL(old);
  fresh.delete(key);
  fresh.set(key, blobUrl);
  // Evicted ones are not revoked: an element may still be showing them.
  while (fresh.size > MAX_FRESH) fresh.delete(fresh.keys().next().value);
}

/** The probe's fresh copy of the poster at `url` this session, if it has one. */
export function freshPosterUrl(url) {
  return url ? fresh.get(cacheKey(url)) || null : null;
}

async function decode(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const img = new Image();
  const objectUrl = URL.createObjectURL(blob);
  try {
    img.src = objectUrl;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** `{ blank, blobUrl }` from the current file at `url`, or null if unreadable. */
async function probeFresh(url) {
  if (typeof fetch !== 'function' || typeof document === 'undefined') return null;
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'reload', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const picture = await decode(blob);
    const blank = isBlankFrame(picture);
    picture.close?.();
    return { blank, blobUrl: URL.createObjectURL(blob) };
  } catch (_) {
    return null;
  }
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
  /*
   * The probe downloads the poster past the HTTP cache (`reload`) and judges
   * those bytes.
   *
   * It used to be a CORS <img> of the same address, served from the cache.
   * In the installed app that cached copy was stored by the plain <img> that
   * displays the poster, without CORS headers, so the CORS probe of it failed
   * every time; a failure counts as "fine", so a black (or transparent)
   * poster saved before the backfill replaced it stayed on screen for the
   * year it is cached for, and was never even recorded as blank. A reload
   * both reads the current file and overwrites that stale cached copy, so the
   * next launch's <img> gets the current one too. For this session, the
   * fresh bytes are kept as a blob: URL the caller can show at once
   * (`freshPosterUrl`, `onFresh`).
   */
  const probe = probeFresh(url).then((result) => {
    // Unreadable (offline, refused): not remembered, so a later session may
    // still find out. Never treated as blank.
    if (!result) return false;
    remember(key, result.blank);
    if (!result.blank && result.blobUrl) rememberFresh(key, result.blobUrl);
    else if (result.blobUrl) URL.revokeObjectURL(result.blobUrl);
    return result.blank;
  });
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
  for (const blobUrl of fresh.values()) URL.revokeObjectURL(blobUrl);
  fresh.clear();
  stored = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* storage disabled */ }
}

/**
 * Calls `onBlank` once if the poster at `url` turns out to be flat, or
 * `onFresh(blobUrl)` with the probe's fresh copy when it is fine, so a stale
 * cached copy on screen can be swapped for the current file at once.
 */
export function whenPosterBlank(url, onBlank, onFresh) {
  void isPosterBlank(url).then((blank) => {
    if (blank) { onBlank(); return; }
    const freshUrl = onFresh ? freshPosterUrl(url) : null;
    if (freshUrl) onFresh(freshUrl);
  });
}

/**
 * `url`, or null once it is known to be a blank poster, or the probe's fresh
 * copy of it this session (so a stale cached image is replaced at once).
 */
export function useUsablePoster(url) {
  const [checked, setChecked] = useState(null); // { key, blank, freshUrl }
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    void isPosterBlank(url).then((blank) => {
      if (live) setChecked({ key: cacheKey(url), blank, freshUrl: blank ? null : freshPosterUrl(url) });
    });
    return () => { live = false; };
  }, [url]);
  if (!url) return null;
  if (!checked || checked.key !== cacheKey(url)) return url;
  if (checked.blank) return null;
  return checked.freshUrl || url;
}
