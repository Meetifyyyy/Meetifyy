/**
 * Whether a drawn frame carries no picture: (nearly) one flat colour. Measured
 * on a 16x16 downscale, so it costs nothing next to the decode.
 */
export function isBlankFrame(source) {
  try {
    const probe = document.createElement('canvas');
    probe.width = 16;
    probe.height = 16;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, 16, 16);
    const { data } = ctx.getImageData(0, 0, 16, 16);
    let sum = 0;
    let sumSq = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += y;
      sumSq += y * y;
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    // A flat frame (black from a fade-in or an undecoded surface, or a flat
    // colour): no detail to show. Real frames, even dark ones, vary far more.
    return sd < 2.5;
  } catch (_) {
    // Unreadable (tainted canvas): cannot judge, so do not reject it.
    return false;
  }
}
