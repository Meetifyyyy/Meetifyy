import { useSystemBars } from '@shared/hooks/useSystemBars';

/**
 * Lets a Campus page's red banner run up under the status bar.
 *
 * `.headerBanner` pins itself to the top of the screen on a phone only while
 * the status strip is clear (CampusShared.module.css), the way the Campus hub's
 * does. Rendered next to the banner, so the strip is clear exactly while there
 * is a banner to sit behind it and not on the verify-your-college card.
 */
export default function CampusBannerBars() {
  useSystemBars({ status: 'transparent', statusIcons: 'light' });
  return null;
}
