import { useLayoutEffect } from 'react';

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
/** Eases in and out of the blur so it neither snaps on nor stalls at the end. */
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Drives a header that starts transparent over a cover image and becomes the
 * themed app header as the page scrolls.
 *
 * Progress (0 over the cover, 1 once the cover has scrolled under the header)
 * is written to `--collapse` on the header element, once per animation frame,
 * straight from the window's scroll position. Nothing re-renders while
 * scrolling: every visual step is CSS reading that one variable.
 *
 * While mounted the status bar shows the cover behind it. Its icons are light
 * over the cover and follow the theme once the header is solid. The mobile
 * system-bar installer observes these root attributes and updates native bars.
 *
 * With `coverBackground` (Profile) the header also carries the page's cover:
 * `--cover-shift` scrolls it away 1:1 with the page until only a header's
 * height of it is left, where it pins; `--cover-blur` (0..1) crossfades it into
 * a blurred copy over the same distance, so the cover itself becomes the
 * header's background. It used to be squashed with `scaleY` instead, which
 * distorted the photo. Sizes are re-measured whenever the cover or the header
 * resizes: the status-bar inset arrives after mount and changes the cover's
 * height without a window resize, which left the fixed copy at a stale height,
 * out of line with the page.
 */
/*
 * `data-collapsing-header` and the status-bar icon preference are shared by
 * every cover page, so they are owned by a count, not by "whoever mounted
 * last". The attribute makes the status strip transparent and drops #root's
 * status-bar padding; seen stuck on Home on a device, it put the feed and the
 * header under the clock. Set-on-mount/remove-on-unmount per instance goes
 * wrong as soon as two cover pages overlap (one mounting before the other has
 * unmounted): the first to leave removes it under the second, and restores an
 * icon preference the second had already replaced. Here the first owner takes
 * the snapshot, the last to leave restores it, and nothing in between can.
 */
let owners = 0;
let iconsBeforeOwners = null;

function claimCoverAttributes(root, iconsBefore) {
  if (owners === 0) iconsBeforeOwners = iconsBefore;
  owners += 1;
  root.setAttribute('data-collapsing-header', '');
}

function releaseCoverAttributes(root) {
  owners = Math.max(0, owners - 1);
  if (owners > 0) return;
  root.removeAttribute('data-collapsing-header');
  if (iconsBeforeOwners === null) root.removeAttribute('data-status-bar-icons');
  else root.setAttribute('data-status-bar-icons', iconsBeforeOwners);
  iconsBeforeOwners = null;
}

export function useCollapsingHeader({
  enabled,
  headerRef,
  coverRef,
  coverBackground = false,
  collapseRangeMultiplier = 1,
}) {
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!enabled || !header) return undefined;

    const root = document.documentElement;
    // Before update() below writes its own icon preference.
    const iconsBefore = root.getAttribute('data-status-bar-icons');
    const previousCoverHeight = root.style.getPropertyValue('--profile-cover-height');
    const previousCoverH = root.style.getPropertyValue('--profile-cover-h');
    const previousPinAt = root.style.getPropertyValue('--cover-pin-at');
    const editCoverButton = coverBackground ? header.querySelector('button[aria-label="Edit cover"]') : null;
    const pageCard = coverRef.current?.parentElement ?? null;

    let frame = 0;
    let lastLight = null;
    /*
     * With scroll-driven animations, everything a cover header animates on
     * scroll (the cover's position, its blur, the title, the page's name and
     * avatar) is CSS on the compositor, so no scroll listener is needed at all:
     * only sizes are measured, when they change.
     */
    const cssDriven = coverBackground
      && typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('animation-timeline: scroll()');
    let lastCoverHeight = -1;
    let lastHeaderHeight = -1;
    /*
     * Per-frame values go on the elements that read them, never on <html>: a
     * custom property changed on the root invalidates the style of the whole
     * page, every frame of a scroll. The card is the cover's parent, which
     * holds the page's cover, name and handle.
     */
    const setOnPage = (name, value) => {
      const card = coverRef.current?.parentElement;
      if (card) card.style.setProperty(name, value);
    };

    const update = () => {
      frame = 0;
      // Sub-pixel: offsetHeight rounds, which left the fixed cover up to half a
      // pixel off the page's placeholder.
      const coverHeight = coverRef.current?.getBoundingClientRect().height || 0;
      const headerHeight = header.offsetHeight;
      const range = Math.max(1, coverHeight - headerHeight) * collapseRangeMultiplier;
      const progress = clamp01(window.scrollY / range);
      header.style.setProperty('--collapse', progress.toFixed(3));
      setOnPage('--profile-collapse', progress.toFixed(3));
      if (coverBackground) {
        const pinAt = Math.max(1, coverHeight - headerHeight);
        const scrolled = Math.max(0, window.scrollY);
        // Sizes change rarely (layout, the status-bar inset); only then are
        // they written, and only then on the root.
        if (coverHeight !== lastCoverHeight || headerHeight !== lastHeaderHeight) {
          lastCoverHeight = coverHeight;
          lastHeaderHeight = headerHeight;
          root.style.setProperty('--profile-cover-height', `${coverHeight}px`);
          root.style.setProperty('--profile-cover-h', String(Math.max(1, coverHeight)));
          header.style.setProperty('--cover-h', String(Math.max(1, coverHeight)));
          // The scroll-driven animations' range, read by the header and the
          // page alike, hence the root (written only when sizes change).
          root.style.setProperty('--cover-pin-at', String(pinAt));
        }
        header.style.setProperty('--cover-shift', String(Math.min(scrolled, pinAt)));
        const blur = smoothstep(clamp01(scrolled / pinAt)).toFixed(3);
        header.style.setProperty('--cover-blur', blur);
        // The page's own cover blurs with the header band, so the band's
        // edge never shows as a sharp/blurred division across the photo.
        setOnPage('--cover-blur', blur);
      }
      if (editCoverButton) {
        editCoverButton.style.opacity = (1 - progress).toFixed(3);
        editCoverButton.style.pointerEvents = progress === 0 ? 'auto' : 'none';
        editCoverButton.tabIndex = progress === 0 ? 0 : -1;
      }

      const dark = root.getAttribute('data-theme') === 'dark';
      const lightIcons = coverBackground || progress < 0.5 || dark;
      if (lightIcons !== lastLight) {
        lastLight = lightIcons;
        root.setAttribute('data-status-bar-icons', lightIcons ? 'light' : 'dark');
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    // Claimed only once the setup above has run without throwing: a layout
    // effect that throws never gets its cleanup, so claiming first would leave
    // the attribute behind for the rest of the session.
    claimCoverAttributes(root, iconsBefore);
    if (!cssDriven) window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    if (resizeObserver) {
      resizeObserver.observe(header);
      if (coverRef.current) resizeObserver.observe(coverRef.current);
    }
    // A theme change flips which icons the solid header needs.
    const themeObserver = new MutationObserver(() => {
      lastLight = null;
      schedule();
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      resizeObserver?.disconnect();
      themeObserver.disconnect();
      releaseCoverAttributes(root);
      pageCard?.style.removeProperty('--profile-collapse');
      pageCard?.style.removeProperty('--cover-blur');
      if (previousCoverHeight) root.style.setProperty('--profile-cover-height', previousCoverHeight);
      else root.style.removeProperty('--profile-cover-height');
      if (previousCoverH) root.style.setProperty('--profile-cover-h', previousCoverH);
      else root.style.removeProperty('--profile-cover-h');
      if (previousPinAt) root.style.setProperty('--cover-pin-at', previousPinAt);
      else root.style.removeProperty('--cover-pin-at');
    };
  }, [enabled, headerRef, coverRef, coverBackground, collapseRangeMultiplier]);
}
