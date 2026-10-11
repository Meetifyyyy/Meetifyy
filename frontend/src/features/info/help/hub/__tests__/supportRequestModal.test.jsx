/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/hooks/useSheetDrag', () => ({ useSheetDrag: () => ({ current: null }) }));

const { auth, api } = vi.hoisted(() => ({
  auth: { currentUser: null },
  api: {
    getFormMeta: vi.fn(),
    submitRequest: vi.fn(),
    submitMyRequest: vi.fn(),
    uploadAttachment: vi.fn(),
  },
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@shared/api/apiClient', () => ({ supportApi: api }));

import SupportRequestModal from '../SupportRequestModal';

const META = {
  categories: [
    { value: 'TECHNICAL', label: 'Technical Issue' },
    { value: 'SAFETY_REPORTING', label: 'Safety & Reporting' },
    { value: 'COMMUNITIES', label: 'Communities' },
  ],
  attachments: { maxFiles: 5, maxBytesPerFile: 1024 * 1024, allowedMimeTypes: ['image/png'] },
};

function renderModal(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <SupportRequestModal kind="problem" onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onClose, client };
}

async function chooseCategory(label) {
  const trigger = await screen.findByRole('combobox');
  await waitFor(() => expect(trigger.disabled).toBe(false));
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

function type(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  auth.currentUser = { id: 'u1', displayName: 'Asha', email: 'asha@uni.edu' };
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getFormMeta.mockResolvedValue(META);
});
// jsdom has no layout; the dropdown scrolls its highlighted option into view.
Element.prototype.scrollIntoView = vi.fn();
afterEach(cleanup);

describe('SupportRequestModal', () => {
  it('validates before sending anything', async () => {
    renderModal();
    fireEvent.click(await screen.findByRole('button', { name: 'Send report' }));

    expect(await screen.findByText('Choose what this is about.')).toBeTruthy();
    expect(screen.getByText(/Add a short summary/)).toBeTruthy();
    expect(screen.getByText(/A little more detail/)).toBeTruthy();
    expect(api.submitMyRequest).not.toHaveBeenCalled();
    expect(api.submitRequest).not.toHaveBeenCalled();
  });

  it('files a signed-in problem as the account, with diagnostics and how often', async () => {
    api.submitMyRequest.mockResolvedValue({ ticketNumber: 'MFT-ABC123', type: 'PROBLEM', status: 'OPEN' });
    renderModal();
    await chooseCategory('Technical Issue');
    type('Summary', 'Photos fail');
    type('What happened?', 'Uploading a photo in chat spins forever and never sends.');
    fireEvent.click(screen.getByRole('button', { name: 'Every time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

    expect(await screen.findByText('MFT-ABC123')).toBeTruthy();
    expect(api.submitRequest).not.toHaveBeenCalled();
    const payload = api.submitMyRequest.mock.calls[0][0];
    expect(payload).toMatchObject({ type: 'PROBLEM', category: 'TECHNICAL', subject: 'Photos fail' });
    expect(payload.description).toMatch(/How often: Every time$/);
    expect(payload.browserInfo.platform).toBe('web');
    expect(payload).not.toHaveProperty('email');
    expect(document.body.textContent).toMatch(/Replies go to asha@uni\.edu/);
  });

  it('sends once however many times submit is pressed', async () => {
    let resolve;
    api.submitMyRequest.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderModal();
    await chooseCategory('Technical Issue');
    type('Summary', 'Photos fail');
    type('What happened?', 'Uploading a photo in chat spins forever and never sends.');
    const send = screen.getByRole('button', { name: 'Send report' });
    fireEvent.click(send);
    fireEvent.click(send);
    fireEvent.submit(send.closest('form'));
    expect(api.submitMyRequest).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ticketNumber: 'MFT-ONE111' }));
    expect(await screen.findByText('MFT-ONE111')).toBeTruthy();
  });

  it('keeps everything typed when the network fails, and says so', async () => {
    api.submitMyRequest.mockRejectedValue(Object.assign(new TypeError('Failed to fetch'), { status: 0 }));
    renderModal();
    await chooseCategory('Technical Issue');
    type('Summary', 'Photos fail');
    type('What happened?', 'Uploading a photo in chat spins forever and never sends.');
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(document.body.textContent).toMatch(/could not reach Meetifyy/);
    expect(screen.getByLabelText('Summary').value).toBe('Photos fail');
    expect(screen.getByRole('button', { name: 'Send report' }).disabled).toBe(false);
  });

  it('asks a signed-out visitor for a reply address and uses the public route', async () => {
    auth.currentUser = null;
    api.submitRequest.mockResolvedValue({ ticketNumber: 'MFT-GUEST1' });
    renderModal({ kind: 'idea' });
    type('Your name', 'Ravi');
    type('Email for our reply', 'ravi@example.com');
    await chooseCategory('Communities');
    type('Your idea in a line', 'Pin posts');
    type('Tell us more', 'Let community admins pin one post to the top of the feed.');
    fireEvent.click(screen.getByRole('button', { name: 'Send idea' }));

    expect(await screen.findByText('MFT-GUEST1')).toBeTruthy();
    expect(api.submitMyRequest).not.toHaveBeenCalled();
    expect(api.submitRequest.mock.calls[0][0]).toMatchObject({
      type: 'IDEA',
      category: 'COMMUNITIES',
      name: 'Ravi',
      email: 'ravi@example.com',
    });
  });

  it('does not offer Safety & Reporting as an idea area', async () => {
    renderModal({ kind: 'idea' });
    const trigger = await screen.findByRole('combobox');
    await waitFor(() => expect(trigger.disabled).toBe(false));
    fireEvent.click(trigger);
    expect(screen.queryByRole('option', { name: 'Safety & Reporting' })).toBeNull();
  });
});
