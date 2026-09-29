/**
 * Draws a story model (./model.js) into a card image.
 *
 * The card is Instagram's STICKER layer: a transparent PNG whose only opaque
 * pixels are the card itself, so Instagram lets the person move, resize and
 * rotate it over the Story background. Each layout is a function that, given
 * a 2D context, returns its height and a `paint` step — measured first, then
 * drawn on a canvas of exactly that height, so nothing is ever cropped and no
 * space is reserved for content a card does not have.
 *
 * The same image is what the share sheet previews and what Instagram
 * receives; there is no second rendering path to drift from this one.
 */
import { SHARE_KIND } from '../content';
import {
  FONT_FAMILY,
  cssGradientFill,
  drawCircleImage,
  drawImageCover,
  ellipsize,
  fillRoundRect,
  font,
  roundRectPath,
  wrapLines,
} from './draw';
import { collageFor } from './model';
import { loadStoryImages, releaseStoryImages } from './images';

const W = 1000;
const PAD = 64;
const INNER = W - PAD * 2;
const CARD_RADIUS = 72;
/** Output pixels per layout unit: a 1500px-wide sticker. */
const OUTPUT_SCALE = 1.5;

const INK = '#0F172A';
const MUTED = '#64748B';
const BRAND = '#2563EB';
const SURFACE = '#FFFFFF';
const SOFT = '#F1F5F9';

// ── Footer band ──────────────────────────────────────────────────────────

/**
 * The card's type and spacing scale, in layout units (1000 = card width).
 * Every text size and gap on a card comes from here, so the header, the body
 * and the footer stay in proportion to each other.
 */
const NAME_SIZE = 40;
const HANDLE_SIZE = 32;
const BODY_SIZE = 40;
const META_SIZE = 30;
const GAP = 32;
/** Height of the footer row ("5 likes · 2 comments" … site address). */
const STAT_ROW = 44;
/** A post card's edge padding: the same on all four sides. */
const EDGE = 36;
/** Space between a post's author row and its content. */
const HEADER_GAP = 14;
/** Space between a post's content and its reactions row. */
const FOOTER_GAP = 44;

/** Placeholder fill for a missing activity cover. */
const BAND_FILL = '#EEF3FF';

/** `meetifyy.app` — the host of the link being shared, printed not linked. */
function siteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'meetifyy.app';
  }
}

/**
 * The footer row every card ends in, centred on `cy`: the post's reaction
 * counts on the left as words (posts only) and the site address on the right in the
 * muted meta size — a signature, not a banner.
 */
function paintFooter(ctx, url, cy, { stats = null, left = PAD, right = W - PAD } = {}) {
  // One text baseline and one type style for the whole row: the counts and
  // the site address read as a single line. The baseline is set so the
  // figures (cap height ≈ 0.72em in Inter) centre on `cy`.
  const baseline = cy + Math.round(META_SIZE * 0.36);
  if (stats) paintStats(ctx, stats, left, baseline);
  ctx.font = font(500, META_SIZE);
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(siteLabel(url), right, baseline);
  ctx.textAlign = 'left';
}

/** "5 likes · 2 comments", in exactly the site address's type. */
function paintStats(ctx, stats, x, baseline) {
  ctx.font = font(500, META_SIZE);
  ctx.fillStyle = MUTED;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(stats, x, baseline);
}

/** Initial-on-colour, the same fallback the app shows for a missing avatar. */
function paintAvatar(ctx, image, cx, cy, d, name, color = BRAND) {
  if (image) {
    drawCircleImage(ctx, image, cx, cy, d);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = color || BRAND;
  ctx.fill();
  ctx.font = font(700, Math.round(d * 0.42));
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((String(name || '?').trim().charAt(0) || '?').toUpperCase(), cx, cy + d * 0.02);
  ctx.restore();
}

// ── Post ─────────────────────────────────────────────────────────────────

function postLayout(ctx, model, images) {
  const steps = [];
  let y = EDGE;

  // Header: avatar, name, @username — compact, like the feed's post header.
  // Everything below starts on the avatar's left edge: one left line for the
  // whole card, the same edge padding on every side.
  const avatarD = 96;
  const avatarX = EDGE;
  const x0 = EDGE;
  const w = W - EDGE * 2;
  const headerY = y;
  const textX = avatarX + avatarD + 24;
  const textW = W - EDGE - textX;
  steps.push(() => {
    paintAvatar(ctx, images.get(model.author.avatar), avatarX + avatarD / 2, headerY + avatarD / 2, avatarD, model.author.name);
    ctx.fillStyle = INK;
    ctx.font = font(700, NAME_SIZE);
    ctx.textBaseline = 'alphabetic';
    const hasHandle = Boolean(model.author.username);
    ctx.fillText(ellipsize(ctx, model.author.name, textW), textX, headerY + (hasHandle ? 44 : 62));
    if (hasHandle) {
      ctx.fillStyle = MUTED;
      ctx.font = font(400, HANDLE_SIZE);
      ctx.fillText(ellipsize(ctx, `@${model.author.username}`, textW), textX, headerY + 84);
    }
  });
  // Tighter than GAP: the first line of text brings its own ascent space
  // above the letters, so a full GAP here read as a hole under the author.
  y += avatarD + HEADER_GAP;
  // An image or poll straight after the header has no ascent to lean on.
  if (!model.text) y += 10;

  // Images that actually loaded decide the collage; a broken one is dropped
  // rather than drawn as a hole.
  const loaded = model.collage.images.filter((url) => images.get(url));
  const collage = collageFor(loaded);
  collage.more += model.collage.more;
  const hasMedia = Boolean(collage.layout);

  // Text: one reading size for every post, in proportion to the header.
  if (model.text) {
    const lineHeight = Math.round(BODY_SIZE * 1.45);
    ctx.font = font(400, BODY_SIZE);
    const maxLines = hasMedia || model.poll ? 5 : 14;
    const lines = wrapLines(ctx, model.text, w, maxLines);
    const textY = y;
    steps.push(() => {
      ctx.font = font(400, BODY_SIZE);
      ctx.fillStyle = INK;
      ctx.textBaseline = 'alphabetic';
      lines.forEach((line, i) => ctx.fillText(line, x0, textY + BODY_SIZE + i * lineHeight));
    });
    y += BODY_SIZE + (lines.length - 1) * lineHeight + GAP;
  }

  // Media above the poll, as the post itself lays them out.
  if (hasMedia) y = collageBlock(ctx, collage, images, y, steps, x0, w) + GAP;
  if (model.poll) y = pollBlock(ctx, model.poll, y, steps, x0, w) + GAP;

  // Footer row: reactions on the left, the site on the right, then the same
  // edge padding the card has on every other side.
  // `y` already carries one GAP after the last block; the row sits a little
  // further off (FOOTER_GAP in all) so it reads as the card's footer rather
  // than as one more block of content.
  const rowTop = y - GAP + FOOTER_GAP;
  const cy = rowTop + STAT_ROW / 2;
  steps.push(() => paintFooter(ctx, model.url, cy, { stats: model.stats, left: x0, right: W - EDGE }));
  y = rowTop + STAT_ROW + EDGE;

  return { height: y, paint: () => steps.forEach((step) => step()) };
}

function pollBlock(ctx, poll, startY, steps, x0 = PAD, w = INNER) {
  let y = startY;

  if (poll.question) {
    ctx.font = font(600, BODY_SIZE);
    const lines = wrapLines(ctx, poll.question, w, 3);
    const qy = y;
    const lh = Math.round(BODY_SIZE * 1.4);
    steps.push(() => {
      ctx.font = font(600, BODY_SIZE);
      ctx.fillStyle = INK;
      lines.forEach((line, i) => ctx.fillText(line, x0, qy + BODY_SIZE + i * lh));
    });
    y += BODY_SIZE + (lines.length - 1) * lh + 24;
  }

  const rowH = 92;
  const gap = 16;
  const pctW = poll.options.some((o) => o.pct !== null) ? 120 : 0;
  poll.options.forEach((option) => {
    const ry = y;
    steps.push(() => {
      fillRoundRect(ctx, x0, ry, w, rowH, 30, SOFT);
      if (option.pct !== null && option.pct > 0) {
        ctx.save();
        roundRectPath(ctx, x0, ry, w, rowH, 30);
        ctx.clip();
        ctx.fillStyle = option.leading ? '#BFDBFE' : '#DBEAFE';
        ctx.fillRect(x0, ry, (w * option.pct) / 100, rowH);
        ctx.restore();
      }
      ctx.font = font(option.leading ? 700 : 600, 34);
      ctx.fillStyle = INK;
      ctx.textBaseline = 'middle';
      ctx.fillText(ellipsize(ctx, option.text, w - 56 - pctW), x0 + 28, ry + rowH / 2 + 2);
      if (option.pct !== null) {
        ctx.textAlign = 'right';
        ctx.fillText(`${option.pct}%`, x0 + w - 28, ry + rowH / 2 + 2);
        ctx.textAlign = 'left';
      }
      ctx.textBaseline = 'alphabetic';
    });
    y += rowH + gap;
  });

  const summary = [
    poll.hiddenOptions ? `+${poll.hiddenOptions} more ${poll.hiddenOptions === 1 ? 'option' : 'options'}` : '',
    poll.votesLabel,
  ].filter(Boolean).join('  ·  ');
  const sy = y;
  steps.push(() => {
    ctx.font = font(500, META_SIZE - 2);
    ctx.fillStyle = MUTED;
    ctx.fillText(summary, x0, sy + 30);
  });
  return y + 40;
}

function collageBlock(ctx, collage, images, startY, steps, x0 = PAD, w = INNER) {
  const gap = 12;
  const r = 44;
  const tiles = [];
  let height;

  if (collage.layout === 'single') {
    const img = images.get(collage.images[0]);
    // Aspect preserved between 16:9 landscape and 4:5 portrait; beyond that
    // the centre is kept, as every feed does.
    const ratio = Math.min(1.25, Math.max(0.5625, img.height / img.width));
    height = Math.round(w * ratio);
    tiles.push([collage.images[0], x0, startY, w, height]);
  } else if (collage.layout === 'pair') {
    const tw = (w - gap) / 2;
    height = 540;
    tiles.push([collage.images[0], x0, startY, tw, height]);
    tiles.push([collage.images[1], x0 + tw + gap, startY, tw, height]);
  } else if (collage.layout === 'feature') {
    const lw = Math.round((w - gap) * 0.6);
    const rw = w - gap - lw;
    height = 640;
    const rh = (height - gap) / 2;
    tiles.push([collage.images[0], x0, startY, lw, height]);
    tiles.push([collage.images[1], x0 + lw + gap, startY, rw, rh]);
    tiles.push([collage.images[2], x0 + lw + gap, startY + rh + gap, rw, rh]);
  } else {
    const tw = (w - gap) / 2;
    const th = 400;
    height = th * 2 + gap;
    collage.images.forEach((url, i) => {
      tiles.push([url, x0 + (i % 2) * (tw + gap), startY + Math.floor(i / 2) * (th + gap), tw, th]);
    });
  }

  steps.push(() => {
    tiles.forEach(([url, x, y, w, h], i) => {
      drawImageCover(ctx, images.get(url), x, y, w, h, r);
      const last = i === tiles.length - 1;
      if (last && collage.more > 0) {
        fillRoundRect(ctx, x, y, w, h, r, 'rgba(15, 23, 42, 0.55)');
        ctx.font = font(700, 76);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${collage.more}`, x + w / 2, y + h / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    });
  });
  return startY + height;
}

// ── Profile & community ──────────────────────────────────────────────────

function identityLayout(ctx, model, images) {
  const steps = [];
  // Same spacing system as the post card: EDGE on the sides and bottom, the
  // avatar on the left edge, a compact identity beside it.
  const coverH = 300;
  const avatarD = 168;
  const ring = 10;
  const avatarCx = EDGE + avatarD / 2;
  const avatarCy = coverH;

  steps.push(() => {
    // Cover, clipped to the card's top corners.
    ctx.save();
    roundRectPath(ctx, 0, 0, W, coverH, { tl: CARD_RADIUS, tr: CARD_RADIUS, br: 0, bl: 0 });
    ctx.clip();
    const cover = model.cover;
    const coverImage = cover.type === 'image' ? images.get(cover.url) : null;
    if (coverImage) {
      drawImageCover(ctx, coverImage, 0, 0, W, coverH, 0);
    } else {
      const fill =
        (cover.type === 'gradient' && cssGradientFill(ctx, cover.value, 0, 0, W, coverH)) ||
        '#E8EDF5';
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, W, coverH);
    }
    ctx.restore();

    // Avatar on a ring of card colour, half over the cover.
    ctx.beginPath();
    ctx.arc(avatarCx, avatarCy, avatarD / 2 + ring, 0, Math.PI * 2);
    ctx.fillStyle = SURFACE;
    ctx.fill();
    paintAvatar(ctx, images.get(model.avatar), avatarCx, avatarCy, avatarD, model.name, model.avatarColor);
  });

  // Name and subtitle beside the avatar, below the cover edge. A long name
  // steps down a size and may take two lines before it is ellipsised.
  const textX = EDGE + avatarD + ring + 24;
  const textW = W - EDGE - textX;
  let nameSize = 44;
  ctx.font = font(700, nameSize);
  if (ctx.measureText(model.name).width > textW) nameSize = 38;
  ctx.font = font(700, nameSize);
  const nameLines = wrapLines(ctx, model.name, textW, 2);
  const nameLH = Math.round(nameSize * 1.2);
  const textTop = coverH + 26;
  steps.push(() => {
    ctx.font = font(700, nameSize);
    ctx.fillStyle = INK;
    nameLines.forEach((line, i) => ctx.fillText(line, textX, textTop + nameSize + i * nameLH));
    if (model.subtitle) {
      ctx.font = font(400, HANDLE_SIZE);
      ctx.fillStyle = MUTED;
      ctx.fillText(
        ellipsize(ctx, model.subtitle, textW),
        textX,
        textTop + nameSize + (nameLines.length - 1) * nameLH + 44,
      );
    }
  });
  const textBottom = textTop + nameSize + (nameLines.length - 1) * nameLH + (model.subtitle ? 54 : 10);
  let y = Math.max(avatarCy + avatarD / 2 + ring, textBottom) + 28;

  if (model.tags.length) y = tagsBlock(ctx, model.tags, y, steps) + 28;

  // Footer row, then the card's edge padding.
  const cy = y + STAT_ROW / 2 - 6;
  steps.push(() => paintFooter(ctx, model.url, cy, { left: EDGE, right: W - EDGE }));
  y = cy + STAT_ROW / 2 + EDGE;

  return { height: y, paint: () => steps.forEach((step) => step()) };
}

/** Width a tag row may use. */
const TAG_W = W - EDGE * 2;

/** Tag pills, wrapped over at most three rows; what does not fit is "+N". */
function tagsBlock(ctx, tags, startY, steps) {
  const h = 60;
  const gap = 12;
  const padX = 24;
  const maxRows = 3;
  ctx.font = font(600, 28);

  const widthOf = (label) => Math.min(TAG_W, ctx.measureText(label).width + padX * 2);
  const placed = [];
  let x = EDGE;
  let row = 0;
  for (let i = 0; i < tags.length; i += 1) {
    const w = widthOf(tags[i]);
    if (x + w > W - EDGE) {
      row += 1;
      x = EDGE;
    }
    if (row >= maxRows) break;
    placed.push({ label: tags[i], x, row, w });
    x += w + gap;
  }

  // Whatever was left out is counted on the last row, replacing pills from
  // the end until the counter fits.
  let hidden = tags.length - placed.length;
  if (hidden > 0) {
    for (;;) {
      const last = placed[placed.length - 1];
      const moreW = widthOf(`+${hidden}`);
      const endX = last ? last.x + last.w + gap : EDGE;
      if (!last || endX + moreW <= W - EDGE) {
        placed.push({ label: `+${hidden}`, x: last ? endX : EDGE, row: last ? last.row : 0, w: moreW, more: true });
        break;
      }
      placed.pop();
      hidden += 1;
    }
  }

  steps.push(() => {
    ctx.font = font(600, 28);
    ctx.textBaseline = 'middle';
    placed.forEach((pill) => {
      const py = startY + pill.row * (h + gap);
      fillRoundRect(ctx, pill.x, py, pill.w, h, h / 2, pill.more ? SOFT : '#EFF6FF');
      ctx.fillStyle = pill.more ? MUTED : '#1D4ED8';
      ctx.fillText(ellipsize(ctx, pill.label, pill.w - padX * 2), pill.x + padX, py + h / 2 + 1);
    });
    ctx.textBaseline = 'alphabetic';
  });
  const rows = placed.length ? Math.max(...placed.map((p) => p.row)) + 1 : 0;
  return startY + rows * h + Math.max(0, rows - 1) * gap;
}

// ── Activity ─────────────────────────────────────────────────────────────

/**
 * The chat's activity card (`ActivityPreviewCard` and its stylesheet),
 * scaled from its 270 CSS px to the card width — same proportions, colours
 * and type — with the footer row added beneath, since the card now travels
 * outside the app.
 */
function activityLayout(ctx, model, images) {
  const S = W / 270;
  const px = (v) => Math.round(v * S);
  const margin = px(8);
  const coverW = W - margin * 2;
  const coverH = px(230);
  const rowTop = margin + coverH;
  const rowH = px(84);
  const radius = px(22);
  const footerH = STAT_ROW + px(8);
  const height = rowTop + rowH + footerH;

  const paint = () => {
    // The card surface and its hairline border.
    fillRoundRect(ctx, 0, 0, W, height, radius, '#F2F2F5');
    ctx.save();
    roundRectPath(ctx, 1.5, 1.5, W - 3, height - 3, radius);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    const cover = images.get(model.image);
    if (cover) drawImageCover(ctx, cover, margin, margin, coverW, coverH, px(16));
    else fillRoundRect(ctx, margin, margin, coverW, coverH, px(16), BAND_FILL);

    // Calendar tile: red month band over a light day face.
    const calW = px(44);
    const calH = px(46);
    const calX = px(12);
    const calY = rowTop + (rowH - calH) / 2;
    ctx.save();
    roundRectPath(ctx, calX, calY, calW, calH, px(12));
    ctx.clip();
    const face = ctx.createLinearGradient(calX, calY, calX + calW, calY + calH);
    face.addColorStop(0, '#FFFFFF');
    face.addColorStop(0.35, '#F8FAFC');
    face.addColorStop(0.7, '#E2E8F0');
    face.addColorStop(1, '#CBD5E1');
    ctx.fillStyle = face;
    ctx.fillRect(calX, calY, calW, calH);
    const bandH = px(14);
    const band = ctx.createLinearGradient(calX, calY, calX + calW, calY + bandH);
    band.addColorStop(0, '#EF4444');
    band.addColorStop(1, '#E11D48');
    ctx.fillStyle = band;
    ctx.fillRect(calX, calY, calW, bandH);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = font(700, px(9.3));
    ctx.fillText(model.calendar.month, calX + calW / 2, calY + bandH / 2 + px(1));
    ctx.fillStyle = INK;
    ctx.font = font(800, px(17.3));
    ctx.fillText(model.calendar.day, calX + calW / 2, calY + bandH + (calH - bandH) / 2 + px(1));
    ctx.textAlign = 'left';

    // Title (two lines), "Mon D • time", then the location.
    const infoX = calX + calW + px(10);
    const infoW = W - infoX - px(12);
    ctx.font = font(700, px(14.4));
    const titleLines = wrapLines(ctx, model.title, infoW, 2);
    const titleLH = px(14.4 * 1.25);
    const metaSize = px(11.84);
    const blockH =
      titleLines.length * titleLH + px(2) + metaSize * 1.3 + (model.location ? px(3) + metaSize * 1.3 : 0);
    let ty = rowTop + (rowH - blockH) / 2;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#18181B';
    titleLines.forEach((line, i) => ctx.fillText(line, infoX, ty + i * titleLH));
    ty += titleLines.length * titleLH + px(2) + px(3);
    ctx.font = font(500, metaSize);
    ctx.fillStyle = '#71717A';
    ctx.fillText(ellipsize(ctx, model.meta, infoW), infoX, ty);
    if (model.location) {
      ty += metaSize * 1.3 + px(3);
      const pin = px(13);
      paintPin(ctx, infoX, ty - px(1), pin);
      ctx.fillStyle = '#71717A';
      ctx.fillText(ellipsize(ctx, model.location, infoW - pin - px(4)), infoX + pin + px(4), ty);
    }
    ctx.textBaseline = 'alphabetic';

    paintFooter(ctx, model.url, rowTop + rowH + STAT_ROW / 2 - 4, { left: px(12), right: W - px(12) });
  };

  return { height, paint };
}

/** The MapPin glyph (lucide geometry), stroked at `size`. */
function paintPin(ctx, x, y, size) {
  const s = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = 'rgba(113, 113, 122, 0.8)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D('M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0'));
  ctx.beginPath();
  ctx.arc(12, 10, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ── Entry point ──────────────────────────────────────────────────────────

const LAYOUTS = {
  [SHARE_KIND.POST]: postLayout,
  [SHARE_KIND.PROFILE]: identityLayout,
  [SHARE_KIND.COMMUNITY]: identityLayout,
  [SHARE_KIND.ACTIVITY]: activityLayout,
};

/** Waits for the card's typeface so text is measured with the real metrics. */
async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  try {
    await Promise.all([400, 500, 600, 700, 800].map((w) => document.fonts.load(`${w} 40px ${FONT_FAMILY}`)));
  } catch {
    // The system fallback in FONT_FAMILY is measured consistently too.
  }
}

export class StoryRenderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoryRenderError';
    this.code = 'RENDER_FAILED';
  }
}

/**
 * Model → `{ blob, width, height }`: the finished sticker as a transparent
 * PNG. `fetchImage(url) → Blob | null` overrides how pictures are downloaded. Throws `StoryRenderError` when nothing drawable could be produced.
 */
export async function renderStoryCard(model, { fetchImage } = {}) {
  const layout = LAYOUTS[model?.kind];
  if (!layout) throw new StoryRenderError('Nothing to draw for this content');

  await ensureFonts();
  const images = await loadStoryImages(model.imageUrls || [], fetchImage);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = 10;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new StoryRenderError('Canvas is unavailable');

    // Measure, size the canvas to fit, then draw. Resizing a canvas resets
    // its state, which is why the layout is built before it and painted after.
    // Layouts work in 1000-unit space; the pixels are OUTPUT_SCALE times that,
    // so the sticker stays sharp when Instagram shows it full-width.
    const measured = layout(ctx, model, images);
    const height = Math.ceil(measured.height);
    canvas.width = Math.round(W * OUTPUT_SCALE);
    canvas.height = Math.round(height * OUTPUT_SCALE);
    ctx.scale(OUTPUT_SCALE, OUTPUT_SCALE);
    // Photos are nearly always drawn smaller than they are; the default
    // ('low') smoothing aliases them badly.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const { paint } = layout(ctx, model, images);

    if (model.kind !== SHARE_KIND.ACTIVITY) {
      fillRoundRect(ctx, 0, 0, W, height, CARD_RADIUS, SURFACE);
    }
    ctx.textBaseline = 'alphabetic';
    paint();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || !blob.size) throw new StoryRenderError('The card could not be encoded');
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    releaseStoryImages(images);
  }
}
