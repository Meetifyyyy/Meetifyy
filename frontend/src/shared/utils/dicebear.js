/**
 * DiceBear Avatar Generation & Optimization Utility for Meetifyy
 *
 * Provides centralized, memoized, and cache-friendly DiceBear avatar URL generation.
 * Supports the 6 approved styles:
 * 1. adventurer
 * 2. adventurer-neutral
 * 3. critters
 * 4. big-smile
 * 5. fun-emoji
 * 6. voxel-art
 *
 * Generated avatars use DiceBear 10.x with curated background colors
 * to provide a complete, finished profile avatar aesthetic.
 */

export const DICEBEAR_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DICEBEAR_BASE_URL) ||
  'https://api.dicebear.com/10.x';

export const SUPPORTED_DICEBEAR_STYLES = [
  'adventurer',
  'adventurer-neutral',
  'critters',
  'big-smile',
  'fun-emoji',
  'voxel-art',
];

export const DICEBEAR_STYLE_LABELS = {
  'adventurer': 'Adventurer',
  'adventurer-neutral': 'Adventurer Neutral',
  'critters': 'Critters',
  'big-smile': 'Big Smile',
  'fun-emoji': 'Fun Emoji',
  'voxel-art': 'Voxel Art',
};

export const DICEBEAR_BG_PALETTE = [
  'b6e3f4', // Soft Sky Blue
  'c0aede', // Soft Lavender
  'd1d4f9', // Periwinkle
  'ffd5dc', // Pastel Rose Pink
  'ffdfbf', // Warm Peach
  'c5e1a5', // Soft Mint / Sage
  'ffe082', // Pastel Honey
  '80deea', // Aqua
  'f48fb1', // Blossom
  'ce93d8', // Lilac
  'a7c5eb', // Ice Blue
  'fce38a', // Golden Sand
];

const SEED_NAMES = [
  'Felix', 'Aneka', 'Jack', 'Precious', 'Luna', 'Milo', 'Leo', 'Zoe', 'Oliver',
  'Maya', 'Jasper', 'Chloe', 'Sam', 'Ruby', 'Nico', 'Kira', 'Finn', 'Cleo',
  'Toby', 'Nova', 'Oscar', 'Bella', 'Charlie', 'Daisy', 'Max', 'Lily', 'Alex',
  'Emma', 'Kai', 'Mia', 'Lucas', 'Stella', 'Ethan', 'Sophie', 'Noah', 'Ava',
  'Aiden', 'Harper', 'Liam', 'Ella', 'Mason', 'Aria', 'Logan', 'Ellie', 'Elijah'
];

/**
 * Fast deterministic string hash for stable user background and avatar assignment.
 */
export function hashString(str) {
  if (!str || typeof str !== 'string') return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// In-memory memoization cache to prevent redundant URL string construction
const dicebearUrlCache = new Map();

/**
 * Centralized DiceBear URL generator.
 * Builds a clean, cache-friendly DiceBear URL with internal memoization.
 */
export function getDiceBearAvatar({ style, seed, backgroundColor, options = {} } = {}) {
  const chosenStyle = SUPPORTED_DICEBEAR_STYLES.includes(style)
    ? style
    : SUPPORTED_DICEBEAR_STYLES[0];

  const chosenSeed = seed ? String(seed).trim() : 'Felix';
  const chosenBg = backgroundColor || DICEBEAR_BG_PALETTE[hashString(chosenSeed) % DICEBEAR_BG_PALETTE.length];

  const cacheKey = `${chosenStyle}:${chosenSeed}:${chosenBg}:${JSON.stringify(options)}`;
  if (dicebearUrlCache.has(cacheKey)) {
    return dicebearUrlCache.get(cacheKey);
  }

  const searchParams = new URLSearchParams();
  searchParams.set('seed', chosenSeed);
  searchParams.set('backgroundColor', chosenBg);

  // Optional extra parameters
  Object.entries(options).forEach(([key, val]) => {
    if (val !== undefined && val !== null) {
      searchParams.set(key, String(val));
    }
  });

  const url = `${DICEBEAR_BASE_URL}/${chosenStyle}/svg?${searchParams.toString()}`;
  dicebearUrlCache.set(cacheKey, url);
  return url;
}

/**
 * Backward compatible alias for buildDicebearUrl
 */
export function buildDicebearUrl({ style, seed, backgroundColor }) {
  return getDiceBearAvatar({ style, seed, backgroundColor });
}

/**
 * Generates a deterministic, stable DiceBear avatar for a specific user.
 * Avoids any random generation so user avatars are stable across renders and sessions.
 */
export function getDeterministicUserAvatar(userOrSeed, preferredStyle = 'adventurer') {
  let seed = 'User';
  if (typeof userOrSeed === 'string' && userOrSeed.trim()) {
    seed = userOrSeed.trim();
  } else if (userOrSeed && typeof userOrSeed === 'object') {
    seed = userOrSeed.id || userOrSeed.email || userOrSeed.username || userOrSeed.name || 'User';
  }

  const style = SUPPORTED_DICEBEAR_STYLES.includes(preferredStyle)
    ? preferredStyle
    : SUPPORTED_DICEBEAR_STYLES[hashString(seed) % SUPPORTED_DICEBEAR_STYLES.length];

  const bg = DICEBEAR_BG_PALETTE[hashString(seed) % DICEBEAR_BG_PALETTE.length];
  return getDiceBearAvatar({ style, seed, backgroundColor: bg });
}

/**
 * Shuffles an array using Fisher-Yates algorithm.
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generates a lightweight initial set of 5 quick avatars for Step 5 quick-bar.
 */
export function generateRandomAvatarSet(count = 5) {
  const shuffledStyles = shuffle(SUPPORTED_DICEBEAR_STYLES);
  const shuffledSeeds = shuffle(SEED_NAMES);
  const shuffledBgs = shuffle(DICEBEAR_BG_PALETTE);

  const avatars = [];
  const usedSeeds = new Set();

  for (let i = 0; i < count; i++) {
    const style = shuffledStyles[i % shuffledStyles.length];

    let seedName = shuffledSeeds[i % shuffledSeeds.length];
    let uniqueSeed = `${seedName}-${Math.random().toString(36).substring(2, 6)}`;
    while (usedSeeds.has(uniqueSeed)) {
      uniqueSeed = `${seedName}-${Math.random().toString(36).substring(2, 6)}`;
    }
    usedSeeds.add(uniqueSeed);

    const bg = shuffledBgs[i % shuffledBgs.length];
    const url = getDiceBearAvatar({ style, seed: uniqueSeed, backgroundColor: bg });

    avatars.push({
      id: `avatar-${i}-${uniqueSeed}`,
      style,
      styleLabel: DICEBEAR_STYLE_LABELS[style] || style,
      seed: uniqueSeed,
      backgroundColor: bg,
      url,
    });
  }

  return avatars;
}

/**
 * Generates avatars scoped strictly to a single category/style on demand.
 * Prevents loading avatars from other unviewed categories.
 */
export function generateCategoryAvatars(style, count = 20) {
  const targetStyle = SUPPORTED_DICEBEAR_STYLES.includes(style)
    ? style
    : SUPPORTED_DICEBEAR_STYLES[0];

  const shuffledSeeds = shuffle(SEED_NAMES);
  const shuffledBgs = shuffle(DICEBEAR_BG_PALETTE);
  const avatars = [];

  for (let i = 0; i < count; i++) {
    const baseSeed = shuffledSeeds[i % shuffledSeeds.length];
    const uniqueSeed = `${baseSeed}-${targetStyle.substring(0, 3)}-${Math.random().toString(36).substring(2, 6)}`;
    const bg = shuffledBgs[i % shuffledBgs.length];
    const url = getDiceBearAvatar({ style: targetStyle, seed: uniqueSeed, backgroundColor: bg });

    avatars.push({
      id: `cat-${targetStyle}-${i}-${uniqueSeed}`,
      style: targetStyle,
      styleLabel: DICEBEAR_STYLE_LABELS[targetStyle] || targetStyle,
      seed: uniqueSeed,
      backgroundColor: bg,
      url,
    });
  }

  return avatars;
}

/**
 * Generates an initial mixed batch of avatars covering all 6 approved styles
 * for the "All" tab view in the Avatar Picker Modal.
 * Default 8 per style = 48 mixed avatars.
 */
export function generateAvatarCollection(countPerStyle = 8) {
  const collection = [];
  const shuffledSeeds = shuffle(SEED_NAMES);
  const shuffledBgs = shuffle(DICEBEAR_BG_PALETTE);

  let seedIndex = 0;
  let bgIndex = 0;

  for (const style of SUPPORTED_DICEBEAR_STYLES) {
    for (let i = 0; i < countPerStyle; i++) {
      const baseSeed = shuffledSeeds[seedIndex % shuffledSeeds.length];
      seedIndex++;
      const uniqueSeed = `${baseSeed}-${style.substring(0, 3)}-${Math.random().toString(36).substring(2, 6)}`;
      const bg = shuffledBgs[bgIndex % shuffledBgs.length];
      bgIndex++;

      const url = getDiceBearAvatar({ style, seed: uniqueSeed, backgroundColor: bg });

      collection.push({
        id: `all-${style}-${i}-${uniqueSeed}`,
        style,
        styleLabel: DICEBEAR_STYLE_LABELS[style] || style,
        seed: uniqueSeed,
        backgroundColor: bg,
        url,
      });
    }
  }

  return shuffle(collection);
}
