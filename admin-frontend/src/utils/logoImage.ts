/**
 * Client-side logo processing: decode (EXIF-aware), crop to a square, resize
 * and encode. Logos are always 1:1; the API re-checks and re-encodes them.
 */

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** Largest file the picker accepts; it is compressed before upload. */
export const LOGO_SOURCE_MAX_BYTES = 15 * 1024 * 1024;
/** Hard ceiling the API enforces on the processed file. */
export const LOGO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/** Quality is stepped down until the output fits under this. */
export const LOGO_TARGET_BYTES = 300 * 1024;
export const LOGO_MAX_PX = 512;
export const LOGO_MIN_PX = 256;

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

export interface CropView {
  /** 1 = the square covers the image's short edge; below 1 shows padding. */
  zoom: number;
  /** Centre of the crop square, in source pixels. */
  cx: number;
  cy: number;
}

export interface LogoResult {
  blob: Blob;
  width: number;
  height: number;
  type: string;
}

/** Returns an error message for a file the picker should refuse, else null. */
export function validateLogoSource(file: File): string | null {
  if (!LOGO_TYPES.includes(file.type)) return 'Logo must be a PNG, JPEG or WebP image.';
  if (file.size > LOGO_SOURCE_MAX_BYTES) {
    return `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 15 MB.`;
  }
  return null;
}

/** Decodes a file with its EXIF orientation applied. */
export async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img>, which also honours EXIF in current browsers */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } catch {
    throw new Error('That image could not be read. Try a different file.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Side of the crop square in source pixels. */
export const cropSide = (img: { width: number; height: number }, zoom: number): number =>
  Math.min(img.width, img.height) / zoom;

export const zoomRange = (img: { width: number; height: number }): { min: number; max: number } => {
  const short = Math.min(img.width, img.height);
  return { min: short / Math.max(img.width, img.height), max: clamp(short / 32, 1, 16) };
};

/** Keeps the crop square over the image (centred on an axis it exceeds). */
export function clampView(img: { width: number; height: number }, view: CropView): CropView {
  const { min, max } = zoomRange(img);
  const zoom = clamp(view.zoom, min, max);
  const half = cropSide(img, zoom) / 2;
  const axis = (c: number, dim: number) => (half * 2 >= dim ? dim / 2 : clamp(c, half, dim - half));
  return { zoom, cx: axis(view.cx, img.width), cy: axis(view.cy, img.height) };
}

export const initialView = (img: { width: number; height: number }): CropView => ({
  zoom: 1,
  cx: img.width / 2,
  cy: img.height / 2,
});

/** Draws the current crop into a square canvas of `px` pixels. */
export function drawCrop(
  ctx: CanvasRenderingContext2D,
  img: DecodedImage,
  view: CropView,
  px: number,
): void {
  const side = cropSide(img, view.zoom);
  const scale = px / side;
  ctx.clearRect(0, 0, px, px);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    img.source,
    (side / 2 - view.cx) * scale,
    (side / 2 - view.cy) * scale,
    img.width * scale,
    img.height * scale,
  );
}

/** Output edge: native crop size, capped at 512 and never below 256. */
export const outputSize = (side: number): number =>
  clamp(Math.floor(side), LOGO_MIN_PX, LOGO_MAX_PX);

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Renders the crop and encodes it: WebP at q0.85, stepping quality down until
 * it is under ~300 KB; PNG when the browser cannot encode WebP.
 */
export async function renderLogo(img: DecodedImage, view: CropView): Promise<LogoResult> {
  const px = outputSize(cropSide(img, view.zoom));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');
  drawCrop(ctx, img, view, px);

  let quality = 0.85;
  let blob = await toBlob(canvas, 'image/webp', quality);
  if (blob && blob.type === 'image/webp') {
    while (blob.size > LOGO_TARGET_BYTES && quality > 0.5) {
      quality = Math.round((quality - 0.1) * 100) / 100;
      const next = await toBlob(canvas, 'image/webp', quality);
      if (!next) break;
      blob = next;
    }
  } else {
    blob = await toBlob(canvas, 'image/png');
  }
  if (!blob) throw new Error('The image could not be encoded.');
  if (blob.size > LOGO_UPLOAD_MAX_BYTES) {
    throw new Error('The processed logo is still over 2 MB. Choose a simpler image.');
  }
  return { blob, width: px, height: px, type: blob.type };
}

export const formatBytes = (n: number): string =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
