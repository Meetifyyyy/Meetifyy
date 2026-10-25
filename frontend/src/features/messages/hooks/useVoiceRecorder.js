import { useState, useRef, useEffect, useCallback } from 'react';
import { uploadFileDirect, isMediaRejection } from '@shared/utils/mediaPipeline';
import { VOICE_NOTE_MAX_BYTES, VOICE_NOTE_MAX_MS, VOICE_NOTE_SIZE_MESSAGE } from '@shared/constants/mediaLimits';

/**
 * Voice-note recording built on the native MediaRecorder API, with a live
 * amplitude analyser (Web Audio API) driving the recording waveform.
 *
 * Everything the recorder owns — the mic stream, the AudioContext, the timer
 * and any in-flight upload — is torn down through a single `cleanup()` path so
 * cancelling, sending, an error, or unmounting all release the microphone.
 */

// Candidates in preference order. Chrome/Firefox land on webm/opus, Safari on
// mp4 (or its aac variant); the empty string lets the browser pick its own
// default if it disagrees with every explicit type we offer.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  '',
];

const pickMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of MIME_CANDIDATES) {
    if (!type) return '';
    if (typeof MediaRecorder.isTypeSupported !== 'function') return type;
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
};

const extForMime = (mimeType = '') => {
  const t = mimeType.toLowerCase();
  if (t.includes('mp4') || t.includes('aac') || t.includes('m4a')) return 'm4a';
  if (t.includes('ogg')) return 'ogg';
  if (t.includes('wav')) return 'wav';
  if (t.includes('mpeg')) return 'mp3';
  return 'webm';
};

// getUserMedia rejection reasons vary by browser; map them to something a user
// can act on rather than surfacing the raw DOMException name.
const micErrorMessage = (err) => {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found.';
    case 'NotReadableError':
      return 'Your microphone is already in use by another app.';
    case 'AbortError':
      return 'Could not start recording. Please try again.';
    default:
      return 'Could not access the microphone.';
  }
};

// Number of amplitude samples kept for the live waveform. The UI renders the
// tail of this buffer, so it scrolls rather than rescaling as time passes.
export const WAVEFORM_SAMPLES = 72;

// How often a new amplitude sample is appended, in ms. Also the interval the
// waveform interpolates across to scroll continuously between samples.
export const PUSH_INTERVAL_MS = 40;

const MAX_RECORDING_MS = VOICE_NOTE_MAX_MS;

/** How long before the cap the composer starts counting down. */
export const RECORDING_WARN_BEFORE_MS = 30 * 1000;

/**
 * Finished recordings waiting for the person to send or delete them, by the
 * composer's `keepKey` (one per chat). Memory only, for this session.
 *
 * A recording used to be thrown away by everything except a successful send:
 * reaching the length cap sent it unasked, a failed upload discarded it, a
 * recorder error discarded it, and leaving the chat discarded it. Now only
 * Delete does.
 */
const keptTakes = new Map();

const revoke = (url) => {
  if (url) { try { URL.revokeObjectURL(url); } catch (_) { /* already revoked */ } }
};

/** Drops every kept recording. Called at sign-out: they belong to that account. */
export function clearKeptVoiceNotes() {
  for (const take of keptTakes.values()) revoke(take.url);
  keptTakes.clear();
}

/** A sendable recording from the chunks collected so far, or null when there are none. */
function buildTake(chunks, recorderMime, durationSec, reason) {
  if (!chunks?.length) return null;
  const mimeType = recorderMime || chunks[0]?.type || 'audio/webm';
  const blob = new Blob(chunks, { type: mimeType });
  const file = new File([blob], `voicenote_${Date.now()}.${extForMime(mimeType)}`, { type: mimeType });
  let url = null;
  try { url = URL.createObjectURL(file); } catch (_) { /* no preview */ }
  return { file, url, durationSec, reason };
}

export function useVoiceRecorder({ onSend, showToast, maxDurationMs = MAX_RECORDING_MS, keepKey = null } = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  // A stopped recording held for the person: { file, url, durationSec, reason }.
  const [take, setTakeState] = useState(() => (keepKey && keptTakes.get(keepKey)) || null);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);

  // Live amplitude ring buffer. Kept in a ref (not state) so the waveform can
  // animate at display refresh rate without re-rendering the chat input.
  const levelsRef = useRef(new Float32Array(WAVEFORM_SAMPLES));
  const levelRafRef = useRef(null);

  const uploadAbortRef = useRef(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const takeRef = useRef(take);
  const keepKeyRef = useRef(keepKey);

  const notify = useCallback((msg) => {
    if (toastRef.current) toastRef.current(msg);
  }, []);

  /** Holds `next` as the pending recording, for this chat, in state and in the session store. */
  const setTake = useCallback((next) => {
    takeRef.current = next;
    const key = keepKeyRef.current;
    if (key) {
      if (next) keptTakes.set(key, next);
      else keptTakes.delete(key);
    }
    if (mountedRef.current) setTakeState(next);
  }, []);

  /** Forgets the pending recording and frees its preview. */
  const discardTake = useCallback(() => {
    const current = takeRef.current;
    setTake(null);
    revoke(current?.url);
  }, [setTake]);

  const stopLevelLoop = useCallback(() => {
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
  }, []);

  const teardownAudioGraph = useCallback(() => {
    stopLevelLoop();
    try { sourceRef.current?.disconnect(); } catch (_) { /* already detached */ }
    try { analyserRef.current?.disconnect(); } catch (_) { /* already detached */ }
    sourceRef.current = null;
    analyserRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== 'closed') {
      // close() is async and can reject if the context is already closing.
      Promise.resolve(ctx.close()).catch(() => {});
    }
    levelsRef.current = new Float32Array(WAVEFORM_SAMPLES);
  }, [stopLevelLoop]);

  const releaseStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Full teardown: safe to call repeatedly and from any state.
  const cleanup = useCallback(() => {
    clearTimer();
    teardownAudioGraph();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try { recorder.stop(); } catch (_) { /* already stopped */ }
    }
    releaseStream();
    chunksRef.current = [];
  }, [clearTimer, teardownAudioGraph, releaseStream]);

  /** Seconds recorded so far, never past the cap. */
  const elapsedSeconds = useCallback(() => {
    const capSec = maxDurationMs > 0 ? Math.round(maxDurationMs / 1000) : Infinity;
    return Math.min(capSec, Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)));
  }, [maxDurationMs]);

  /**
   * Ends a recording that is still running, synchronously, as a kept take
   * built from what has been captured (the recorder flushes every 250 ms, so
   * at most that much of the tail is missing). For the paths that cannot wait
   * for `onstop`: leaving the chat, unmounting.
   */
  const keepRunningRecording = useCallback((reason) => {
    const recorder = recorderRef.current;
    if (!recorder || cancelledRef.current) return null;
    return buildTake(chunksRef.current, recorder.mimeType, elapsedSeconds(), reason);
  }, [elapsedSeconds]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // A recording still running when the composer goes away is kept for this
      // chat, not thrown away; so is one whose upload this unmount interrupts.
      const running = keepRunningRecording('left');
      const key = keepKeyRef.current;
      if (running && key) keptTakes.set(key, running);
      else revoke(running?.url);
      mountedRef.current = false;
      cancelledRef.current = true;
      uploadAbortRef.current?.abort();
      cleanup();
    };
  }, [cleanup, keepRunningRecording]);

  /*
   * The composer is not remounted per chat, so a different `keepKey` means the
   * person switched chats under it. Whatever they recorded stays with the chat
   * it was recorded in, and the new chat shows its own (if any).
   *
   * Except a new conversation getting its real id on its first send: that is
   * the same thread, and its recording moves with it.
   */
  useEffect(() => {
    const previous = keepKeyRef.current;
    if (previous === keepKey) return;
    keepKeyRef.current = keepKey;
    if (typeof previous === 'string' && previous.startsWith('chat:draft_') && keepKey) {
      keptTakes.delete(previous);
      if (takeRef.current) keptTakes.set(keepKey, takeRef.current);
      return;
    }
    const running = keepRunningRecording('left');
    cancelledRef.current = true;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    cleanup();
    const leaving = running || takeRef.current;
    if (previous && leaving) keptTakes.set(previous, leaving);
    else if (running) revoke(running.url);
    const arriving = (keepKey && keptTakes.get(keepKey)) || null;
    takeRef.current = arriving;
    setTakeState(arriving);
    setIsRecording(false);
    setIsUploading(false);
    setRecordingTime(arriving ? arriving.durationSec : 0);
  }, [keepKey, keepRunningRecording, cleanup]);

  /** Samples the analyser once per frame into the ring buffer. */
  const startLevelLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buffer = new Uint8Array(analyser.fftSize);
    let lastPush = 0;
    // Running envelope. Smoothing has to happen HERE, on the value about to be
    // appended — never per slot in the ring buffer. The buffer scrolls, so slot
    // i holds a different sample after every shift; easing a slot toward "its"
    // target therefore chases a value that keeps moving, which is what made the
    // waveform shimmer and jitter instead of gliding.
    let envelope = 0;

    const tick = (now) => {
      levelRafRef.current = requestAnimationFrame(tick);
      const a = analyserRef.current;
      if (!a) return;
      // Fixed sample cadence, so the scroll speed is identical on a 60Hz and a
      // 120Hz display.
      if (now - lastPush < PUSH_INTERVAL_MS) return;
      lastPush = now;

      a.getByteTimeDomainData(buffer);
      // RMS around the 128 zero-point → perceived loudness, 0..1.
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      // Mild curve so quiet speech is still visible without clipping loud peaks.
      const level = Math.min(1, Math.pow(rms, 0.7) * 2.2);

      // Fast attack, slower release — a natural VU response, applied once.
      envelope += (level - envelope) * (level > envelope ? 0.55 : 0.22);

      const levels = levelsRef.current;
      levels.copyWithin(0, 1);
      levels[levels.length - 1] = envelope;
    };

    levelRafRef.current = requestAnimationFrame(tick);
  }, []);

  /**
   * Uploads a kept recording and hands it to `onSend`. On any failure the
   * recording stays, so Send tries again with the same file; only a success
   * (or Delete) lets it go.
   */
  const uploadTake = useCallback(async (pending) => {
    if (!pending || uploadAbortRef.current) return;
    if (pending.file.size > VOICE_NOTE_MAX_BYTES) {
      notify(VOICE_NOTE_SIZE_MESSAGE);
      return;
    }
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    cancelledRef.current = false;
    if (mountedRef.current) setIsUploading(true);
    try {
      const uploadRes = await uploadFileDirect(
        pending.file,
        'voice',
        null,
        controller.signal,
        null,
        { duration: pending.durationSec },
      );
      const publicUrl = uploadRes?.publicUrl || uploadRes?.url;
      if (controller.signal.aborted) return;
      if (!publicUrl) throw new Error('Upload returned no URL');
      if (takeRef.current === pending) discardTake();
      onSendRef.current?.(publicUrl, 'audio', pending.durationSec);
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      console.error('Failed to upload voice note:', err);
      notify(isMediaRejection(err) ? err.message : "Couldn't send voice note. Tap send to try again.");
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      if (mountedRef.current) setIsUploading(false);
    }
  }, [notify, discardTake]);

  /**
   * Stops the running recording. `send` uploads it straight away; `keep`
   * holds it for the person to play, send or delete.
   */
  const finishRecording = useCallback((mode, reason = null) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const durationSec = elapsedSeconds();
    clearTimer();
    // Stop the analyser immediately so the bars freeze the moment the user
    // hits send, while the recorder finishes flushing its last chunk.
    teardownAudioGraph();
    setIsRecording(false);
    setRecordingTime(durationSec);

    const finalize = () => {
      recorderRef.current = null;
      releaseStream();
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (cancelledRef.current) return;
      const next = buildTake(chunks, recorder.mimeType, durationSec, reason);
      if (!next) {
        notify('Recording was too short.');
        return;
      }
      setTake(next);
      if (mode === 'send') uploadTake(next);
    };

    if (recorder.state === 'inactive') {
      finalize();
    } else {
      recorder.onstop = finalize;
      try {
        recorder.stop();
      } catch (err) {
        console.error('Failed to stop recorder:', err);
        finalize();
      }
    }
  }, [elapsedSeconds, clearTimer, teardownAudioGraph, releaseStream, notify, setTake, uploadTake]);

  const startRecording = useCallback(async () => {
    // A kept recording is sent or deleted first: starting over must not
    // silently replace it.
    if (isRecording || isUploading || takeRef.current) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      notify('Voice recording is not supported in this browser.');
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      console.error('Microphone permission error:', err);
      notify(micErrorMessage(err));
      return;
    }

    // The user may have cancelled or navigated away while the permission
    // prompt was open — don't leave an orphaned mic stream running.
    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    try {
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = (event) => {
        console.error('MediaRecorder error:', event.error || event);
        // What was captured before the failure is kept, not thrown away.
        const salvaged = keepRunningRecording('error');
        cancelledRef.current = true;
        cleanup();
        if (mountedRef.current) setIsRecording(false);
        if (salvaged) {
          setTake(salvaged);
          if (mountedRef.current) setRecordingTime(salvaged.durationSec);
          notify('Recording stopped. What was recorded is kept.');
        } else {
          if (mountedRef.current) setRecordingTime(0);
          notify('Recording stopped unexpectedly.');
        }
      };

      // Timeslice keeps chunks flowing so a crash/cancel never strands a single
      // giant buffer, and gives Safari a reason to flush regularly.
      recorder.start(250);

      // Live waveform. Best-effort: if Web Audio is unavailable the recording
      // itself still works, the bars just stay flat.
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          // Autoplay policies can hand back a suspended context.
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.6;
          const source = ctx.createMediaStreamSource(stream);
          source.connect(analyser);
          // Not connected to ctx.destination — that would echo the mic aloud.
          audioCtxRef.current = ctx;
          analyserRef.current = analyser;
          sourceRef.current = source;
          levelsRef.current = new Float32Array(WAVEFORM_SAMPLES);
          startLevelLoop();
        }
      } catch (err) {
        console.warn('Live waveform unavailable:', err);
      }

      startedAtRef.current = Date.now();
      setRecordingTime(0);
      setIsRecording(true);

      clearTimer();
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setRecordingTime(Math.min(Math.floor(elapsed / 1000), Math.round(maxDurationMs / 1000)));
        /*
         * At the cap the recording STOPS and is kept. It used to be sent
         * unasked; whether a five-minute note goes out is the person's call.
         * The composer says why it stopped (`take.reason === 'limit'`).
         */
        if (maxDurationMs > 0 && elapsed >= maxDurationMs) {
          finishRecording('keep', 'limit');
        }
      }, 200);
    } catch (err) {
      console.error('Failed to start recording:', err);
      cleanup();
      setIsRecording(false);
      notify('Could not start recording.');
    }
  }, [isRecording, isUploading, notify, cleanup, clearTimer, startLevelLoop, maxDurationMs, finishRecording, keepRunningRecording, setTake]);

  /** Discards the recording (and any in-flight upload) without sending. */
  const deleteRecording = useCallback(() => {
    cancelledRef.current = true;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    cleanup();
    discardTake();
    setIsRecording(false);
    setIsUploading(false);
    setRecordingTime(0);
  }, [cleanup, discardTake]);

  /** Sends the running recording, or the kept one. */
  const sendRecording = useCallback(() => {
    if (uploadAbortRef.current) return;
    if (recorderRef.current) finishRecording('send');
    else if (takeRef.current) uploadTake(takeRef.current);
  }, [finishRecording, uploadTake]);

  const formatDuration = useCallback((secs) => {
    const safe = Math.max(0, Math.floor(Number(secs) || 0));
    const m = Math.floor(safe / 60).toString().padStart(2, '0');
    const s = (safe % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, []);

  const maxSeconds = Math.round(maxDurationMs / 1000);
  return {
    isRecording,
    isUploading,
    recordingTime,
    startRecording,
    deleteRecording,
    sendRecording,
    formatDuration,
    // Read by the live waveform canvas on each animation frame.
    levelsRef,
    /** The stopped recording waiting to be sent or deleted, or null. */
    take,
    maxSeconds,
    /** Seconds left before the cap, once the countdown should show; else null. */
    secondsLeft: isRecording && maxDurationMs > 0 && recordingTime >= maxSeconds - RECORDING_WARN_BEFORE_MS / 1000
      ? Math.max(0, maxSeconds - recordingTime)
      : null,
  };
}
