/**
 * Captures the exact feed post card DOM element into a transparent PNG File for sharing.
 *
 * Reuses the exact rendered DOM card component from the feed (typography,
 * layout, media, badges, spacing, styling) and converts it into a high-res
 * image containing ONLY the card itself — with all surrounding page chrome,
 * backgrounds, headers, and modal overlays omitted.
 */
import html2canvas from 'html2canvas';

/** Target MIME type for Instagram Story sharing with alpha transparency. */
const INSTAGRAM_CARD_MIME = 'image/png';

/** Max resolution scale to balance crisp rendering with memory limits. */
const RENDER_SCALE = 2.5;

/**
 * Captures a post card DOM element and returns a transparent PNG File ready for navigator.share.
 * Everything outside the post card's rounded corners is completely transparent.
 *
 * @param {HTMLElement} element - The root DOM element of the post card (.post).
 * @param {string} [fileName='meetifyy-story.png'] - Name for the resulting File.
 * @returns {Promise<File|null>} The generated PNG File, or null if capture failed.
 */
export async function capturePostCard(element, fileName = 'meetifyy-story.png') {
  if (typeof window === 'undefined' || !element) {
    return null;
  }

  try {
    // Wait for fonts if document.fonts is supported so text metrics match exactly
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    const computedStyle = window.getComputedStyle(element);
    const cardBgColor =
      computedStyle.backgroundColor &&
      computedStyle.backgroundColor !== 'transparent' &&
      computedStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
        ? computedStyle.backgroundColor
        : '#ffffff';

    const canvas = await html2canvas(element, {
      scale: RENDER_SCALE,
      useCORS: true,
      allowTaint: false,
      // null makes html2canvas canvas background transparent so outside corners have alpha 0
      backgroundColor: null,
      logging: false,
      onclone: (clonedDoc, clonedElement) => {
        // Remove margins, transforms, and shadows on the root element
        clonedElement.style.margin = '0';
        clonedElement.style.transform = 'none';
        clonedElement.style.boxShadow = 'none';
        clonedElement.style.backgroundColor = cardBgColor;

        // Ensure any transient popups, dropdowns, or modals are omitted in the capture
        const popups = clonedElement.querySelectorAll('.dropdown, [role="menu"], [role="dialog"]');
        popups.forEach((p) => {
          p.style.display = 'none';
        });

        // Capture video frames into images so videos render the visible frame
        const origVideos = element.querySelectorAll('video');
        const clonedVideos = clonedElement.querySelectorAll('video');

        origVideos.forEach((origVideo, i) => {
          const clonedVideo = clonedVideos[i];
          if (!clonedVideo) return;

          try {
            const w = origVideo.videoWidth || origVideo.clientWidth || 400;
            const h = origVideo.videoHeight || origVideo.clientHeight || 300;
            if (w > 0 && h > 0) {
              const frameCanvas = clonedDoc.createElement('canvas');
              frameCanvas.width = w;
              frameCanvas.height = h;
              const ctx = frameCanvas.getContext('2d');
              ctx.drawImage(origVideo, 0, 0, w, h);
              const frameData = frameCanvas.toDataURL('image/jpeg', 0.95);

              const replacementImg = clonedDoc.createElement('img');
              replacementImg.src = frameData;
              replacementImg.className = clonedVideo.className;
              replacementImg.style.cssText = clonedVideo.style.cssText;
              replacementImg.style.width = '100%';
              replacementImg.style.height = '100%';
              replacementImg.style.objectFit = 'cover';

              clonedVideo.parentNode?.replaceChild(replacementImg, clonedVideo);
            }
          } catch {
            // If frame extraction fails (e.g. cross-origin video), leave video element intact
          }
        });

        // Ensure images in clone have crossOrigin set
        const clonedImages = clonedElement.querySelectorAll('img');
        clonedImages.forEach((img) => {
          img.crossOrigin = 'anonymous';
        });
      },
    });

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, INSTAGRAM_CARD_MIME);
    });

    if (!blob || blob.size === 0) {
      return null;
    }

    const outFileName = (fileName || 'meetifyy-story.png').replace(/\.jpe?g$/i, '.png');

    return new File([blob], outFileName, {
      type: INSTAGRAM_CARD_MIME,
      lastModified: Date.now(),
    });
  } catch (err) {
    // If html2canvas throws, return null so callers can fall back gracefully
    return null;
  }
}
