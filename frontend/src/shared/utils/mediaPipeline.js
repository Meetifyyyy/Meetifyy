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
  if (!file || file.type === 'image/gif') return file;

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
        console.warn('Fallback image compression failed, using original file:', fallbackError);
      }
    } else {
      console.warn('Image compression failed, using original file:', error);
    }
    return file;
  }
};

/**
 * Requests a presigned URL from the backend and uploads the file.
 * Falls back seamlessly to backend pass-through upload (/api/media/upload) if CORS or network issues block direct upload.
 */
export const uploadFileDirect = async (file, folder = 'general', onProgress = null) => {
  try {
    if (onProgress) onProgress(10);

    // Normalize filename extension to match actual MIME type after compression
    const mimeToExt = {
      'image/webp': 'webp',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/webm': 'weba',
      'audio/ogg': 'oga',
    };
    const fileName = file.name || 'upload';
    const ext = mimeToExt[file.type] || fileName.split('.').pop() || 'bin';
    const baseName = fileName.replace(/\.[^.]+$/, '') || 'file';
    const normalizedName = `${baseName}.${ext}`;

    // 1. Try Direct Upload via Presigned URL
    try {
      const { uploadUrl, publicUrl, key, mediaId } = await apiClient.post('/api/media/presigned-url', {
        filename: normalizedName,
        contentType: file.type || 'application/octet-stream',
        folder,
        fileSize: Number(file.size || 0),
      });

      if (onProgress) onProgress(20);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.withCredentials = uploadUrl.startsWith('/');
        if (file.type) {
          xhr.setRequestHeader('Content-Type', file.type);
        }
        xhr.setRequestHeader('Cache-Control', 'public, max-age=31536000, immutable');

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

        xhr.onerror = () => reject(new Error('Network or CORS error during media upload'));
        xhr.onabort = () => reject(new Error('Media upload aborted'));
        xhr.send(file);
      });

      try {
        await apiClient.post('/api/media/confirm', { key });
      } catch (confirmError) {
        console.warn('Failed to confirm upload with backend, but file is in storage:', confirmError);
      }

      return { publicUrl, key, mediaId };
    } catch (directUploadError) {
      console.warn('Direct presigned upload failed/blocked (e.g. CORS). Retrying with backend pass-through upload:', directUploadError);

      // 2. Fallback: Multipart upload via NestJS backend endpoint (/api/media/upload)
      const formData = new FormData();
      formData.append('file', file, normalizedName);
      formData.append('folder', folder);

      const response = await apiClient.post('/api/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
            onProgress(percent);
          }
        },
      });

      if (onProgress) onProgress(100);
      return response;
    }
  } catch (error) {
    console.error('All media upload methods failed:', error);
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
