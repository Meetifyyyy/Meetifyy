import { useState, useCallback } from 'react';
import { uploadsApi } from '../api/apiClient';

/**
 * useMediaUpload — handles the pass-through upload to the backend.
 *
 * Local dev (no credentials): the backend returns a mock URL.
 * The upload passes through NestJS /api/media/upload and returns the publicUrl.
 *
 * @param {string} folder - Storage prefix ('avatars' | 'covers' | 'chat-media' | 'community-icons')
 */
export function useMediaUpload(folder = 'general') {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Upload a File object directly via presigned URL.
   * @param {File} file
   * @returns {Promise<string>} The public URL of the uploaded file
   */
  const upload = useCallback(async (file) => {
    if (!file) throw new Error('No file provided');

    setUploading(true);
    setError(null);

    try {
      // 1. Upload file via backend pass-through
      const response = await uploadsApi.uploadMedia(file, folder);
      
      // 2. Return the public URL for storing in the DB/sending to API
      return response.publicUrl || response.data?.publicUrl;
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
