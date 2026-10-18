/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

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
});
