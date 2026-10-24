import { useLayoutEffect } from 'react';

/** Scroll distance over which a tracked element fades out before the header. */
const DEFAULT_EXIT_LEAD_PX = 40;
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
/** Eases in and out of the blur so it neither snaps on nor stalls at the end. */
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Drives a header that starts transparent over a cover image and becomes the
 * themed app header as the page scrolls.
 *
 * Progress (0 over the cover, 1 once the cover has scrolled under the header)
 * is written to `--collapse` on the header element straight from the window's
 * scroll position, in the scroll event itself (it is delivered in the frame it
 * describes, ahead of that frame's style and paint). Nothing re-renders while
 * scrolling: every visual step is CSS reading a variable.
 *
 * NOT scroll-driven animations (`animation-timeline`). They were used here, and
 * on the installed app (Android WebView) any one of them on the page made a
 * fast flick stall: the finger lifted, the page moved for ~100 ms, froze for
 * ~1.6 s and then jumped to where the fling would have ended. Measured on the
 * I2208: 13 frames rendered per flick with them, 106 without - the same page,
 * the same flick. Dragging slowly never showed it, which is why earlier
 * measurements missed it. The effects are now plain variables, written only
 * onto the few elements that read them, never onto <html> or the whole card
 * (a custom property changed on an ancestor restyles everything beneath it,
 * posts included, every frame).
 *
 * While mounted the status bar shows the cover behind it. Its icons are light
 * over the cover and follow the theme once the header is solid. The mobile
 * system-bar installer observes these root attributes and updates native bars.
 *
 * With `coverBackground` (Profile and Community) the page's own cover IS the
 * header. Both pages make their cover element `position: sticky`; this hook
 * gives it `--cover-pin-top` for its sticky `top` (measured, resize-only; a
 * variable, so a layout where the cover is not sticky is left alone) so it pins exactly when the BOTTOM of
 * the page's avatar (`data-cover-avatar`: profile picture, community icon)
 * reaches the header's bottom line. Until then the cover scrolls 1:1 with the
 * page. The avatar hangs below the cover's bottom edge, so the cover's own
 * box pins first (sticky, done by the compositor in the frame of the scroll)
 * and its picture keeps panning up inside that box for the remaining distance
 * (`--cover-pan`, px, written per scroll onto the cover element only and read
 * as a `translate`). The picture is drawn `--cover-extend` px taller than the
 * box (resize-only) so the header band is always full. `--cover-blur` (0..1)
 * crossfades the picture into a pre-blurred copy (BlurredCover) by opacity
 * over the whole distance to the pin, proportional to scroll. There is no
 * second header: the pinned, blurred cover stays as the header's background.
 * Only transform/opacity change per frame; nothing reads layout per scroll.
 *
 * Elements inside the page's card marked `data-exit-track="<name>"` get an
 * `--exit` variable (0..1): 0 while the element is well clear of the header, 1
 * once its top edge has reached the header's bottom. They are meant to be
 * invisible by then, so the header's opaque edge never slices through them
 * (it used to cut the avatar flat as it slid underneath). `data-exit-lead`
 * is how many px of scroll that takes (default 40). `data-exit-through` runs
 * from the element's top edge reaching the header's bottom to its bottom edge
 * doing so (the avatar dissolves into the pinned cover). `data-exit-after` is the
 * other kind: the element is pinned on the header's bottom line by the page
 * (`position: sticky`, `data-exit-sticky`) and fades over that many px of
 * scroll after touching it, never going behind the header. `data-exit-inert`
 * also makes the element non-interactive once it is mostly gone. `--exit-<name>` is
 * also written on the header, so its title can hand over from the page's own
 * name. An element marked `data-cover-blur` gets `--cover-blur` (the page's
 * own copy of the cover blurs with the header band).
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
  coverIsPhoto = true,
}) {
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!enabled || !header) return undefined;
    const coverAtMount = coverRef.current;

    const root = document.documentElement;
    // Before update() below writes its own icon preference.
    const iconsBefore = root.getAttribute('data-status-bar-icons');
    const previousCoverHeight = root.style.getPropertyValue('--profile-cover-height');
    const previousCoverH = root.style.getPropertyValue('--profile-cover-h');

    let frame = 0;
    let lastIcons = null;
    let lastCoverHeight = -1;
    let lastHeaderHeight = -1;
    /*
     * Elements that report how far they have passed under the header (see the
     * hook's comment). Measured in document coordinates with offsetTop, which
     * ignores transforms: the avatar scales and the content moves in a pull,
     * and neither may move the point the progress is measured from.
     */
    let trackers = [];
    let blurEls = [];
    let resizeObserver = null;
    const docTop = (el) => {
      let top = 0;
      for (let node = el; node; node = node.offsetParent) top += node.offsetTop;
      return top;
    };
    /*
     * Where a `position: sticky` element sits in the flow, before it sticks.
     * offsetTop includes the offset sticky applies while it is stuck, which
     * would move the point this is measured from as the page scrolls, so it is
     * worked out from the parent's content box and the element's own margin.
     */
    const stickyNaturalTop = (el) => {
      const parent = el.parentElement;
      if (!parent) return docTop(el);
      const parentStyle = window.getComputedStyle(parent);
      const own = window.getComputedStyle(el);
      return docTop(parent) + parent.clientTop
        + (Number.parseFloat(parentStyle.paddingTop) || 0)
        + (Number.parseFloat(own.marginTop) || 0);
    };
    const measureTrackers = (insetTop) => {
      const card = coverRef.current?.parentElement;
      if (!card) { trackers = []; blurEls = []; return; }
      trackers = Array.from(card.querySelectorAll('[data-exit-track]')).map((el) => {
        // Scroll position at which the element's top edge reaches the header's
        // bottom.
        const end = Math.max(1, (el.hasAttribute('data-exit-sticky') ? stickyNaturalTop(el) : docTop(el)) - insetTop);
        // `data-exit-after`: the element sits on the header's bottom line from
        // `end` (the page pins it there) and fades over that many px of scroll.
        // Otherwise it must be gone by `end`, and starts going `lead` px before.
        const after = Number.parseFloat(el.getAttribute('data-exit-after')) || 0;
        const lead = Number.parseFloat(el.getAttribute('data-exit-lead')) || DEFAULT_EXIT_LEAD_PX;
        const through = el.hasAttribute('data-exit-through') ? el.offsetHeight : 0;
        const start = after > 0 || through > 0 ? end : Math.max(0, end - lead);
        let span = Math.max(1, end - start);
        if (through > 0) span = through;
        else if (after > 0) span = after;
        return {
          el,
          name: el.getAttribute('data-exit-track'),
          start,
          span,
          inert: el.hasAttribute('data-exit-inert'),
          last: '',
        };
      });
      blurEls = Array.from(card.querySelectorAll('[data-cover-blur]'));
      for (const t of trackers) resizeObserver?.observe(t.el);
    };

    let coverHeight = 0;
    let headerHeight = 0;
    let trackerRetries = 20;
    // Scroll position at which the cover's own box pins, and how much further
    // its picture pans before the avatar's bottom reaches the header's bottom.
    let boxPinAt = 1;
    let extend = 0;
    let lastExtend = -1;
    let lastTop = '';
    let lastPan = '';
    let lastBlur = '';

    /*
     * Sizes: measured on mount, on resize and when the cover or header resizes
     * - never per scroll event, where a layout read would be forced in every
     * frame of a fling. offsetHeight/offsetTop ignore transforms (the pull's
     * zoom, the pan), so they never move the points measured from.
     */
    const measure = () => {
      const cover = coverRef.current;
      coverHeight = cover?.offsetHeight || 0;
      headerHeight = header.offsetHeight;
      if (!coverBackground || !cover) return;
      if (coverHeight !== lastCoverHeight || headerHeight !== lastHeaderHeight) {
        lastCoverHeight = coverHeight;
        lastHeaderHeight = headerHeight;
        root.style.setProperty('--profile-cover-height', `${coverHeight}px`);
        root.style.setProperty('--profile-cover-h', String(Math.max(1, coverHeight)));
        header.style.setProperty('--cover-h', String(Math.max(1, coverHeight)));
      }
      // Where the sticky cover sits in the flow: offsetTop would include the
      // offset sticky applies while it is stuck, so it is read from the
      // element that follows it (never sticky), minus the cover's height.
      const next = cover.nextElementSibling;
      const coverTop = next instanceof HTMLElement
        ? docTop(next) - (Number.parseFloat(window.getComputedStyle(next).marginTop) || 0) - coverHeight
        : docTop(cover);
      boxPinAt = Math.max(1, coverTop + coverHeight - headerHeight);
      const avatar = cover.parentElement?.querySelector('[data-cover-avatar]');
      const avatarBottom = avatar && avatar.offsetHeight > 0 ? docTop(avatar) + avatar.offsetHeight : 0;
      extend = Math.max(0, Math.round(avatarBottom - headerHeight - boxPinAt));
      if (extend !== lastExtend) {
        lastExtend = extend;
        cover.style.setProperty('--cover-extend', `${extend}px`);
      }
      // The box pins with only the header's height of it left on screen.
      const top = `${headerHeight - coverHeight}px`;
      if (top !== lastTop) {
        lastTop = top;
        cover.style.setProperty('--cover-pin-top', top);
      }
      // Cheap, and what the name's height does when its web font arrives.
      measureTrackers(headerHeight);
    };

    const update = () => {
      const range = Math.max(1, coverHeight - headerHeight) * collapseRangeMultiplier;
      const progress = clamp01(window.scrollY / range);
      header.style.setProperty('--collapse', progress.toFixed(3));
      if (coverBackground) {
        // The page can mount after this hook first measures, so keep looking
        // for the marked elements for a little while.
        if (trackers.length === 0 && trackerRetries-- > 0 && coverRef.current) measure();
        const scrolled = Math.max(0, window.scrollY);
        const pinAt = boxPinAt + extend;
        const pan = String(Math.round(Math.min(Math.max(0, scrolled - boxPinAt), extend) * 10) / 10);
        if (pan !== lastPan) {
          lastPan = pan;
          coverRef.current?.style.setProperty('--cover-pan', pan);
        }
        const blur = smoothstep(clamp01(scrolled / pinAt)).toFixed(3);
        if (blur !== lastBlur) {
          lastBlur = blur;
          for (const el of blurEls) el.style.setProperty('--cover-blur', blur);
        }
        for (const t of trackers) {
          const exit = clamp01((scrolled - t.start) / t.span).toFixed(3);
          if (exit === t.last) continue;
          t.last = exit;
          t.el.style.setProperty('--exit', exit);
          if (t.inert) t.el.style.pointerEvents = Number(exit) >= 0.5 ? 'none' : '';
          if (t.name === 'name') header.style.setProperty('--exit-name', exit);
        }
      }
      const dark = root.getAttribute('data-theme') === 'dark';
      // Over a photo the icons are light; over a plain cover (no picture) they
      // follow the theme.
      const onCover = coverBackground ? coverIsPhoto : progress < 0.5;
      const wanted = onCover || dark ? 'light' : 'dark';
      /*
       * Yields to anyone else's preference. A sheet over the cover (the
       * community's details page) asks for the icons ITS background needs
       * through useSystemBars; overwriting that left white icons on a white
       * sheet. The header writes only while the value is unset or still the
       * one it wrote itself, and takes over again once the other request is
       * gone (the observer below).
       */
      const current = root.getAttribute('data-status-bar-icons');
      if ((current === null || current === lastIcons) && current !== wanted) {
        root.setAttribute('data-status-bar-icons', wanted);
      }
      if (current === null || current === lastIcons) lastIcons = wanted;
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
        update();
      });
    };
    // Straight from the scroll event, which fires in the frame it describes.
    // Going through a requestAnimationFrame as well put the header a frame
    // further behind the page than it has to be.
    const onScroll = () => update();

    measure();
    update();
    // Claimed only once the setup above has run without throwing: a layout
    // effect that throws never gets its cleanup, so claiming first would leave
    // the attribute behind for the rest of the session.
    claimCoverAttributes(root, iconsBefore);
    window.addEventListener('scroll', onScroll, { passive: true });
    // Width only. A height-only resize is the keyboard (the WebView follows it
    // frame by frame), which moves none of what is measured here; measuring
    // reads layout, so doing it in every frame of the keyboard's slide forced a
    // style recalc of the page each time. Element size changes are the
    // ResizeObserver's below.
    let lastWidth = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      schedule();
    };
    window.addEventListener('resize', onResize);
    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    if (resizeObserver) {
      resizeObserver.observe(header);
      if (coverRef.current) resizeObserver.observe(coverRef.current);
      for (const t of trackers) resizeObserver.observe(t.el);
    }
    // A theme change flips which icons the solid header needs, and another
    // owner of the icon preference letting go (it removes the attribute) hands
    // it back to the header.
    const themeObserver = new MutationObserver(() => {
      if (!root.hasAttribute('data-status-bar-icons')) lastIcons = null;
      schedule();
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-status-bar-icons'] });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();
      themeObserver.disconnect();
      releaseCoverAttributes(root);
      if (coverBackground && coverAtMount) {
        coverAtMount.style.removeProperty('--cover-pin-top');
        coverAtMount.style.removeProperty('--cover-extend');
        coverAtMount.style.removeProperty('--cover-pan');
      }
      if (previousCoverHeight) root.style.setProperty('--profile-cover-height', previousCoverHeight);
      else root.style.removeProperty('--profile-cover-height');
      if (previousCoverH) root.style.setProperty('--profile-cover-h', previousCoverH);
      else root.style.removeProperty('--profile-cover-h');
    };
  }, [enabled, headerRef, coverRef, coverBackground, collapseRangeMultiplier, coverIsPhoto]);
}
