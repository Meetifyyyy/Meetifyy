/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('react-easy-crop', () => ({ default: () => <div data-testid="cropper" /> }));
vi.mock('../cropImageUtils', () => ({
  getCroppedImg: vi.fn(async () => new Blob(['x'], { type: 'image/webp' })),
}));

const { default: MediaCropper } = await import('../MediaCropper');

const matchMediaStub = (reduced) =>
  vi.fn((query) => ({
    matches: reduced && /prefers-reduced-motion/.test(query),
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', matchMediaStub(false));
  URL.createObjectURL = vi.fn(() => 'blob:preview');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const setup = (props = {}) => {
  const onCancel = vi.fn();
  const onCropComplete = vi.fn();
  const utils = render(
    <MediaCropper imageFile="https://example.test/a.png" aspect={1} onCancel={onCancel} onCropComplete={onCropComplete} {...props} />,
  );
  return { ...utils, onCancel, onCropComplete };
};

describe('cropper dialog semantics', () => {
  it('is a labelled modal dialog with named close and zoom controls', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', { name: 'Crop Image' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    const zoom = screen.getByRole('slider', { name: 'Zoom' });
    expect(zoom.getAttribute('aria-valuetext')).toBe('100%');
  });

  it('moves focus into the dialog and gives it back on close', async () => {
    const opener = document.createElement('button');
    document.body.append(opener); opener.focus();
    const { unmount } = setup();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('Escape cancels', async () => {
    const { onCancel } = setup();
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape does not cancel while a crop is being produced', async () => {
    const { onCancel } = setup();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Apply Crop' }));
    await screen.findByText('Cropping...');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('cropper motion', () => {
  it('waits out its animation delays normally', async () => {
    const { onCropComplete } = setup();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Apply Crop' }));
    await new Promise((r) => setTimeout(r, 300));
    expect(onCropComplete).not.toHaveBeenCalled();
    await waitFor(() => expect(onCropComplete).toHaveBeenCalled(), { timeout: 1500 });
  });

  it('has no minimum spinner time and no fade delay under reduced motion, read at the time it is needed', async () => {
    const { onCropComplete } = setup();
    await screen.findByRole('dialog');
    // The preference changes after the dialog is already on screen.
    vi.stubGlobal('matchMedia', matchMediaStub(true));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Crop' }));
    await waitFor(() => expect(onCropComplete).toHaveBeenCalled(), { timeout: 250 });
  });
});
