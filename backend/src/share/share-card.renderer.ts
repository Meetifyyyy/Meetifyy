import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import { config } from '../config';
import { defaultAssetFilePath } from '../uploads/default-assets.service';
import type { PublicSharePost } from './share-preview.service';
import { SharePreviewService } from './share-preview.service';
import { fetchFirstAvailableImage } from './share-image.fetcher';
import {
  escapeXml,
  measureText,
  truncateToWidth,
  wrapText,
} from './share-text.util';

/**
 * Draws the 1200x630 card a Meetifyy link unfurls with.
 *
 * NOT A SCREENSHOT, AND THAT IS THE DESIGN
 * The obvious implementation is a headless browser pointed at the post page.
 * It is also the wrong one: it adds Chromium to a Node image, takes a second or
 * more per card, and produces a picture of a web page — navigation, buttons,
 * like counts — where what is wanted is a piece of artwork. This composes the
 * card from primitives instead: an SVG plate, the vector wordmark, and at most
 * two decoded photographs. It has no browser, no layout engine and no network
 * except the media CDN, and it renders in tens of milliseconds.
 *
 * The palette and the plate deliberately match `frontend/scripts/
 * generate-og-image.mjs`, which draws the site-wide card. A post preview and a
 * homepage preview sitting next to each other in a chat thread should read as
 * the same brand, so the two files share their colours and their background
 * treatment. Change one and change the other.
 *
 * FONTS ARE AN INFRASTRUCTURE DEPENDENCY
 * librsvg renders `<text>` with whatever fontconfig can find. The runtime image
 * is `node:22-alpine`, which ships with NO fonts at all — every glyph would be
 * a blank box. `backend/Dockerfile` installs `font-inter` and `font-noto-emoji`
 * for exactly this file. If a card ever renders as empty rectangles, that is
 * where to look, not here.
 */
@Injectable()
export class ShareCardRenderer {
  private readonly logger = new Logger(ShareCardRenderer.name);

  static readonly WIDTH = 1200;
  static readonly HEIGHT = 630;

  /**
   * The renderer's revision. BUMP THIS WHENEVER THE OUTPUT CHANGES — the
   * layout, the palette, the typography, or the encoding.
   *
   * Rendered cards are cached by post id and the post's `updatedAt` (see
   * ShareCardCache), which is exactly right for content changes and useless for
   * code changes: a post nobody has edited keeps its old key, so a redesigned
   * card is never rendered and the fix appears not to have deployed. That is
   * not hypothetical — it happened while this feature was being built, and cost
   * a confused half hour of "the change is live but the image is identical".
   *
   * Included in the cache key, so bumping it retires every existing card at
   * once. The old entries are never read again and expire on their own.
   *
   * Deliberately NOT the app version: that changes on every deploy and would
   * throw away every cached card for a release that did not touch this file,
   * which is the cost the cache exists to avoid.
   */
  static readonly REVISION = 13;

  /** Shared with the site card. See the class comment. */
  private static readonly BG = '#FDFDFD';
  private static readonly BRAND = '#2563EB';
  private static readonly INK = '#0B1220';
  private static readonly MUTED = '#64748B';
  private static readonly FAINT = '#94A3B8';
  private static readonly HAIRLINE = '#E2E8F0';

  /**
   * The font stack every `<text>` in this file uses.
   *
   * Inter is the brand face and the one the app renders in. The rest are
   * fallbacks fontconfig can substitute per glyph, so a card whose text is
   * Devanagari or emoji degrades to a different face rather than to boxes.
   */
  private static readonly FONT =
    "Inter, 'Noto Sans', 'Noto Color Emoji', 'Noto Emoji', 'DejaVu Sans', sans-serif";

  /** Where the photograph starts in the media layout. */
  private static readonly MEDIA_X = 660;

  private readonly wordmark = loadWordmark();

  /**
   * Media origins this renderer will fetch from.
   *
   * Derived from storage configuration, so it is the CDN the app actually uses
   * and nothing else. Empty in a local setup with no storage host configured,
   * which disables the check — see fetchImageBytes.
   */
  private readonly mediaOrigins = mediaOrigins();

  /**
   * The card's encoding.
   *
   * JPEG, not PNG, and the reason is WhatsApp. A photographic 1200x630 frame
   * encodes to around a megabyte as lossless PNG and to around a hundred
   * kilobytes as JPEG at this quality — and WhatsApp refuses to show a large
   * preview for an image much past a few hundred kilobytes, silently falling
   * back to a small thumbnail. That is the single most common way a Meetifyy
   * link will be shared, so the format is chosen for it.
   *
   * Quality 92 with no chroma subsampling: the card is mostly type and flat
   * colour, and 4:2:0 subsampling is exactly what smears coloured text edges.
   * mozjpeg buys roughly 15% at the same quality for a little more CPU, which
   * on a cached, once-per-post render is free.
   */
  private static readonly ENCODE = {
    quality: 92,
    chromaSubsampling: '4:4:4' as const,
    mozjpeg: true,
  };

  /**
   * How much bigger the shareable variant is drawn.
   *
   * The unfurl card is displayed as a thumbnail in a chat list; the shareable
   * one is posted to an Instagram story and looked at full-screen on a phone
   * held at arm's length, where 1200x630 upscaled to a 1080-wide canvas is
   * visibly soft on the type. Everything is composed at this multiple — the
   * SVG is vector so it rasterises sharper rather than larger, and the
   * photographs are cropped from the original at the bigger size rather than
   * being scaled up afterwards.
   *
   * Two, not three: at 3x a photographic card runs past what is comfortable to
   * hand to another application, and the difference is invisible on a phone.
   */
  private static readonly SHARE_SCALE = 2;

  /**
   * The corner radius of the shareable variant, at 1x.
   *
   * ONLY the shareable variant. An unfurl card must have square corners: every
   * platform draws it inside its own rounded container, so corners rounded here
   * would show as four hard notches of the wrong colour against whatever that
   * container's background is — and in a dark theme those notches are white.
   * A story has no container, so a card with square corners reads as a
   * screenshot and a rounded one reads as a card.
   */
  private static readonly SHARE_RADIUS = 28;

  /**
   * The story canvas. 9:16 at the resolution Instagram actually stores.
   *
   * Matching it exactly is what stops Instagram making its own decision about
   * what surrounds the image — see `renderStory`.
   */
  static readonly STORY_WIDTH = 1080;
  static readonly STORY_HEIGHT = 1920;

  /**
   * Renders the card for one post as JPEG bytes.
   *
   * Never throws for a post it cannot draw fully. Every external asset is
   * optional and every one of them degrades to a layout that needs it less, so
   * the worst outcome is a plainer card — not a 500 on a link somebody has
   * already sent to a group chat.
   */
  async render(
    post: PublicSharePost,
    variant: CardVariant = 'unfurl',
  ): Promise<Buffer> {
    const scale = variant === 'story' ? ShareCardRenderer.SHARE_SCALE : 1;
    // Every download starts together and none of them can block another. They
    // are the only slow part of this function, and an unfurler is holding the
    // connection open for all of it — so a gallery of three costs one round
    // trip's latency, not three.
    const [tiles, avatar] = await Promise.all([
      this.loadPreviewTiles(post),
      this.loadAvatar(post),
    ]);

    // Four compositions, chosen by what the post actually IS rather than by one
    // template stretched over every case:
    //
    //   poll  — the question is the subject. Options are listed beneath it as
    //           flat, unclickable rows, because a card is not a ballot.
    //   text  — no usable image. The words are the subject, set large.
    //   split — image(s) AND something to read. The panel takes the right 45%
    //           and the text column keeps its own space.
    //   full  — image(s) and nothing to read. The picture takes the whole
    //           canvas, because a split layout here is half a card of empty
    //           background.
    //
    // A poll wins over its own media: someone sharing a poll is sharing the
    // question, and a photograph attached to it is context, not the point.
    const layout: Layout = post.isPoll
      ? 'poll'
      : tiles.length === 0
        ? 'text'
        : post.text.trim()
          ? 'split'
          : 'full';

    const composites: OverlayOptions[] = [];
    const showsMedia = layout === 'split' || layout === 'full';

    if (showsMedia) {
      const panel = await this.renderMediaPanel(tiles, post, layout, scale);
      // Files that decode nowhere are not worth failing the card for: fall
      // back to the layout that needs no picture at all.
      if (!panel) {
        return this.render({ ...post, image: null, gallery: [] }, variant);
      }
      composites.push(panel);
    }

    if (avatar) {
      const size = layout === 'full' ? 88 : layout === 'split' ? 88 : 104;
      // Cropped AT the final size rather than cropped small and scaled up:
      // the whole point of the larger variant is that nothing is upscaled.
      const circle = await renderCircle(
        avatar,
        size * scale,
        layout === 'full' ? 'light' : 'dark',
      );
      if (circle) {
        composites.push({
          input: circle,
          left: 76 * scale,
          top: avatarTop(layout, size) * scale,
        });
      }
    }

    composites.push({
      input: Buffer.from(
        atScale(this.renderLayer(post, layout, Boolean(avatar)), scale),
      ),
      left: 0,
      top: 0,
    });

    const composed = sharp(
      Buffer.from(atScale(this.renderPlate(layout), scale)),
    ).composite(composites);

    if (variant === 'unfurl') {
      return (
        composed
          // Not optional, for two reasons. JPEG has no alpha channel at all, so
          // without this the transparent parts of the composited layers would
          // be undefined rather than the card colour. And an OG image WITH
          // alpha is composited onto whatever the unfurler puts behind it,
          // which is black in Slack's dark theme.
          .flatten({ background: ShareCardRenderer.BG })
          .jpeg(ShareCardRenderer.ENCODE)
          .toBuffer()
      );
    }

    // The story variant. The card is rounded and then set onto a whole
    // 1080x1920 canvas — see `renderStory` for why the canvas is ours.
    const rounded = await sharp(await composed.png().toBuffer())
      .composite([
        {
          input: Buffer.from(this.cornerMask(scale)),
          // `dest-in` keeps the card only where the mask is opaque. Drawing
          // rounded corners ON TOP instead would need to know what colour is
          // behind them, which is the story background.
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();

    return this.renderStory(rounded);
  }

  /**
   * Sets the card on a finished 1080x1920 story canvas.
   *
   * WHY WE DRAW THE BACKGROUND AND NOT INSTAGRAM
   * Handing Instagram a landscape image leaves it to decide what surrounds it
   * on a 9:16 screen, and its answer depends on how the image arrived: it may
   * fill the canvas by cropping, or letterbox it against a blurred copy of
   * itself. Neither is controllable from here — the background colour picker
   * is not offered for media that arrives through the share sheet, which is
   * exactly the reported symptom.
   *
   * So there is nothing to control. A story-shaped image fills the canvas
   * exactly, which means no cropping, no blurred bars, no picker to go looking
   * for, and a background that is deliberately designed rather than whatever
   * Instagram inferred. This is what every app that shares well to stories
   * does.
   *
   * The card is drawn at twice this width and scaled DOWN into place, so its
   * type is resampled rather than stretched.
   */
  private async renderStory(card: Buffer): Promise<Buffer> {
    const { STORY_WIDTH, STORY_HEIGHT, BRAND } = ShareCardRenderer;

    const cardWidth = STORY_WIDTH - STORY_MARGIN * 2;
    const cardHeight = Math.round(
      (cardWidth / ShareCardRenderer.WIDTH) * ShareCardRenderer.HEIGHT,
    );

    const scaled = await sharp(card)
      .resize(cardWidth, cardHeight, { fit: 'fill' })
      .png()
      .toBuffer();

    const wordmarkWidth = 300;

    // Optically centred: a block on the exact midpoint of a tall canvas reads
    // as low. It also has to clear Instagram's own chrome — the author's name
    // sits over the top of a story and the reply bar over the bottom — and at
    // this position the card and its caption are comfortably inside both.
    const cardTop = Math.round((STORY_HEIGHT - cardHeight) / 2) - 40;

    const backdrop = `<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_WIDTH}" height="${STORY_HEIGHT}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#1D4ED8"/>
      <stop offset="55%" stop-color="#132A63"/>
      <stop offset="100%" stop-color="#080D1A"/>
    </linearGradient>
    <radialGradient id="lift" cx="0.5" cy="0.42" r="0.7">
      <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${BRAND}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${STORY_WIDTH}" height="${STORY_HEIGHT}" fill="url(#sky)"/>
  <rect width="${STORY_WIDTH}" height="${STORY_HEIGHT}" fill="url(#lift)"/>
  <rect x="${STORY_MARGIN}" y="${cardTop + 16}" width="${cardWidth}" height="${cardHeight}" rx="${ShareCardRenderer.SHARE_RADIUS}" fill="#000000" fill-opacity="0.28"/>
  <g transform="translate(${(STORY_WIDTH - wordmarkWidth) / 2} ${cardTop - 190}) scale(${wordmarkWidth / this.wordmark.width})">${this.wordmark.light}</g>
  <text x="${STORY_WIDTH / 2}" y="${cardTop + cardHeight + 96}" text-anchor="middle" font-family="${ShareCardRenderer.FONT}" font-size="34" font-weight="600" fill="#FFFFFF" fill-opacity="0.82">${escapeXml(STORY_CAPTION)}</text>
  <text x="${STORY_WIDTH / 2}" y="${cardTop + cardHeight + 148}" text-anchor="middle" font-family="${ShareCardRenderer.FONT}" font-size="30" font-weight="500" fill="#FFFFFF" fill-opacity="0.55">${escapeXml(SITE_HOST)}</text>
</svg>`;

    return sharp(Buffer.from(backdrop))
      .composite([{ input: scaled, left: STORY_MARGIN, top: cardTop }])
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  /** A full-canvas rounded rectangle, used as the shareable card's alpha. */
  private cornerMask(scale: number): string {
    const w = ShareCardRenderer.WIDTH * scale;
    const h = ShareCardRenderer.HEIGHT * scale;
    const r = ShareCardRenderer.SHARE_RADIUS * scale;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`;
  }

  /** Dispatches to the composition this layout uses. */
  private renderLayer(
    post: PublicSharePost,
    layout: Layout,
    hasAvatar: boolean,
  ): string {
    if (layout === 'poll') return this.renderPollLayer(post, hasAvatar);
    if (layout === 'full') return this.renderFullBleedLayer(post, hasAvatar);
    return this.renderTextLayer(post, layout, hasAvatar);
  }

  /**
   * A poll: the question, then the options as flat rows.
   *
   * WHY THIS IS NOT THE TEXT LAYOUT WITH EXTRAS
   * The text layout centres one block of prose in whatever space is left over.
   * A poll has two blocks that must not collide, and the taller one — four
   * option rows at a readable size — is the one whose height is FIXED. Bending
   * the centred-band arithmetic around that produced exactly what you would
   * expect: a question truncated to a single line while its last option ran
   * through the wordmark.
   *
   * So the geometry runs the other way. The rows are placed from the bottom up,
   * the question gets the space above them, and the wordmark moves to the top
   * right where it costs nothing — a card that has four rows to show cannot
   * also spare a footer.
   *
   * NOTHING HERE IMPLIES THE CARD CAN BE VOTED ON
   * No radio buttons, no result bars, no percentages, no counts. It is a static
   * image in somebody's chat thread: a control drawn on it would promise an
   * interaction that does not exist, and a bar would imply a tally that is
   * deliberately not being published (see SharePreviewService).
   */
  private renderPollLayer(post: PublicSharePost, hasAvatar: boolean): string {
    const { WIDTH, HEIGHT, FONT, INK, MUTED, FAINT, HAIRLINE } =
      ShareCardRenderer;

    const padding = 76;
    const avatarSize = 88;
    const identityTop = avatarTop('poll', avatarSize);
    const identityX = hasAvatar ? padding + avatarSize + 24 : padding;

    const parts: string[] = [];

    // The wordmark rides at the top right, opposite the identity, so the whole
    // lower half of the card belongs to the ballot.
    const wordmarkWidth = 158;
    const wordmarkHeight = Math.round(
      (wordmarkWidth / this.wordmark.width) * this.wordmark.height,
    );
    const identityRight = WIDTH - padding - wordmarkWidth - 40;

    parts.push(
      `<g transform="translate(${WIDTH - padding - wordmarkWidth} ${identityTop + Math.round((avatarSize - wordmarkHeight) / 2)}) scale(${wordmarkWidth / this.wordmark.width})">${this.wordmark.body}</g>`,
    );

    const displayName = truncateToWidth(
      post.author.displayName?.trim() || post.author.username,
      30,
      identityRight - identityX,
    );
    const handle = truncateToWidth(
      post.communityName
        ? `@${post.author.username} · in ${post.communityName}`
        : `@${post.author.username}`,
      21,
      identityRight - identityX,
    );

    parts.push(
      `<text x="${identityX}" y="${identityTop + avatarSize / 2 - 6}" font-family="${FONT}" font-size="30" font-weight="700" fill="${INK}">${escapeXml(displayName)}</text>`,
      `<text x="${identityX}" y="${identityTop + avatarSize / 2 + 28}" font-family="${FONT}" font-size="21" font-weight="500" fill="${MUTED}">${escapeXml(handle)}</text>`,
    );

    // Rows first, from the bottom. Their height is fixed and the question's is
    // not, so this is the block that gets to state its needs.
    const rows = post.pollOptions.slice(0, POLL_MAX_ROWS);
    const hidden = post.pollOptionCount - rows.length;
    const rowsHeight =
      rows.length * POLL_ROW_HEIGHT +
      Math.max(0, rows.length - 1) * POLL_ROW_GAP;
    // The lowest the rows may sit: hard against the bottom margin. This is the
    // constraint that matters when there are four of them and a long question.
    const rowsFloor =
      HEIGHT - (hidden > 0 ? 48 + POLL_MORE_HEIGHT : 56) - rowsHeight;

    // What is left for the question, between the identity and that floor.
    const questionTop = identityTop + avatarSize + 34;
    const questionBand = Math.max(rowsFloor - 26 - questionTop, 40);

    const question =
      post.text.trim() ||
      (post.pollOptionCount > 0 ? 'Poll' : fallbackBody(post));
    const questionSize =
      question.length > 90 ? 34 : question.length > 44 ? 40 : 46;
    const lineHeight = Math.round(questionSize * 1.3);
    const inkAbove = questionSize * 0.72;
    const inkBelow = questionSize * 0.22;

    const maxLines = Math.max(
      1,
      Math.min(
        POLL_MAX_QUESTION_LINES,
        Math.floor((questionBand - inkAbove - inkBelow) / lineHeight) + 1,
      ),
    );

    const { lines } = wrapText(
      question.slice(0, SharePreviewService.CARD_TEXT_MAX_CHARS),
      questionSize,
      WIDTH - padding * 2,
      maxLines,
    );

    lines.forEach((line, index) => {
      if (!line) return;
      parts.push(
        `<text x="${padding}" y="${Math.round(questionTop + inkAbove + index * lineHeight)}" font-family="${FONT}" font-size="${questionSize}" font-weight="700" fill="${INK}">${escapeXml(line)}</text>`,
      );
    });

    // The rows follow the question rather than sitting on the floor, UNLESS the
    // floor is higher — which is the four-option case the floor exists for.
    //
    // Pinning them to the bottom unconditionally left a two-option poll with a
    // hand's width of empty card between the question and the first answer,
    // which reads as content that failed to load rather than as space.
    const questionBottom =
      questionTop + inkAbove + (lines.length - 1) * lineHeight + inkBelow;
    const rowsTop = Math.min(rowsFloor, Math.round(questionBottom + 34));

    const rowWidth = WIDTH - padding * 2;
    rows.forEach((option, index) => {
      const y = rowsTop + index * (POLL_ROW_HEIGHT + POLL_ROW_GAP);
      const label = truncateToWidth(option, POLL_ROW_TEXT_SIZE, rowWidth - 56);
      parts.push(
        `<rect x="${padding}" y="${y}" width="${rowWidth}" height="${POLL_ROW_HEIGHT}" rx="${POLL_ROW_HEIGHT / 2}" fill="#FFFFFF" fill-opacity="0.78" stroke="${HAIRLINE}" stroke-width="1.5"/>`,
        `<text x="${padding + 28}" y="${y + POLL_ROW_HEIGHT / 2 + POLL_ROW_TEXT_SIZE * 0.35}" font-family="${FONT}" font-size="${POLL_ROW_TEXT_SIZE}" font-weight="600" fill="${INK}">${escapeXml(label)}</text>`,
      );
    });

    if (hidden > 0) {
      parts.push(
        `<text x="${padding + 28}" y="${rowsTop + rowsHeight + 32}" font-family="${FONT}" font-size="22" font-weight="500" fill="${FAINT}">${escapeXml(`+${hidden} more option${hidden === 1 ? '' : 's'}`)}</text>`,
      );
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('\n')}</svg>`;
  }

  /**
   * The background plate.
   *
   * Two very soft brand-tinted radials rather than a flat fill: a pure white
   * card looks unfinished beside other previews in a feed, and a heavy gradient
   * looks like a template. In the media layout the right-hand strip is left
   * plain, because a photograph is composited over it.
   */
  private renderPlate(layout: Layout): string {
    const { WIDTH, HEIGHT, BG, BRAND } = ShareCardRenderer;
    const hasPhoto = layout !== 'text';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <radialGradient id="glowA" cx="0.28" cy="0.08" r="0.8">
      <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="${BRAND}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.1" cy="1" r="0.7">
      <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="${BRAND}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowA)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowB)"/>
  ${hasPhoto ? '' : `<rect x="0" y="${HEIGHT - 6}" width="${WIDTH}" height="6" fill="${BRAND}"/>`}
</svg>`;
  }

  /**
   * Downloads the pictures the panel will be built from.
   *
   * WHAT IS FETCHED, AND WHY IT IS CAPPED
   * At most `GALLERY_LIMIT` images, all in parallel, each through the shared
   * fetcher's timeout and byte ceiling. A gallery of six would be six decodes
   * and six buffers held at once inside a request an unfurler is timing; three
   * is what the mosaic can show at a readable size anyway, so the cap costs
   * nothing visible and bounds the memory exactly.
   *
   * VIDEO
   * A video contributes a tile only if a poster frame happens to exist at the
   * key `variantKeysFor` predicts. It usually does not — this pipeline stores
   * the file and nothing else — and that miss is the normal path, not an
   * error. Nothing here downloads or decodes the video itself: that would mean
   * pulling tens of megabytes and running a codec inside a web request, for a
   * frame that the card can perfectly well do without.
   *
   * A failed download is simply a tile that is not there. `Promise.all` over
   * fetches that never reject means one dead CDN object cannot take the card
   * down with it.
   */
  private async loadPreviewTiles(post: PublicSharePost): Promise<Buffer[]> {
    const sources: string[][] = post.gallery.map((image) => [
      // Whichever order SharePreviewService chose, tried in turn: the pipeline
      // only produces a `_thumb` for some uploads, so one of the two is always
      // a guess that has to be allowed to miss.
      image.url,
      image.fallbackUrl,
    ]);

    // Only when there is nothing else to show. A poster is a guess, and a
    // guess is not worth a request when real photographs are already in hand.
    if (sources.length === 0 && post.video) {
      sources.push([post.video.posterUrl]);
    }

    const loaded = await Promise.all(
      sources.map((urls) => fetchFirstAvailableImage(urls, this.mediaOrigins)),
    );

    return loaded.filter((buffer): buffer is Buffer => Boolean(buffer));
  }

  /**
   * Builds the picture side of the card from one, two or three images.
   *
   * A single image fills its panel. Two or three are laid out as a mosaic with
   * a hairline gutter, so a gallery reads as a gallery instead of hiding behind
   * whichever frame happened to be first. The tile geometry lives in
   * `mosaicTiles`; this composes it.
   */
  private async renderMediaPanel(
    tiles: Buffer[],
    post: PublicSharePost,
    layout: Layout,
    scale = 1,
  ): Promise<OverlayOptions | null> {
    const { WIDTH, HEIGHT, MEDIA_X } = ShareCardRenderer;
    const left = layout === 'full' ? 0 : MEDIA_X;
    const panelWidth = WIDTH - left;

    // Geometry stays in 1x units — every layout number in this file is written
    // against a 1200x630 canvas and should stay readable that way — and only
    // the pixels each tile is cut to are multiplied.
    const rects = mosaicTiles(tiles.length, panelWidth, HEIGHT);
    if (rects.length === 0) return null;

    const cut = await Promise.all(
      rects.map(async (rect, index) => {
        const cropped = await this.cropTile(
          tiles[index],
          rect.w * scale,
          rect.h * scale,
        );
        return cropped
          ? { input: cropped, left: rect.x * scale, top: rect.y * scale }
          : null;
      }),
    );

    const usable = cut.filter((tile) => tile !== null) as OverlayOptions[];
    // Every tile failed to decode. The caller falls back to a layout that needs
    // no picture; a panel of empty rectangles would be worse than none.
    if (usable.length === 0) return null;

    try {
      const composed = await sharp({
        create: {
          width: panelWidth * scale,
          height: HEIGHT * scale,
          channels: 4,
          // The gutter colour, showing through between tiles.
          background: { r: 253, g: 253, b: 253, alpha: 1 },
        },
      })
        .composite([
          ...usable,
          {
            input: Buffer.from(
              atScale(this.panelScrim(panelWidth, layout), scale),
            ),
            left: 0,
            top: 0,
          },
          ...this.panelBadges(post, panelWidth, tiles.length, scale),
        ])
        .png()
        .toBuffer();

      return { input: composed, left: left * scale, top: 0 };
    } catch (error) {
      this.logger.warn(`share.card_panel_failed: ${(error as Error)?.message}`);
      return null;
    }
  }

  /**
   * Crops one image to one tile.
   *
   * `position: attention` is sharp's entropy-based crop: on a 4:5 portrait shot
   * squeezed into a tall tile, it keeps the part of the frame with the most
   * detail rather than the geometric centre, which is the difference between a
   * face and a chin. `fit: cover` guarantees the tile is filled exactly, so
   * nothing is ever stretched and no letterbox bars appear.
   */
  private async cropTile(
    source: Buffer,
    width: number,
    height: number,
  ): Promise<Buffer | null> {
    try {
      return await sharp(source, {
        // A decompression bomb is a 100-megapixel PNG that costs a gigabyte to
        // decode. The cap is well above any photograph the app accepts.
        limitInputPixels: 50_000_000,
        // Only the first frame of an animated GIF. Without this sharp decodes
        // every frame into one very tall image and the crop is nonsense.
        animated: false,
      })
        .rotate() // Honour EXIF orientation, or portrait photos land sideways.
        .resize(width, height, {
          fit: 'cover',
          position: sharp.strategy.attention,
        })
        .png()
        .toBuffer();
    } catch (error) {
      // A corrupt or unsupported file is not an error worth failing the card
      // for — the tile is simply dropped.
      this.logger.warn(
        `share.card_tile_unusable: ${(error as Error)?.message}`,
      );
      return null;
    }
  }

  /**
   * The gradient laid over the finished panel.
   *
   * Split: a soft scrim down the seam, because without it a light photograph
   * and the light plate run into each other and the composition loses its edge.
   *
   * Full bleed: a scrim up from the bottom, because the author's name and the
   * wordmark sit directly on the picture and have to stay legible over a white
   * sky as well as a dark one. It is a readability floor, not decoration — the
   * top two thirds are untouched.
   */
  private panelScrim(panelWidth: number, layout: Layout): string {
    const { HEIGHT } = ShareCardRenderer;
    return layout === 'full'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth}" height="${HEIGHT}">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="42%" stop-color="#050B16" stop-opacity="0"/>
      <stop offset="78%" stop-color="#050B16" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#050B16" stop-opacity="0.86"/>
    </linearGradient>
  </defs>
  <rect width="${panelWidth}" height="${HEIGHT}" fill="url(#base)"/>
</svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth}" height="${HEIGHT}">
  <defs>
    <linearGradient id="seam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0B1220" stop-opacity="0.16"/>
      <stop offset="6%" stop-color="#0B1220" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${panelWidth}" height="${HEIGHT}" fill="url(#seam)"/>
</svg>`;
  }

  /**
   * The marks drawn ON the picture: a play glyph for video, a count for the
   * images the mosaic could not fit.
   *
   * The play glyph is the one thing that tells a reader the link leads to
   * something that moves. Without it a video post with a poster frame is
   * indistinguishable from a photograph, and the click is a small
   * disappointment rather than the thing they expected.
   */
  private panelBadges(
    post: PublicSharePost,
    panelWidth: number,
    shownTiles: number,
    scale = 1,
  ): OverlayOptions[] {
    const { HEIGHT, FONT } = ShareCardRenderer;
    const marks: string[] = [];

    if (post.videoCount > 0) {
      const size = 96;
      const cx = panelWidth / 2;
      const cy = HEIGHT / 2;
      const r = size / 2;
      marks.push(
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#0B1220" fill-opacity="0.55"/>`,
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="3"/>`,
        // An equilateral triangle nudged right of centre: a play mark centred
        // on its bounding box reads as sitting too far left, because its mass
        // is on the left side.
        `<path d="M ${cx - 13} ${cy - 21} L ${cx + 24} ${cy} L ${cx - 13} ${cy + 21} Z" fill="#FFFFFF"/>`,
      );
    }

    const hidden = post.imageCount - shownTiles;
    if (hidden > 0) {
      const label = `+${hidden}`;
      const w = Math.round(measureText(label, 28) + 40);
      const x = panelWidth - w - 28;
      const y = 28;
      marks.push(
        `<rect x="${x}" y="${y}" width="${w}" height="52" rx="26" fill="#0B1220" fill-opacity="0.62"/>`,
        `<text x="${x + w / 2}" y="${y + 35}" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="700" fill="#FFFFFF">${escapeXml(label)}</text>`,
      );
    }

    if (marks.length === 0) return [];
    return [
      {
        input: Buffer.from(
          atScale(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth}" height="${HEIGHT}">${marks.join('\n')}</svg>`,
            scale,
          ),
        ),
        left: 0,
        top: 0,
      },
    ];
  }

  /**
   * The author's avatar, falling back to the platform default.
   *
   * The default is read from disk rather than fetched: it ships inside the
   * container (see DefaultAssetsService) and is the same file the app serves,
   * so this reuses the existing default-avatar system instead of inventing a
   * second one for cards.
   */
  private async loadAvatar(post: PublicSharePost): Promise<Buffer | null> {
    if (post.author.avatarUrl) {
      const remote = await fetchFirstAvailableImage(
        [post.author.avatarUrl],
        this.mediaOrigins,
      );
      if (remote) return remote;
    }
    try {
      return await fs.promises.readFile(defaultAssetFilePath('profile-avatar'));
    } catch {
      return null;
    }
  }

  /**
   * Every piece of type on the card, as one SVG laid over the composition.
   *
   * One layer rather than several because text must sit above both the plate
   * and the photograph, and because the vertical rhythm is easier to keep
   * honest when the whole column is described in one place.
   */
  private renderTextLayer(
    post: PublicSharePost,
    layout: 'text' | 'split',
    hasAvatar: boolean,
  ): string {
    const { WIDTH, HEIGHT, FONT, INK, MUTED, FAINT, HAIRLINE, BRAND, MEDIA_X } =
      ShareCardRenderer;

    const hasPhoto = layout === 'split';
    const padding = 76;
    const columnRight = hasPhoto ? MEDIA_X - 44 : WIDTH - padding;
    const columnWidth = columnRight - padding;

    const avatarSize = hasPhoto ? 88 : 104;
    const identityX = hasAvatar ? padding + avatarSize + 24 : padding;
    const identityTop = avatarTop(layout, avatarSize);
    const identityWidth = columnRight - identityX;

    const nameSize = hasPhoto ? 30 : 34;
    const handleSize = hasPhoto ? 21 : 23;

    const displayName = truncateToWidth(
      post.author.displayName?.trim() || post.author.username,
      nameSize,
      identityWidth,
    );
    const handle = truncateToWidth(
      `@${post.author.username}`,
      handleSize,
      identityWidth,
    );

    // The footer is laid out first, because everything above it is budgeted
    // against it. This ordering is the fix for a real defect: with the line
    // count hardcoded, a long post at a large size ran its last two lines
    // straight through the rule and over the wordmark.
    const wordmarkWidth = 186;
    const wordmarkHeight = Math.round(
      (wordmarkWidth / this.wordmark.width) * this.wordmark.height,
    );
    const wordmarkY = HEIGHT - 76 - wordmarkHeight;
    const ruleY = wordmarkY - 44;

    // A post can legally have no text — a photo-only post whose photograph
    // could not be fetched, or a video post. Without this the card came out as
    // an author's name floating above a wordmark on an otherwise empty plate,
    // which reads as content that failed to load rather than as a design.
    const body = post.text.trim() || fallbackBody(post);
    const isFallbackBody = !post.text.trim();

    // Body type is sized to the amount of text, not fixed: a six-word post set
    // at the size a two-hundred-word post needs looks lost on the canvas, and
    // that difference is most of what separates a designed card from a template.
    const bodySize = hasPhoto
      ? body.length > 150
        ? 30
        : 36
      : body.length > 220
        ? 40
        : body.length > 90
          ? 50
          : 60;
    const lineHeight = Math.round(bodySize * 1.34);

    // The identity block is as tall as the avatar, unless the community line
    // hangs below it.
    const identityBottom = Math.max(
      identityTop + avatarSize,
      post.communityName
        ? communityBaseline(identityTop, avatarSize, hasAvatar) + 10
        : 0,
    );

    // The band the body text lives in: below the identity block, above the
    // footer. Everything about the body is derived from it, so however large
    // the type is and however tall the identity block grows, the text cannot
    // reach the footer.
    const bandTop = identityBottom + (hasPhoto ? 40 : 52);
    const bandBottom = (hasPhoto ? wordmarkY : ruleY) - 24;
    const band = bandBottom - bandTop;

    // A line's ink runs from roughly 0.72em above its baseline to 0.22em below,
    // so a block of n lines occupies (n-1) line heights plus that much again.
    const inkAbove = bodySize * 0.72;
    const inkBelow = bodySize * 0.22;

    const maxLines = Math.max(
      1,
      Math.min(
        hasPhoto ? 5 : 6,
        Math.floor((band - inkAbove - inkBelow) / lineHeight) + 1,
      ),
    );

    const { lines } = wrapText(
      body.slice(0, SharePreviewService.CARD_TEXT_MAX_CHARS),
      bodySize,
      columnWidth,
      maxLines,
    );

    // Centred in the band rather than pinned to its top. Short posts otherwise
    // sit high with a large void above the wordmark, which reads as a layout
    // that ran out of content rather than one that was composed.
    const blockHeight = (lines.length - 1) * lineHeight + inkAbove + inkBelow;
    const bodyTop = bandTop + (band - blockHeight) / 2 + inkAbove;

    const parts: string[] = [];

    parts.push(
      `<text x="${identityX}" y="${identityTop + (hasAvatar ? avatarSize / 2 - 6 : 24)}" font-family="${FONT}" font-size="${nameSize}" font-weight="700" fill="${INK}">${escapeXml(displayName)}</text>`,
    );
    parts.push(
      `<text x="${identityX}" y="${identityTop + (hasAvatar ? avatarSize / 2 + 28 : 58)}" font-family="${FONT}" font-size="${handleSize}" font-weight="500" fill="${MUTED}">${escapeXml(handle)}</text>`,
    );

    if (post.communityName) {
      const label = truncateToWidth(
        `in ${post.communityName}`,
        handleSize,
        identityWidth - 20,
      );
      parts.push(
        `<text x="${identityX}" y="${communityBaseline(identityTop, avatarSize, hasAvatar)}" font-family="${FONT}" font-size="${handleSize}" font-weight="500" fill="${FAINT}">${escapeXml(label)}</text>`,
      );
    }

    lines.forEach((line, index) => {
      if (!line) return;
      parts.push(
        // The stand-in line is the platform speaking, not the author, so it is
        // set in the muted ink the handle uses rather than the body's.
        `<text x="${padding}" y="${Math.round(bodyTop + index * lineHeight)}" font-family="${FONT}" font-size="${bodySize}" font-weight="${hasPhoto ? 500 : 600}" fill="${isFallbackBody ? MUTED : INK}">${escapeXml(line)}</text>`,
      );
    });

    // A chip naming media the card could not show.
    //
    // This is the video-with-no-poster case, and it is the common one: this
    // pipeline stores an mp4 and no frame from it, so a video post reaches the
    // text layout with nothing to look at. Without the chip that card is
    // indistinguishable from a plain text post, and the reader has no idea
    // there is anything to play on the other side of the link.
    if (!hasPhoto && (post.videoCount > 0 || post.imageCount > 0)) {
      const label =
        post.videoCount > 0
          ? post.videoCount === 1
            ? 'Video'
            : `${post.videoCount} videos`
          : post.imageCount === 1
            ? 'Photo'
            : `${post.imageCount} photos`;

      const chipTextSize = 22;
      const glyphWidth = post.videoCount > 0 ? 26 : 24;
      const chipWidth = Math.round(
        measureText(label, chipTextSize) + glyphWidth + 46,
      );
      const chipX = WIDTH - padding - chipWidth;
      const chipY = identityTop + 14;
      const glyphX = chipX + 22;
      const glyphY = chipY + 25;

      parts.push(
        `<rect x="${chipX}" y="${chipY}" width="${chipWidth}" height="50" rx="25" fill="#FFFFFF" fill-opacity="0.9" stroke="${HAIRLINE}" stroke-width="1.5"/>`,
        post.videoCount > 0
          ? // A play triangle, drawn rather than set as type: a glyph would
            // depend on a font having it, and this has to render on an image
            // with a deliberately minimal font set.
            `<path d="M ${glyphX} ${glyphY - 11} L ${glyphX + 19} ${glyphY} L ${glyphX} ${glyphY + 11} Z" fill="${BRAND}"/>`
          : `<rect x="${glyphX - 2}" y="${glyphY - 10}" width="20" height="20" rx="4" fill="none" stroke="${BRAND}" stroke-width="2.5"/>`,
        `<text x="${glyphX + glyphWidth + 12}" y="${chipY + 33}" font-family="${FONT}" font-size="${chipTextSize}" font-weight="600" fill="${INK}">${escapeXml(label)}</text>`,
      );
    }

    // A hairline above the footer, only in the text layout: with a photograph
    // the panel edge already provides the horizontal division and a second rule
    // makes the composition busy.
    if (!hasPhoto) {
      parts.push(
        `<rect x="${padding}" y="${ruleY}" width="${columnWidth}" height="1" fill="${HAIRLINE}"/>`,
      );
    }

    // The footer wordmark is drawn from the vector artwork rather than set as
    // type, so it is exact at any size and needs no font installed.
    parts.push(
      `<g transform="translate(${padding} ${wordmarkY}) scale(${wordmarkWidth / this.wordmark.width})">${this.wordmark.body}</g>`,
    );

    if (!hasPhoto && SITE_HOST) {
      parts.push(
        `<text x="${WIDTH - padding}" y="${wordmarkY + wordmarkHeight - 2}" text-anchor="end" font-family="${FONT}" font-size="22" font-weight="500" fill="${FAINT}">${escapeXml(SITE_HOST)}</text>`,
      );
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('\n')}</svg>`;
  }

  /**
   * The layer for a photograph with nothing to read.
   *
   * The split layout would leave more than half the canvas as empty background
   * here, which looks like a card whose content failed to load. Instead the
   * photograph takes the whole frame and the attribution sits on it, over the
   * scrim `renderMediaPanel` has already laid down.
   *
   * Everything on this layer is white, and nothing is drawn above the scrim's
   * reach — the top of the picture stays completely clean.
   */
  private renderFullBleedLayer(
    post: PublicSharePost,
    hasAvatar: boolean,
  ): string {
    const { WIDTH, HEIGHT, FONT } = ShareCardRenderer;

    const padding = 76;
    const avatarSize = 88;
    const identityTop = avatarTop('full', avatarSize);
    const identityX = hasAvatar ? padding + avatarSize + 24 : padding;

    const wordmarkWidth = 158;
    const wordmarkHeight = Math.round(
      (wordmarkWidth / this.wordmark.width) * this.wordmark.height,
    );

    const identityRight = WIDTH - padding - wordmarkWidth - 48;
    const nameSize = 32;
    const handleSize = 22;

    const displayName = truncateToWidth(
      post.author.displayName?.trim() || post.author.username,
      nameSize,
      identityRight - identityX,
    );
    const handle = truncateToWidth(
      post.communityName
        ? `@${post.author.username} · in ${post.communityName}`
        : `@${post.author.username}`,
      handleSize,
      identityRight - identityX,
    );

    const parts: string[] = [
      `<text x="${identityX}" y="${identityTop + avatarSize / 2 - 4}" font-family="${FONT}" font-size="${nameSize}" font-weight="700" fill="#FFFFFF">${escapeXml(displayName)}</text>`,
      `<text x="${identityX}" y="${identityTop + avatarSize / 2 + 30}" font-family="${FONT}" font-size="${handleSize}" font-weight="500" fill="#FFFFFF" fill-opacity="0.78">${escapeXml(handle)}</text>`,
      // The white variant of the wordmark: the artwork's ink is a near-black
      // that disappears against a dark photograph.
      `<g transform="translate(${WIDTH - padding - wordmarkWidth} ${identityTop + Math.round((avatarSize - wordmarkHeight) / 2)}) scale(${wordmarkWidth / this.wordmark.width})">${this.wordmark.light}</g>`,
    ];

    // No count badge here. `panelBadges` draws every mark that sits on the
    // picture — the play glyph and the "+N" — and when this layer drew one too
    // the two overlapped in the same corner.

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('\n')}</svg>`;
  }
}

/**
 * What the card says for a post with no text of its own.
 *
 * Describes the post rather than apologising for it: a poll, a photo and a
 * plain post are three different things to have shared, and naming which one
 * gives the card a subject where there would otherwise be blank space.
 */
function fallbackBody(post: PublicSharePost): string {
  const app = config.app.name;
  if (post.isPoll) return `Shared a poll on ${app}.`;
  if (post.videoCount > 0 && post.imageCount === 0) {
    return post.videoCount === 1
      ? `Shared a video on ${app}.`
      : `Shared ${post.videoCount} videos on ${app}.`;
  }
  if (post.imageCount > 0) {
    return post.imageCount === 1
      ? `Shared a photo on ${app}.`
      : `Shared ${post.imageCount} photos on ${app}.`;
  }
  return `Shared a post on ${app}.`;
}

/**
 * The site host printed in the card's footer.
 *
 * Derived from this deployment's own `FRONTEND_URL`, so a development build
 * says `dev.meetifyy.app` and a production build says `meetifyy.app` — the card
 * names the site it will actually take somebody to. Typing the production host
 * in here would have put it on every card a development deployment rendered,
 * which is a link that does not go where it says it does.
 */
const SITE_HOST = (() => {
  try {
    return new URL(config.app.frontendUrl).host;
  } catch {
    // A malformed FRONTEND_URL is a configuration error the isolation guard
    // will catch at boot. It must not also take the renderer down.
    return '';
  }
})();

/**
 * Redraws an SVG at a multiple of its authored size.
 *
 * Every layout number in this file is written against a 1200x630 canvas, and
 * that is worth keeping: geometry expressed in the size you are looking at is
 * readable, and geometry multiplied by a variable at every use site is not.
 * So the coordinates stay as they are and the SVG is given a viewBox instead —
 * librsvg then rasterises the same vector description into a larger bitmap,
 * which is genuinely sharper rather than merely bigger. Scaling the finished
 * raster afterwards would just be an upscale.
 *
 * Returns the source untouched at 1x, so the unfurl path pays nothing.
 */
function atScale(svg: string, scale: number): string {
  if (scale === 1) return svg;

  const width = Number(svg.match(/\bwidth="(\d+(?:\.\d+)?)"/)?.[1]);
  const height = Number(svg.match(/\bheight="(\d+(?:\.\d+)?)"/)?.[1]);
  // A layer this cannot measure is left alone rather than guessed at: a wrong
  // viewBox silently crops the layer, which is worse than a soft one.
  if (!Number.isFinite(width) || !Number.isFinite(height)) return svg;

  return svg
    .replace(
      /<svg\b([^>]*)>/,
      `<svg$1 viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`,
    )
    .replace(/\bwidth="\d+(?:\.\d+)?"/, `width="${Math.round(width * scale)}"`)
    .replace(
      /\bheight="\d+(?:\.\d+)?"/,
      `height="${Math.round(height * scale)}"`,
    );
}

/**
 * Who the card is being drawn for.
 *
 *   unfurl — the `og:image` a crawler fetches. 1200x630 JPEG, square corners,
 *            flattened. Sized and encoded for a chat thumbnail, and small
 *            enough that WhatsApp still shows it large.
 *   story  — the file handed to Instagram. A whole 1080x1920 story canvas with
 *            the card composed onto a background we control.
 *
 * Two variants rather than one compromise: the constraints genuinely conflict.
 * A file big enough to look sharp on a story is big enough for WhatsApp to
 * downgrade the preview, and a 9:16 canvas is the wrong shape for a chat
 * thumbnail entirely.
 */
export type CardVariant = 'unfurl' | 'story';

/**
 * Which of the four compositions a card uses. See `render`.
 */
type Layout = 'text' | 'split' | 'full' | 'poll';

/**
 * The poll option row's geometry.
 *
 * A pill tall enough to be read at the size a preview is shown — most people
 * see this card as a 300px-wide thumbnail in a chat, so 22px type in a 62px
 * row is close to the floor of what survives that reduction.
 */
const POLL_ROW_HEIGHT = 62;
const POLL_ROW_GAP = 12;
const POLL_ROW_TEXT_SIZE = 24;
/** Room for the "+2 more options" line beneath the last row. */
const POLL_MORE_HEIGHT = 34;

/**
 * How many option rows fit above the fold.
 *
 * Four, because that is what 630px leaves once the identity and the question
 * have had their share. A poll with more says so in a line beneath them rather
 * than shrinking every row until none of them can be read at thumbnail size.
 */
const POLL_MAX_ROWS = 4;

/** The question never takes more than this, however long it is. */
const POLL_MAX_QUESTION_LINES = 3;

/** Side margin of the card on the story canvas. */
const STORY_MARGIN = 84;

/** The one line of prose on the story, beneath the card. */
const STORY_CAPTION = 'Tap the link to open this post';

/**
 * Where each picture sits inside the media panel.
 *
 * ONE image fills the panel. TWO and THREE are cut across the panel's long
 * axis, which differs between the layouts: the split panel is 540x630 and the
 * full-bleed one is 1200x630, so a single arrangement gives letterbox slots in
 * one and slivers in the other.
 *
 * A gutter of the card's own background colour separates the tiles, which is
 * why the panel is composed onto a filled canvas rather than onto transparency.
 * Beyond three the geometry stops earning its keep: a fourth tile on a 540px
 * panel is thumbnail-sized, and the count badge says what is missing instead.
 */
function mosaicTiles(
  count: number,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number }[] {
  const gap = 4;

  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, y: 0, w: width, h: height }];

  // The split panel is taller than it is wide and the full-bleed panel is much
  // wider than it is tall, so the same arrangement cannot serve both: splitting
  // a 1200x630 frame into stacked rows gives two letterbox slots, and splitting
  // a 540x630 one into columns gives two slivers. The tiles are cut across the
  // panel's LONG axis, whichever that is.
  const wide = width > height;

  if (count === 2) {
    if (wide) {
      const w = Math.floor((width - gap) / 2);
      return [
        { x: 0, y: 0, w, h: height },
        { x: w + gap, y: 0, w: width - w - gap, h: height },
      ];
    }
    const h = Math.floor((height - gap) / 2);
    return [
      { x: 0, y: 0, w: width, h },
      { x: 0, y: h + gap, w: width, h: height - h - gap },
    ];
  }

  // Three: the first — the canonical primary image — takes the larger tile and
  // the other two share the space beside or beneath it, so the order the author
  // chose is still legible at a glance.
  if (wide) {
    const heroW = Math.round(width * 0.6);
    const restW = width - heroW - gap;
    const halfH = Math.floor((height - gap) / 2);
    return [
      { x: 0, y: 0, w: heroW, h: height },
      { x: heroW + gap, y: 0, w: restW, h: halfH },
      { x: heroW + gap, y: halfH + gap, w: restW, h: height - halfH - gap },
    ];
  }

  const heroH = Math.round(height * 0.62);
  const restH = height - heroH - gap;
  const halfW = Math.floor((width - gap) / 2);
  return [
    { x: 0, y: 0, w: width, h: heroH },
    { x: 0, y: heroH + gap, w: halfW, h: restH },
    { x: halfW + gap, y: heroH + gap, w: width - halfW - gap, h: restH },
  ];
}

/**
 * The avatar's top edge, which two places must agree on: the composite that
 * places the circle, and the text layer that sets the name beside it. They were
 * separate expressions and drifting apart was a matter of time.
 */
function avatarTop(layout: Layout, size: number): number {
  if (layout === 'text' || layout === 'poll') return 76;
  if (layout === 'split') return 72;
  // Full bleed: the identity sits at the foot of the picture, on the scrim.
  return ShareCardRenderer.HEIGHT - 72 - size;
}

/**
 * Baseline of the "in <community>" line, which sits below the handle.
 *
 * A function rather than an inline expression because two places need it: the
 * line itself, and the identity block's height, which the body text is
 * budgeted against. Computing it twice is how the two silently disagree.
 */
function communityBaseline(
  identityTop: number,
  avatarSize: number,
  hasAvatar: boolean,
): number {
  return identityTop + (hasAvatar ? avatarSize / 2 + 60 : 90);
}

/** Masks a square image into a circle with a hairline ring. */
async function renderCircle(
  source: Buffer,
  size: number,
  ring: 'dark' | 'light' = 'dark',
): Promise<Buffer | null> {
  try {
    const square = await sharp(source, {
      limitInputPixels: 50_000_000,
      animated: false,
    })
      .rotate()
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();

    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
    );

    const masked = await sharp(square)
      // `dest-in` keeps the photograph only where the mask is opaque, which is
      // the circle. Drawing a white ring over the corners instead would leave a
      // visible square edge anywhere the card background is not pure white.
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // On a photograph the ring is white and doing real work — separating the
    // avatar from whatever happens to be behind it. On the brand plate it is a
    // barely-there dark edge that stops a pale avatar dissolving into the card.
    const stroke =
      ring === 'light'
        ? { color: '#FFFFFF', opacity: 0.9, width: 3 }
        : { color: '#0B1220', opacity: 0.08, width: 2 };

    const ringLayer = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - stroke.width / 2}" fill="none" stroke="${stroke.color}" stroke-opacity="${stroke.opacity}" stroke-width="${stroke.width}"/></svg>`,
    );

    return sharp(masked)
      .composite([{ input: ringLayer }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

interface Wordmark {
  /** The artwork as authored, for a light background. */
  body: string;
  /** The same paths recoloured white, for laying over a photograph. */
  light: string;
  width: number;
  height: number;
}

/**
 * Reads the vector wordmark once at construction.
 *
 * The outer `<svg>` element is stripped and only its children are kept, because
 * the result is spliced into the text layer's own `<svg>` under a transform —
 * a nested `<svg>` there would carry its own coordinate system and ignore the
 * scale. The viewBox is read for the aspect ratio so the footer mark can be
 * sized by width alone.
 */
function loadWordmark(): Wordmark {
  const fallback: Wordmark = { body: '', light: '', width: 995, height: 108 };
  try {
    const raw = fs.readFileSync(
      brandAssetPath('meetifyy-wordmark.svg'),
      'utf8',
    );
    const viewBox = raw
      .match(/viewBox="([^"]+)"/)?.[1]
      ?.trim()
      .split(/\s+/);
    const body = raw
      .replace(/^[\s\S]*?<svg[^>]*>/i, '')
      .replace(/<\/svg>\s*$/i, '')
      .trim();
    if (!body) return fallback;
    return {
      body,
      // Recoloured by substitution rather than by an overriding `fill` on the
      // wrapping group: the artwork sets its ink colour on an inner <g>, and an
      // explicit fill there wins over anything an ancestor says. The gradient
      // the two Y glyphs use is left alone — it is legible on a dark photograph
      // and is the one part of the mark that carries the brand colour.
      light: body.replace(/#050F24/gi, '#FFFFFF'),
      width: viewBox ? Number(viewBox[2]) || fallback.width : fallback.width,
      height: viewBox ? Number(viewBox[3]) || fallback.height : fallback.height,
    };
  } catch {
    return fallback;
  }
}

/**
 * Locates a file under `backend/assets/brand/`.
 *
 * `__dirname` is `dist/share` in a built image and `src/share` under ts-node,
 * and assets are not compiled — so both are tried, exactly as
 * `defaultAssetFilePath` does for the default avatars.
 */
function brandAssetPath(name: string): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'assets', 'brand', name),
    path.join(__dirname, '..', '..', '..', 'assets', 'brand', name),
    path.join(process.cwd(), 'assets', 'brand', name),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  );
}

/**
 * The origins images may be fetched from, derived from storage configuration.
 *
 * The backend's own origin is included because an unconfigured storage host
 * makes `getPublicUrl` return an `/api/media/...` path, which is resolved
 * against this API. That is the local-development shape; in a deployed
 * environment the CDN host is set and this list names it.
 */
function mediaOrigins(): string[] {
  const candidates = [
    config.storage.publicUrl,
    config.storage.r2.publicUrl,
    config.app.backendUrl,
    config.app.apiBaseUrl,
  ];
  const origins = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // A misconfigured value simply contributes no origin, rather than
      // preventing the service from starting.
    }
  }
  return [...origins];
}
