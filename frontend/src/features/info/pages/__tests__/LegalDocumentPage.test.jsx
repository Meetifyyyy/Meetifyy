/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * The public legal page: the current published version from the API, the
 * bundled copy when the API fails, and the "Previous versions" list with its
 * read-only older-version view.
 */

const { legalApi } = vi.hoisted(() => ({
  legalApi: {
    getDocument: vi.fn(),
    listVersions: vi.fn(),
    getVersion: vi.fn(),
  },
}));

vi.mock('@shared/api/apiClient', () => ({ legalApi }));
// The layout pulls in the landing navbar and footer; this suite is about the
// document, so it renders the title and the body only.
vi.mock('../StaticDocLayout', () => ({
  default: ({ title, effectiveFrom, children }) => (
    <div>
      <h1>{title}</h1>
      {effectiveFrom && <p>Effective: {effectiveFrom}</p>}
      {children}
    </div>
  ),
}));

const CURRENT = {
  documentType: 'TERMS_OF_SERVICE',
  versionId: 'v-3',
  versionNumber: 3,
  title: 'Terms of Service',
  subtitle: 'The rules.',
  content: '<p>Published terms from the API.</p>',
  effectiveAt: '2026-10-18T00:00:00.000Z',
  publishedAt: '2026-10-18T00:00:00.000Z',
  lastUpdatedAt: '2026-10-18T00:00:00.000Z',
};
const HISTORY = [
  { versionId: 'v-3', versionNumber: 3, title: 'Terms of Service', effectiveAt: CURRENT.effectiveAt, changeSummary: 'Open signup.', isCurrent: true },
  { versionId: 'v-2', versionNumber: 2, title: 'Terms of Service', effectiveAt: '2026-08-01T00:00:00.000Z', changeSummary: 'Clarified messaging rules.', isCurrent: false },
];

async function renderPage(path = '/terms-and-conditions') {
  vi.resetModules();
  const { default: LegalDocumentPage } = await import('../LegalDocumentPage');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/terms-and-conditions"
          element={
            <LegalDocumentPage documentType="TERMS_OF_SERVICE" fallbackTitle="Terms of Service" />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LegalDocumentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
  });
  afterEach(() => cleanup());

  it('renders the current published version from the API', async () => {
    legalApi.getDocument.mockResolvedValue(CURRENT);
    legalApi.listVersions.mockResolvedValue(HISTORY);
    await renderPage();
    expect(await screen.findByText('Published terms from the API.')).toBeTruthy();
    expect(legalApi.getDocument).toHaveBeenCalledWith('TERMS_OF_SERVICE');
  });

  it('falls back to the bundled text when the API fails', async () => {
    legalApi.getDocument.mockRejectedValue(new Error('offline'));
    legalApi.listVersions.mockRejectedValue(new Error('offline'));
    await renderPage();
    await waitFor(() => expect(legalApi.getDocument).toHaveBeenCalled());
    expect(screen.getByText(/Welcome to Meetifyy/)).toBeTruthy();
    expect(screen.queryByText('Previous versions')).toBeNull();
  });

  it('lists previous versions, without the current one', async () => {
    legalApi.getDocument.mockResolvedValue(CURRENT);
    legalApi.listVersions.mockResolvedValue(HISTORY);
    await renderPage();
    expect(await screen.findByRole('heading', { name: 'Previous versions' })).toBeTruthy();
    const items = screen.getAllByRole('link');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Version 2');
    expect(items[0].textContent).toContain('Clarified messaging rules.');
  });

  it('opens an older version read-only, under a clear banner', async () => {
    legalApi.getDocument.mockResolvedValue(CURRENT);
    legalApi.listVersions.mockResolvedValue(HISTORY);
    legalApi.getVersion.mockResolvedValue({
      ...CURRENT,
      versionId: 'v-2',
      versionNumber: 2,
      isCurrent: false,
      content: '<p>The old terms.</p>',
      effectiveAt: '2026-08-01T00:00:00.000Z',
    });
    await renderPage();
    fireEvent.click(await screen.findByRole('link', { name: /Version 2/ }));
    expect(await screen.findByText('The old terms.')).toBeTruthy();
    expect(screen.getByText('This is an older version.')).toBeTruthy();
    expect(screen.queryByText('Published terms from the API.')).toBeNull();
    expect(legalApi.getVersion).toHaveBeenCalledWith('TERMS_OF_SERVICE', 2);

    fireEvent.click(screen.getByRole('link', { name: 'View the current version' }));
    expect(await screen.findByText('Published terms from the API.')).toBeTruthy();
    expect(screen.queryByText('This is an older version.')).toBeNull();
  });

  it('says so when an older version cannot be loaded', async () => {
    legalApi.getDocument.mockResolvedValue(CURRENT);
    legalApi.listVersions.mockResolvedValue(HISTORY);
    legalApi.getVersion.mockRejectedValue(new Error('404'));
    await renderPage('/terms-and-conditions?version=1');
    expect(await screen.findByText('We could not load that version')).toBeTruthy();
  });

  it('shows no older-version banner when N is the current version', async () => {
    legalApi.getDocument.mockResolvedValue(CURRENT);
    legalApi.listVersions.mockResolvedValue(HISTORY);
    legalApi.getVersion.mockResolvedValue({ ...CURRENT, isCurrent: true });
    await renderPage('/terms-and-conditions?version=3');
    expect(await screen.findByText('Published terms from the API.')).toBeTruthy();
    expect(screen.queryByText('This is an older version.')).toBeNull();
  });

  it('shows no older-version banner while only the bundled copy is known', async () => {
    legalApi.getDocument.mockReturnValue(new Promise(() => {}));
    legalApi.listVersions.mockReturnValue(new Promise(() => {}));
    legalApi.getVersion.mockReturnValue(new Promise(() => {}));
    await renderPage('/terms-and-conditions?version=3');
    await waitFor(() => expect(legalApi.getVersion).toHaveBeenCalled());
    expect(screen.queryByText('This is an older version.')).toBeNull();
  });
});
