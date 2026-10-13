import { describe, it, expect } from 'vitest';
import { keyboardOverlaysPage } from '../keyboardOverlay';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

describe('keyboardOverlaysPage', () => {
  it('is true only for the installed app on Android, where nothing else makes room for the keyboard', () => {
    expect(keyboardOverlaysPage({ mobileBuild: true, userAgent: ANDROID })).toBe(true);
  });

  it('is false on iOS: the visual viewport and the Messages height formula already handle it', () => {
    expect(keyboardOverlaysPage({ mobileBuild: true, userAgent: IPHONE })).toBe(false);
  });

  it('is false on the website, Android included: the browser resizes the layout viewport there', () => {
    expect(keyboardOverlaysPage({ mobileBuild: false, userAgent: ANDROID })).toBe(false);
    expect(keyboardOverlaysPage({ mobileBuild: false, userAgent: DESKTOP })).toBe(false);
  });
});
