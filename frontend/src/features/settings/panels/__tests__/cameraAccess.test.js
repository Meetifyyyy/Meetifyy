import { describe, expect, it, vi } from 'vitest';
import {
  getCameraErrorMessage,
  readCameraPermissionState,
  requestCameraStream,
} from '../cameraAccess';

describe('requestCameraStream', () => {
  it('calls getUserMedia immediately without querying permission first', async () => {
    const stream = { getTracks: () => [] };
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    const mediaDevices = { getUserMedia };

    const pending = requestCameraStream(mediaDevices, 'user');

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    await expect(pending).resolves.toBe(stream);
  });

  it('does not retry a denied request', async () => {
    const denial = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const getUserMedia = vi.fn(() => Promise.reject(denial));

    await expect(requestCameraStream({ getUserMedia })).rejects.toBe(denial);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('retries only unsupported constraints with basic video constraints', async () => {
    const constraintError = Object.assign(new Error('constraints'), {
      name: 'OverconstrainedError',
    });
    const stream = { getTracks: () => [] };
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(constraintError)
      .mockResolvedValueOnce(stream);

    await expect(requestCameraStream({ getUserMedia }, 'environment')).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: true, audio: false });
  });
});

describe('camera permission diagnosis', () => {
  it('treats unsupported and invalid permission states as unknown, not denied', async () => {
    await expect(readCameraPermissionState(undefined)).resolves.toBe('unknown');
    await expect(
      readCameraPermissionState({ query: vi.fn().mockRejectedValue(new TypeError()) }),
    ).resolves.toBe('unknown');
    await expect(
      readCameraPermissionState({ query: vi.fn().mockResolvedValue({ state: undefined }) }),
    ).resolves.toBe('unknown');
  });

  it('only gives permanent-block instructions for a confirmed denied state', () => {
    const error = { name: 'NotAllowedError' };

    expect(getCameraErrorMessage(error, { permissionState: 'prompt' })).toContain(
      'choose “Allow”',
    );
    expect(getCameraErrorMessage(error, { permissionState: 'unknown' })).toContain(
      'choose “Allow”',
    );
    expect(getCameraErrorMessage(error, { permissionState: 'denied' })).toContain(
      'site settings',
    );
  });

  it('distinguishes missing, busy, security, and interrupted cameras', () => {
    expect(getCameraErrorMessage({ name: 'NotFoundError' })).toContain('No camera');
    expect(getCameraErrorMessage({ name: 'NotReadableError' })).toContain('in use');
    expect(getCameraErrorMessage({ name: 'SecurityError' })).toContain('HTTPS');
    expect(getCameraErrorMessage({ name: 'AbortError' })).toContain('interrupted');
  });
});
