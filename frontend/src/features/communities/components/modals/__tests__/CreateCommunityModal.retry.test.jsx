/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { createSubmissionKey } from '@shared/lib/idempotencyKey';

/**
 * A retry after a failed "Create" must send the byte-identical body, so it
 * carries the same idempotency key and the server replays the first result
 * instead of creating a second community. The avatar used to be uploaded again
 * on every submit, giving each attempt a new URL and therefore a new key.
 */

const { addCommunity, processAndUploadImage, generateInitialAvatarFile, sent } = vi.hoisted(() => ({
  addCommunity: vi.fn(),
  processAndUploadImage: vi.fn(),
  generateInitialAvatarFile: vi.fn(),
  sent: [],
}));

vi.mock('@shared/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', verificationStatus: 'VERIFIED' } }),
}));
vi.mock('@shared/hooks/useCommunityActions', () => ({
  useCommunityActions: () => ({ addCommunity }),
}));
vi.mock('@shared/utils/mediaPipeline', () => ({ processAndUploadImage }));
vi.mock('@shared/utils/generateAvatarImage', () => ({ generateInitialAvatarFile }));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/stores/verificationModalStore', () => ({ openVerificationModal: vi.fn() }));

import CreateCommunityModal from '../CreateCommunityModal';

let submissionKey;

beforeEach(() => {
  sent.length = 0;
  submissionKey = createSubmissionKey();
  let uploads = 0;
  // Each upload lands at a new storage URL, as the real pipeline does.
  processAndUploadImage.mockReset().mockImplementation(async () => {
    uploads += 1;
    return { publicUrl: `https://cdn.example/communities/avatar-${uploads}.webp` };
  });
  generateInitialAvatarFile.mockReset().mockImplementation(
    async (name) => new File([name], 'community-default-avatar.png', { type: 'image/png' }),
  );
  // Mirrors useCommunityActions: the key is derived from the exact body sent.
  addCommunity.mockReset().mockImplementation(async (data) => {
    sent.push({ data, key: submissionKey.keyFor(data) });
    if (sent.length === 1) throw new Error('Network request failed');
    submissionKey.done();
    return 'community-1';
  });
});

afterEach(() => cleanup());

async function fillWizard(name = 'Hiking Club') {
  fireEvent.click(screen.getByText('Technology'));
  fireEvent.click(screen.getByText('Continue'));
  fireEvent.change(document.querySelector('input[type="text"]'), { target: { value: name } });
  fireEvent.change(document.querySelector('textarea'), { target: { value: 'Weekend trails and day hikes' } });
  fireEvent.click(screen.getByText('Continue'));
  fireEvent.click(screen.getByText('Continue'));
}

async function clickCreateAndSettle(expectedCalls) {
  fireEvent.click(await screen.findByText('Create'));
  await waitFor(() => expect(addCommunity).toHaveBeenCalledTimes(expectedCalls));
  await screen.findByText('Create');
}

describe('CreateCommunityModal retry', () => {
  it('re-sends the identical body, and so the same key, after a failed create', async () => {
    const onCreated = vi.fn();
    render(<CreateCommunityModal onClose={vi.fn()} onCreated={onCreated} />);
    await fillWizard();

    await clickCreateAndSettle(1);
    await clickCreateAndSettle(2);

    expect(processAndUploadImage).toHaveBeenCalledTimes(1);
    expect(sent[1].data).toEqual(sent[0].data);
    expect(JSON.stringify(sent[1].data)).toBe(JSON.stringify(sent[0].data));
    expect(sent[1].key).toBe(sent[0].key);
    expect(sent[0].data.avatarKey).toBe('https://cdn.example/communities/avatar-1.webp');
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('community-1'));
  });

  it('uploads a new avatar when the inputs it was generated from change', async () => {
    render(<CreateCommunityModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await fillWizard('Hiking Club');
    await clickCreateAndSettle(1);

    // Back to the name step and rename: the generated avatar shows the new
    // initial, so the cached upload must not be reused.
    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(screen.getByText('Back'));
    fireEvent.change(document.querySelector('input[type="text"]'), { target: { value: 'Running Club' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    await clickCreateAndSettle(2);

    expect(processAndUploadImage).toHaveBeenCalledTimes(2);
    expect(sent[1].data.avatarKey).toBe('https://cdn.example/communities/avatar-2.webp');
    expect(sent[1].key).not.toBe(sent[0].key);
  });
});
