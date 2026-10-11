import { useCallback, useRef, useState } from 'react';
import { supportApi } from '@shared/api/apiClient';

const DEFAULT_LIMITS = {
  maxFiles: 5,
  maxBytesPerFile: 10 * 1024 * 1024,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
};

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Screenshots for a support request. Each file is uploaded as soon as it is
 * picked (`POST /api/support/attachments`), so submitting only sends the keys
 * and a slow upload never makes the user retype their message.
 *
 * Only images are offered: a screenshot is what helps, and the server's
 * allow-list (`GET /api/support/meta`) is intersected so the picker never
 * accepts something the API will refuse.
 */
export function useSupportAttachments(limits) {
  const maxFiles = limits?.maxFiles ?? DEFAULT_LIMITS.maxFiles;
  const maxBytes = limits?.maxBytesPerFile ?? DEFAULT_LIMITS.maxBytesPerFile;
  const serverTypes = limits?.allowedMimeTypes ?? DEFAULT_LIMITS.allowedMimeTypes;
  const accept = serverTypes.filter((t) => t.startsWith('image/'));

  const [files, setFiles] = useState([]);
  const seq = useRef(0);

  const update = (localId, patch) =>
    setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, ...patch } : f)));

  const add = useCallback(
    async (picked) => {
      const room = Math.max(0, maxFiles - files.length);
      for (const file of Array.from(picked).slice(0, room)) {
        seq.current += 1;
        const localId = `att-${seq.current}`;
        const base = { localId, name: file.name, size: file.size, preview: null };

        if (!accept.includes(file.type)) {
          setFiles((prev) => [...prev, { ...base, status: 'error', error: 'Only PNG, JPG, WEBP or GIF images' }]);
          continue;
        }
        if (file.size > maxBytes) {
          setFiles((prev) => [...prev, { ...base, status: 'error', error: `Larger than ${formatBytes(maxBytes)}` }]);
          continue;
        }

        const preview = URL.createObjectURL(file);
        setFiles((prev) => [...prev, { ...base, preview, status: 'uploading' }]);
        try {
          const result = await supportApi.uploadAttachment(file);
          update(localId, { status: 'ready', key: result.key || result.storageKey });
        } catch (error) {
          update(localId, { status: 'error', error: error?.message || 'Upload failed' });
        }
      }
    },
    [accept, files.length, maxBytes, maxFiles],
  );

  const remove = useCallback((localId) => {
    setFiles((prev) => {
      const gone = prev.find((f) => f.localId === localId);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((f) => f.localId !== localId);
    });
  }, []);

  const reset = useCallback(() => {
    setFiles((prev) => {
      prev.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      return [];
    });
  }, []);

  return {
    files,
    add,
    remove,
    reset,
    accept: accept.join(','),
    canAddMore: files.length < maxFiles,
    maxFiles,
    uploading: files.some((f) => f.status === 'uploading'),
    /** What the API takes: keys of the files that finished uploading. */
    refs: files.filter((f) => f.status === 'ready' && f.key).map((f) => ({ key: f.key, filename: f.name })),
  };
}
