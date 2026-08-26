import { useState, useRef, useEffect, useCallback } from 'react';
import { uploadFileDirect } from '@shared/utils/mediaPipeline';

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
      return 'Microphone access denied. Enable it in your browser settings to record.';
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

const MAX_RECORDING_MS = 5 * 60 * 1000;

export function useVoiceRecorder({ onSend, showToast, maxDurationMs = MAX_RECORDING_MS } = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

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
  // Set to sendRecording below; lets the max-duration cap stop the recording.
  const stopAndSendRef = useRef(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  const notify = useCallback((msg) => {
    if (toastRef.current) toastRef.current(msg);
  }, []);

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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      uploadAbortRef.current?.abort();
      cleanup();
    };
  }, [cleanup]);

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

  const startRecording = useCallback(async () => {
    if (isRecording || isUploading) return;

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
        cancelledRef.current = true;
        cleanup();
        if (mountedRef.current) {
          setIsRecording(false);
          setRecordingTime(0);
        }
        notify('Recording stopped unexpectedly.');
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
        setRecordingTime(Math.floor(elapsed / 1000));
        if (maxDurationMs > 0 && elapsed >= maxDurationMs) {
          clearTimer();
          notify('Maximum recording length reached.');
          // Defer so the state update above commits before the stop path runs.
          stopAndSendRef.current?.();
        }
      }, 200);
    } catch (err) {
      console.error('Failed to start recording:', err);
      cleanup();
      setIsRecording(false);
      notify('Could not start recording.');
    }
  }, [isRecording, isUploading, notify, cleanup, clearTimer, startLevelLoop, maxDurationMs]);

  /** Discards the recording (and any in-flight upload) without sending. */
  const deleteRecording = useCallback(() => {
    cancelledRef.current = true;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    cleanup();
    setIsRecording(false);
    setIsUploading(false);
    setRecordingTime(0);
  }, [cleanup]);

  const sendRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || isUploading) return;

    const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));

    clearTimer();
    // Stop the analyser immediately so the bars freeze the moment the user
    // hits send, while the recorder finishes flushing its last chunk.
    teardownAudioGraph();
    setIsRecording(false);

    const finalize = async () => {
      recorderRef.current = null;
      releaseStream();

      const chunks = chunksRef.current;
      chunksRef.current = [];

      if (cancelledRef.current) return;
      if (!chunks.length) {
        notify('Recording was too short.');
        if (mountedRef.current) setIsUploading(false);
        return;
      }

      const mimeType = recorder.mimeType || chunks[0]?.type || 'audio/webm';
      const audioBlob = new Blob(chunks, { type: mimeType });
      const audioFile = new File(
        [audioBlob],
        `voicenote_${Date.now()}.${extForMime(mimeType)}`,
        { type: mimeType },
      );

      const controller = new AbortController();
      uploadAbortRef.current = controller;
      if (mountedRef.current) setIsUploading(true);

      try {
        const uploadRes = await uploadFileDirect(
          audioFile,
          'voice',
          null,
          controller.signal,
          null,
          { duration: durationSec },
        );
        const publicUrl = uploadRes?.publicUrl || uploadRes?.url;
        if (cancelledRef.current) return;

        if (publicUrl) {
          onSend?.(publicUrl, 'audio', durationSec);
        } else {
          throw new Error('Upload returned no URL');
        }
      } catch (err) {
        if (err?.name === 'AbortError' || cancelledRef.current) return;
        console.error('Failed to upload voice note:', err);
        notify('Could not send voice note. Please try again.');
      } finally {
        uploadAbortRef.current = null;
        if (mountedRef.current) setIsUploading(false);
      }
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
  }, [isUploading, clearTimer, teardownAudioGraph, releaseStream, notify, onSend]);

  stopAndSendRef.current = sendRecording;

  const formatDuration = useCallback((secs) => {
    const safe = Math.max(0, Math.floor(Number(secs) || 0));
    const m = Math.floor(safe / 60).toString().padStart(2, '0');
    const s = (safe % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, []);

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
  };
}
