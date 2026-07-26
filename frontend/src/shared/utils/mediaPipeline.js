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
export const uploadFileDirect = async (file, folder = 'general', onProgress = null) => {
  try {
    if (onProgress) onProgress(10);
    // 1. Get presigned URL from backend
    const { uploadUrl, publicUrl, key, mediaId } = await apiClient.post('/api/media/presigned-url', {
      filename: file.name,
      contentType: file.type,
      folder,
      fileSize: file.size,
    });

    if (onProgress) onProgress(20);

    // 2. Upload directly to storage provider with XHR for real-time progress tracking
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            const xhrPercent = Math.round((e.loaded / e.total) * 100);
            const overallPercent = Math.min(99, 20 + Math.round((xhrPercent * 79) / 100));
            onProgress(overallPercent);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (onProgress) onProgress(100);
          resolve(xhr.response);
        } else {
          let errMsg = `Upload failed with status ${xhr.status}`;
          try {
            const errJson = JSON.parse(xhr.responseText);
            if (errJson.error) errMsg = errJson.error;
          } catch (e) {
            // ignore
          }
          reject(new Error(errMsg));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during media upload'));
      xhr.onabort = () => reject(new Error('Media upload aborted'));
      xhr.send(file);
    });

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
export const processAndUploadImage = async (file, folder = 'general', compressOptions = {}, onProgress = null) => {
  validateFile(file);
  if (onProgress) onProgress(8);
  const compressedFile = await compressImage(file, compressOptions);
  if (onProgress) onProgress(22);
  return await uploadFileDirect(compressedFile, folder, (percent) => {
    if (onProgress) {
      const overallPercent = Math.min(100, 22 + Math.round((percent * 78) / 100));
      onProgress(overallPercent);
    }
  });
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
