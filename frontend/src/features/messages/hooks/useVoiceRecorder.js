import { useState, useRef, useEffect } from 'react';
import { uploadsApi } from '../../../shared/api/apiClient';

export function useVoiceRecorder({ onSend, showToast }) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIdRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerIdRef.current) {
        clearInterval(timerIdRef.current);
      }
    };
  }, []);

  const startRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (showToast) showToast('Microphone not supported or disabled in insecure HTTP contexts. Please use HTTPS.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerIdRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error starting audio recording:', err);
      if (showToast) showToast('Microphone permission denied or not available.');
    }
  };

  const deleteRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
    audioChunksRef.current = [];
  };

  const sendRecording = () => {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current.onstop = async () => {
      try {
        const mimeType = audioChunksRef.current[0]?.type || 'audio/webm';
        const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('wav') ? 'wav' : 'webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const audioFile = new File([audioBlob], `voicenote_${Date.now()}.${ext}`, { type: mimeType });

        // Upload voice note directly to Supabase Storage in 'voice' folder
        const uploadRes = await uploadsApi.uploadMedia(audioFile, 'voice');
        const publicUrl = uploadRes.publicUrl || uploadRes.url || uploadRes.data?.publicUrl;

        if (publicUrl) {
          onSend(publicUrl);
        } else {
          // Fallback to data URL
          const reader = new FileReader();
          reader.onloadend = () => {
            if (reader.result) onSend(reader.result);
          };
          reader.readAsDataURL(audioBlob);
        }
      } catch (err) {
        console.error('Failed to upload voice note to Supabase Storage:', err);
        // Fallback to data URL on network/storage error
        if (audioChunksRef.current.length > 0) {
          const mimeType = audioChunksRef.current[0]?.type || 'audio/webm';
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
          const reader = new FileReader();
          reader.onloadend = () => {
            if (reader.result) onSend(reader.result);
          };
          reader.readAsDataURL(audioBlob);
        }
      } finally {
        if (mediaRecorderRef.current?.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
        }
        audioChunksRef.current = [];
      }
    };

    mediaRecorderRef.current.stop();

    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
  };

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return {
    isRecording,
    recordingTime,
    startRecording,
    deleteRecording,
    sendRecording,
    formatDuration
  };
}
