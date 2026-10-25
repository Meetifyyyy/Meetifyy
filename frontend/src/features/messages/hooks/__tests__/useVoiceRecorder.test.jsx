/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const upload = vi.hoisted(() => vi.fn());
vi.mock('@shared/utils/mediaPipeline', () => ({
  uploadFileDirect: upload,
  isMediaRejection: (err) => err?.status === 413,
}));

const { useVoiceRecorder, clearKeptVoiceNotes } = await import('../useVoiceRecorder');

/** Just enough of MediaRecorder: a chunk per timeslice, onstop on stop(). */
class FakeRecorder {
  static last = null;
  constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; FakeRecorder.last = this; }
  start() {
    this.state = 'recording';
    this.timer = setInterval(() => this.ondataavailable?.({ data: new Blob(['a'], { type: this.mimeType }) }), 250);
  }
  stop() {
    clearInterval(this.timer);
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['z'], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  }
}

const track = { stop: vi.fn() };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  vi.useFakeTimers();
  upload.mockReset();
  clearKeptVoiceNotes();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
  URL.createObjectURL = vi.fn(() => `blob:take-${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function record(hook, ms) {
  await act(async () => { await hook.result.current.startRecording(); });
  await act(async () => { vi.advanceTimersByTime(ms); });
}

describe('voice note length cap', () => {
  it('counts down near the limit, then stops and keeps the recording without sending it', async () => {
    const onSend = vi.fn();
    const hook = renderHook(() => useVoiceRecorder({ onSend, showToast: vi.fn(), maxDurationMs: 60_000 }));
    await record(hook, 35_000);
    expect(hook.result.current.secondsLeft).toBe(25);
    await act(async () => { vi.advanceTimersByTime(25_200); });
    await flush();
    expect(hook.result.current.isRecording).toBe(false);
    expect(hook.result.current.take).toMatchObject({ reason: 'limit', durationSec: 60 });
    expect(hook.result.current.take.file.size).toBeGreaterThan(0);
    expect(upload).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it('sends the kept recording only when asked', async () => {
    upload.mockResolvedValue({ publicUrl: '/api/media/voice/a.webm' });
    const onSend = vi.fn();
    const hook = renderHook(() => useVoiceRecorder({ onSend, showToast: vi.fn(), maxDurationMs: 10_000 }));
    await record(hook, 10_200);
    await flush();
    const kept = hook.result.current.take.file;
    await act(async () => { hook.result.current.sendRecording(); });
    await flush();
    expect(upload).toHaveBeenCalledWith(kept, 'voice', null, expect.any(AbortSignal), null, { duration: 10 });
    expect(onSend).toHaveBeenCalledWith('/api/media/voice/a.webm', 'audio', 10);
    expect(hook.result.current.take).toBeNull();
  });

  it('lets the person delete it instead', async () => {
    const hook = renderHook(() => useVoiceRecorder({ onSend: vi.fn(), showToast: vi.fn(), maxDurationMs: 5_000 }));
    await record(hook, 5_200);
    await flush();
    act(() => { hook.result.current.deleteRecording(); });
    expect(hook.result.current.take).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe('a recording is not lost', () => {
  it('stays after a failed upload, and the next Send retries the same file', async () => {
    upload.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ publicUrl: '/api/media/voice/b.webm' });
    const toast = vi.fn();
    const onSend = vi.fn();
    const hook = renderHook(() => useVoiceRecorder({ onSend, showToast: toast }));
    await record(hook, 3_000);
    await act(async () => { hook.result.current.sendRecording(); });
    await flush();
    await flush();
    expect(toast).toHaveBeenCalledWith("Couldn't send voice note. Tap send to try again.");
    const kept = hook.result.current.take;
    expect(kept).not.toBeNull();
    await act(async () => { hook.result.current.sendRecording(); });
    await flush();
    expect(upload.mock.calls[1][0]).toBe(kept.file);
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('survives leaving the chat and is there on coming back', async () => {
    const first = renderHook(() => useVoiceRecorder({ onSend: vi.fn(), showToast: vi.fn(), keepKey: 'chat:c1' }));
    await record(first, 2_000);
    first.unmount();
    const again = renderHook(() => useVoiceRecorder({ onSend: vi.fn(), showToast: vi.fn(), keepKey: 'chat:c1' }));
    expect(again.result.current.take).toMatchObject({ reason: 'left' });
    const other = renderHook(() => useVoiceRecorder({ onSend: vi.fn(), showToast: vi.fn(), keepKey: 'chat:c2' }));
    expect(other.result.current.take).toBeNull();
  });

  it('stays with its own chat when the composer is reused for another one', async () => {
    let key = 'chat:c1';
    const hook = renderHook(() => useVoiceRecorder({ onSend: vi.fn(), showToast: vi.fn(), keepKey: key }));
    await record(hook, 2_000);
    key = 'chat:c2';
    hook.rerender();
    expect(hook.result.current.take).toBeNull();
    expect(hook.result.current.isRecording).toBe(false);
    key = 'chat:c1';
    hook.rerender();
    expect(hook.result.current.take).toMatchObject({ reason: 'left' });
  });

  it('keeps what was captured when the recorder fails', async () => {
    const toast = vi.fn();
    const hook = renderHook(() => useVoiceRecorder({ onSend: vi.fn(), showToast: toast }));
    await record(hook, 1_000);
    act(() => { FakeRecorder.last.onerror({ error: new Error('device lost') }); });
    expect(hook.result.current.take).toMatchObject({ reason: 'error' });
    expect(toast).toHaveBeenCalledWith('Recording stopped. What was recorded is kept.');
  });

  it('refuses a voice note over 15 MB and keeps it', async () => {
    const toast = vi.fn();
    const hook = renderHook(() => useVoiceRecorder({ onSend: vi.fn(), showToast: toast, maxDurationMs: 1_000 }));
    await record(hook, 1_200);
    await flush();
    Object.defineProperty(hook.result.current.take.file, 'size', { value: 15 * 1024 * 1024 + 1 });
    await act(async () => { hook.result.current.sendRecording(); });
    expect(toast).toHaveBeenCalledWith('Voice note must be 15 MB or less');
    expect(upload).not.toHaveBeenCalled();
    expect(hook.result.current.take).not.toBeNull();
  });

  it('will not start a new recording over a kept one', async () => {
    const hook = renderHook(() => useVoiceRecorder({ onSend: vi.fn(), showToast: vi.fn(), maxDurationMs: 1_000 }));
    await record(hook, 1_200);
    await flush();
    const gum = navigator.mediaDevices.getUserMedia;
    gum.mockClear();
    await act(async () => { await hook.result.current.startRecording(); });
    expect(gum).not.toHaveBeenCalled();
  });
});
