/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { initialOffset, resolveSheetSnap, snapOffset } from '../components/coverSheetSnap';

vi.mock('@shared/components/avatar/Avatar', () => ({ default: () => <span data-testid="avatar" /> }));
vi.mock('@shared/components/ui/CoverImage', () => ({ default: () => <div data-testid="cover" /> }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));

const { default: CoverEditorSheet } = await import('../components/CoverEditorSheet');
const { COVER_GRADIENTS, COVER_PATTERNS, selectable } = await import('@shared/lib/covers/profileCovers');

let phone = false;

beforeEach(() => {
  phone = false;
  window.matchMedia = (q) => ({
    matches: q.includes('reduced-motion') ? true : phone,
    addEventListener() {},
    removeEventListener() {},
  });
});

afterEach(cleanup);

function renderSheet(props = {}) {
  const onSave = vi.fn();
  const onPhoto = vi.fn();
  const onClose = vi.fn();
  render(
    <CoverEditorSheet isOpen onClose={onClose} cover={null} avatar="" name="Asha" upload={null}
      onSave={onSave} onPhoto={onPhoto} {...props} />,
  );
  return { onSave, onPhoto, onClose, dialog: screen.getByRole('dialog') };
}

describe('CoverEditorSheet', () => {
  it('has no Photo section; Upload sits beside Save in the footer', () => {
    const { dialog } = renderSheet();
    expect(within(dialog).queryByRole('heading', { name: 'Photo' })).toBeNull();
    expect(within(dialog).queryByText('Upload photo')).toBeNull();
    const upload = within(dialog).getByRole('button', { name: 'Upload' });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(upload.parentElement).toBe(save.parentElement);
    // Upload first (left), Save second (right).
    expect(upload.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Upload opens the file picker and hands the chosen file to onPhoto', () => {
    const { dialog, onPhoto } = renderSheet();
    const input = dialog.querySelector('input[type="file"]');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(click).toHaveBeenCalledTimes(1);

    const file = new File(['x'], 'c.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onPhoto).toHaveBeenCalledWith(file);
  });

  it('a cancelled picker does nothing', () => {
    const { dialog, onPhoto } = renderSheet();
    fireEvent.change(dialog.querySelector('input[type="file"]'), { target: { files: [] } });
    expect(onPhoto).not.toHaveBeenCalled();
  });

  it('shows upload progress and disables Upload while one runs', () => {
    const { dialog } = renderSheet({ upload: 42.4 });
    const btn = within(dialog).getByRole('button', { name: /Uploading… 42%/ });
    expect(btn.disabled).toBe(true);
  });

  it('Save is disabled until a different design is picked, then saves its CSS', () => {
    const { dialog, onSave } = renderSheet();
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save.disabled).toBe(true);
    const pattern = selectable(COVER_PATTERNS)[0];
    const tile = within(within(dialog).getByRole('group', { name: 'Patterns' })).getByRole('button', { name: pattern.label });
    fireEvent.click(tile);
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(pattern.css);
  });

  it('lists every selectable pattern and gradient with a label', () => {
    const { dialog } = renderSheet();
    const patterns = within(dialog).getByRole('group', { name: 'Patterns' });
    const gradients = within(dialog).getByRole('group', { name: 'Gradients' });
    expect(within(patterns).getAllByRole('button')).toHaveLength(selectable(COVER_PATTERNS).length);
    expect(within(gradients).getAllByRole('button')).toHaveLength(selectable(COVER_GRADIENTS).length);
  });

  it('on phones the sheet is placed by transform, not a CSS entrance', () => {
    phone = true;
    const { dialog } = renderSheet();
    expect(dialog.style.transform).toMatch(/translate3d/);
    expect(dialog.style.animation).toBe('none');
  });

  it('on wider screens no inline transform is applied', () => {
    const { dialog } = renderSheet();
    expect(dialog.style.transform).toBe('');
  });
});

describe('resolveSheetSnap', () => {
  const base = { initial: 100, visible: 700 };

  it('settles to the nearer of full and initial on a slow release', () => {
    expect(resolveSheetSnap({ ...base, y: 30 })).toBe('full');
    expect(resolveSheetSnap({ ...base, y: 70 })).toBe('initial');
    expect(resolveSheetSnap({ ...base, y: 150, from: 'full' })).toBe('initial');
  });

  it('closes a quarter of the visible height below the opening height', () => {
    expect(resolveSheetSnap({ ...base, y: 100 + 176 })).toBe('close');
    expect(resolveSheetSnap({ ...base, y: 100 + 170 })).toBe('initial');
  });

  it('a downward flick closes from the opening height, but only collapses from full', () => {
    expect(resolveSheetSnap({ ...base, y: 120, velocity: 1 })).toBe('close');
    expect(resolveSheetSnap({ ...base, y: 120, velocity: 1, from: 'full' })).toBe('initial');
    expect(resolveSheetSnap({ ...base, y: 20, velocity: 1, from: 'full' })).toBe('initial');
  });

  it('an upward flick expands', () => {
    expect(resolveSheetSnap({ ...base, y: 90, velocity: -1 })).toBe('full');
  });

  it('a sheet whose content fits never expands', () => {
    expect(resolveSheetSnap({ initial: 0, visible: 500, y: 0, velocity: -2 })).toBe('initial');
    expect(resolveSheetSnap({ initial: 0, visible: 500, y: 200 })).toBe('close');
  });

  it('snapOffset and initialOffset', () => {
    expect(snapOffset('full', { initial: 100, height: 800 })).toBe(0);
    expect(snapOffset('initial', { initial: 100, height: 800 })).toBe(100);
    expect(snapOffset('close', { initial: 100, height: 800 })).toBe(824);
    // Tall content opens at the 88% cap.
    expect(initialOffset({ height: 820, natural: 2000, viewport: 844 })).toBe(Math.round(820 - 844 * 0.88));
    // Short content opens at its own height.
    expect(initialOffset({ height: 820, natural: 500, viewport: 844 })).toBe(320);
    // Never higher than 16px below the top inset.
    expect(initialOffset({ height: 600, natural: 2000, viewport: 900 })).toBe(16);
  });
});
