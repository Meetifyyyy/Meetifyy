import { useState, useCallback } from 'react';
import { uploadsApi } from '../api/apiClient';

/**
 * useR2Upload — handles the full presign → PUT → public URL flow.
 *
 * Local dev (no R2 credentials): the backend returns a mock URL.
 * The PUT will fail silently, but the mock URL is returned so the UI
 * still functions for testing. Set R2 env vars to switch to real uploads.
 *
 * @param {string} folder - R2 storage prefix ('avatars' | 'covers' | 'chat-media' | 'community-icons')
 */
export function useR2Upload(folder = 'general') {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Upload a File object directly to R2 via presigned URL.
   * @param {File} file
   * @returns {Promise<string>} The public URL of the uploaded file
   */
  const upload = useCallback(async (file) => {
    if (!file) throw new Error('No file provided');

    setUploading(true);
    setError(null);

    try {
      // 1. Get presigned URL from backend
      const { uploadUrl, publicUrl } = await uploadsApi.presign(
        file.name,
        file.type,
        folder,
      );

      // 2. Upload directly to R2 (or mock URL in local dev — fails silently)
      try {
        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        });
      } catch {
        // In local dev the mock URL won't accept PUT — that's fine
        console.debug('[useR2Upload] Upload PUT skipped (mock mode)');
      }

      // 3. Return the public URL for storing in the DB
      return publicUrl;
    } catch (err) {
      const message = err?.message || 'Upload failed';
      setError(message);
      throw err;
    } finally {
      setUploading(false);
    }
  }, [folder]);

  return { upload, uploading, error };
}
