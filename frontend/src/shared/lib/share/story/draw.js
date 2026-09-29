/**
 * Canvas primitives for the story renderer: text that wraps and ellipsises,
 * rounded shapes, cover-fitted images, and CSS gradients re-expressed as
 * canvas gradients. Nothing here knows what a post or a profile is.
 */

export const FONT_FAMILY = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const font = (weight, size) => `${weight} ${size}px ${FONT_FAMILY}`;

export function roundRectPath(ctx, x, y, w, h, r) {
  const radius = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : r;
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + w - radius.tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius.tr);
  ctx.lineTo(x + w, y + h - radius.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius.br, y + h);
  ctx.lineTo(x + radius.bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
}

export function fillRoundRect(ctx, x, y, w, h, r, fill) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

/**
 * Draws `image` to fill the box completely, cropping the overflow from the
 * centre — CSS `object-fit: cover`. Clipped to the rounded box.
 */
export function drawImageCover(ctx, image, x, y, w, h, r = 0) {
  const iw = image.width;
  const ih = image.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
}

/**
 * A cover-fitted image clipped to a true circle. Not `drawImageCover` with a
 * radius of d/2: its quadratic corners meet as a squircle, not a circle.
 */
export function drawCircleImage(ctx, image, cx, cy, d) {
  const iw = image.width;
  const ih = image.height;
  if (!iw || !ih) return;
  const scale = Math.max(d / iw, d / ih);
  const sw = d / scale;
  const sh = d / scale;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, cx - d / 2, cy - d / 2, d, d);
  ctx.restore();
}

/** Truncates `text` to `maxWidth` with an ellipsis, on the current font. */
export function ellipsize(ctx, text, maxWidth) {
  const value = String(text ?? '');
  if (ctx.measureText(value).width <= maxWidth) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${value.slice(0, mid).trimEnd()}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${value.slice(0, lo).trimEnd()}…`;
}

/**
 * Breaks `text` into lines no wider than `maxWidth` on the current font,
 * keeping explicit newlines, splitting words longer than a line, and ending
 * the last permitted line with an ellipsis when text remains.
 */
export function wrapLines(ctx, text, maxWidth, maxLines) {
  const lines = [];
  const paragraphs = String(text ?? '').split('\n');
  let truncated = false;

  outer: for (let p = 0; p < paragraphs.length; p += 1) {
    const words = paragraphs[p].split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      // A blank line between paragraphs, but never a leading or doubled one.
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      if (lines.length >= maxLines) { truncated = p < paragraphs.length - 1; break; }
      continue;
    }
    let line = '';
    for (let w = 0; w < words.length; w += 1) {
      let word = words[w];
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        if (lines.length >= maxLines) { truncated = true; break outer; }
        line = '';
      }
      // A single word wider than the line: break it by characters.
      while (ctx.measureText(word).width > maxWidth) {
        let cut = word.length - 1;
        while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxWidth) cut -= 1;
        lines.push(word.slice(0, cut));
        if (lines.length >= maxLines) { truncated = true; break outer; }
        word = word.slice(cut);
      }
      line = word;
    }
    if (line) {
      lines.push(line);
      if (lines.length >= maxLines) {
        truncated = p < paragraphs.length - 1;
        break;
      }
    }
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (truncated && lines.length) {
    const last = lines.length - 1;
    lines[last] = ellipsize(ctx, `${lines[last]}…`, maxWidth);
  }
  return lines;
}

const COLOR_STOP =
  /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))\s*(-?\d+(?:\.\d+)?%)?/gi;

/**
 * A CSS gradient string (as stored for covers) as a canvas fill over the box.
 *
 * Linear gradients keep their angle and stops. Radial and conic ones, which
 * canvas cannot reproduce faithfully, fall back to a linear blend of the same
 * colours — the colours are what makes a cover recognisable. Returns null when
 * no colour can be read, and the caller paints its empty state.
 */
export function cssGradientFill(ctx, css, x, y, w, h) {
  const stops = [];
  let match;
  COLOR_STOP.lastIndex = 0;
  while ((match = COLOR_STOP.exec(css)) !== null) {
    stops.push({ color: match[1], at: match[2] ? parseFloat(match[2]) / 100 : null });
  }
  if (stops.length === 0) return null;
  if (stops.length === 1) return stops[0].color;

  const angleMatch = /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg/i.exec(css);
  const toMatch = /^linear-gradient\(\s*to\s+(top|bottom|left|right)/i.exec(css);
  const byKeyword = { top: 0, right: 90, bottom: 180, left: 270 };
  const deg = angleMatch
    ? parseFloat(angleMatch[1])
    : toMatch
      ? byKeyword[toMatch[1].toLowerCase()]
      : css.startsWith('linear') ? 180 : 135;

  // CSS angles run clockwise from "to top"; the gradient line spans the box's
  // projection onto that direction, exactly as the CSS spec defines it.
  const rad = (deg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const gradient = ctx.createLinearGradient(
    cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half,
  );
  stops.forEach((stop, i) => {
    const at = stop.at ?? i / (stops.length - 1);
    try {
      gradient.addColorStop(Math.min(1, Math.max(0, at)), stop.color);
    } catch {
      // An unparseable colour is skipped rather than failing the whole card.
    }
  });
  return gradient;
}
