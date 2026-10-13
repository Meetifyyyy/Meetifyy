/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The notice is a website surface. The installed app shares the same `App`
 * tree, so it must opt out here rather than inherit a cookie banner for a
 * technology (cookies, Vercel analytics) it does not use.
 */
async function renderBanner({ mobile, stored = null }) {
  vi.resetModules();
  vi.doMock('@config', async (orig) => ({ ...(await orig()), IS_MOBILE_BUILD: mobile }));
  localStorage.clear();
  if (stored) localStorage.setItem('meetifyy_consent', JSON.stringify(stored));
  const { default: CookieBanner } = await import('../CookieBanner');
  const { CookieConsentProvider } = await import('@shared/context/CookieConsentContext');
  return render(
    <MemoryRouter>
      <CookieConsentProvider>
        <CookieBanner />
      </CookieConsentProvider>
    </MemoryRouter>,
  );
}

describe('CookieBanner', { timeout: 20_000 }, () => {
  afterEach(() => cleanup());
  beforeEach(() => localStorage.clear());

  it('shows on a first visit to the website', async () => {
    await renderBanner({ mobile: false });
    expect(screen.getByRole('region', { name: /privacy notice/i })).toBeTruthy();
  });

  it('stays hidden once the current version was acknowledged', async () => {
    await renderBanner({ mobile: false, stored: { version: '1.1', acknowledgedAt: '2026-10-11T00:00:00Z' } });
    expect(screen.queryByRole('region', { name: /privacy notice/i })).toBeNull();
  });

  it('shows again when the acknowledged version is out of date', async () => {
    await renderBanner({ mobile: false, stored: { version: '1.0', acknowledgedAt: '2026-01-01T00:00:00Z' } });
    expect(screen.getByRole('region', { name: /privacy notice/i })).toBeTruthy();
  });

  it('never shows in the installed app', async () => {
    await renderBanner({ mobile: true });
    expect(screen.queryByRole('region', { name: /privacy notice/i })).toBeNull();
  });
});

describe('CookiePreferencesModal links', () => {
  afterEach(() => cleanup());

  async function openModal(mobile) {
    vi.resetModules();
    vi.doMock('@config', async (orig) => ({ ...(await orig()), IS_MOBILE_BUILD: mobile }));
    localStorage.clear();
    const { CookiePreferencesModal } = await import('../CookieBanner');
    const { CookieConsentProvider, useCookieConsent } = await import('@shared/context/CookieConsentContext');
    const Opener = () => {
      const { openPreferences } = useCookieConsent();
      return <button onClick={openPreferences}>open</button>;
    };
    render(
      <MemoryRouter>
        <CookieConsentProvider>
          <Opener />
          <CookiePreferencesModal />
        </CookieConsentProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('open'));
  }

  it('points the website at the Cookie Policy', { timeout: 20_000 }, async () => {
    await openModal(false);
    expect(screen.getAllByRole('link', { name: 'Cookie Policy' }).length).toBeGreaterThan(0);
  });

  it('never links the app to a Cookie Policy', { timeout: 20_000 }, async () => {
    await openModal(true);
    expect(screen.queryByRole('link', { name: 'Cookie Policy' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' }).length).toBeGreaterThan(0);
  });
});
