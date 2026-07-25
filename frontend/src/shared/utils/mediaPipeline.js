import imageCompression from 'browser-image-compression';
import { apiClient } from '../api/apiClient';

/**
 * Validates a file before processing.
 */
export const validateFile = (file, options = {}) => {
  const { maxSizeMB = 10, allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } = options;
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`);
  }
  if (file.size / 1024 / 1024 > maxSizeMB) {
    throw new Error(`File is too large. Max size is ${maxSizeMB}MB.`);
  }
  return true;
};

/**
 * Compresses an image file, converting to WebP and stripping EXIF data.
 */
export const compressImage = async (file, options = {}) => {
  const { maxWidthOrHeight = 1920, initialQuality = 0.8, fileType = 'image/webp' } = options;
  
  // Skip compression for GIFs to preserve animation
  if (file.type === 'image/gif') return file;

  const compressionOptions = {
    maxSizeMB: 1, // Target max size (aggressive)
    maxWidthOrHeight,
    useWebWorker: true,
    fileType,
    initialQuality,
    exifOrientation: 1, // Reset EXIF
  };

  try {
    const compressedFile = await imageCompression(file, compressionOptions);
    return compressedFile;
  } catch (error) {
    if (compressionOptions.useWebWorker) {
      try {
        const fallbackCompressed = await imageCompression(file, { ...compressionOptions, useWebWorker: false });
        return fallbackCompressed;
      } catch (fallbackError) {
        console.error('Fallback image compression failed', fallbackError);
      }
    }
    console.error('Image compression failed', error);
    throw new Error('Failed to compress image.');
  }
};

/**
 * Requests a presigned URL from the backend and uploads the file.
 * Completely provider-agnostic from the frontend's perspective.
 */
export const uploadFileDirect = async (file, folder = 'general') => {
  try {
    // 1. Get presigned URL from backend
    const { uploadUrl, publicUrl, key, mediaId } = await apiClient.post('/api/media/presigned-url', {
      filename: file.name,
      contentType: file.type,
      folder,
      fileSize: file.size,
    });

    // 2. Upload directly to the designated storage provider via the signed URL
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type,
      },
      // Some providers require we don't cache
      cache: 'no-store',
    });

    if (!uploadRes.ok) {
      // Supabase returns JSON error body usually, let's try to parse it
      let errMsg = `Upload failed with status ${uploadRes.status}`;
      try {
        const errJson = await uploadRes.json();
        if (errJson.error) errMsg = errJson.error;
      } catch (e) {
        // ignore
      }
      throw new Error(errMsg);
    }

    // 3. Return the generic media details
    return { publicUrl, key, mediaId };
  } catch (error) {
    console.error('Direct upload failed:', error);
    throw error;
  }
};

/**
 * Full Pipeline: Validate -> Compress -> Upload
 */
export const processAndUploadImage = async (file, folder = 'general', compressOptions = {}) => {
  validateFile(file);
  const compressedFile = await compressImage(file, compressOptions);
  return await uploadFileDirect(compressedFile, folder);
};

/**
 * Downloads a remote image or GIF URL, compresses it, and uploads it.
 */
export const processAndUploadRemoteUrl = async (url, folder = 'general', compressOptions = {}) => {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const contentType = blob.type || (url.includes('.gif') ? 'image/gif' : 'image/jpeg');
    const ext = contentType.includes('gif') ? 'gif' : 'webp';
    const file = new File([blob], `remote-media-${Date.now()}.${ext}`, { type: contentType });
    
    // Skip compression for GIFs to preserve animation if needed
    const compressedFile = await compressImage(file, compressOptions);
    const { publicUrl } = await uploadFileDirect(compressedFile, folder);
    return publicUrl;
  } catch (error) {
    console.warn('Failed to compress remote media, falling back to original URL', error);
    return url;
  }
};
