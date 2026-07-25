export interface StorageProvider {
  /**
   * Generate a presigned URL for direct client uploads.
   * 
   * @param filename  Original filename (used to derive extension)
   * @param contentType  MIME type of the file
   * @param folder  Folder prefix, e.g. "avatars", "general"
   * @param expiresIn  TTL in seconds (default 900)
   */
  createSignedUploadUrl(
    filename: string,
    contentType: string,
    folder?: string,
    expiresIn?: number,
  ): Promise<{ uploadUrl: string; publicUrl: string; key: string }>;

  /**
   * Generate a presigned URL for downloading a private file.
   */
  createSignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * Get the public URL for a file.
   */
  getPublicUrl(key: string): string;

  /**
   * Delete a file by key.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Upload a file directly from the backend (pass-through).
   */
  upload(key: string, fileBuffer: Buffer, contentType: string): Promise<string>;

  /**
   * Check if a file exists.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get metadata for a file.
   */
  getMetadata(key: string): Promise<any>;

  /**
   * Copy a file.
   */
  copy(sourceKey: string, destinationKey: string): Promise<boolean>;

  /**
   * Move or rename a file.
   */
  move(sourceKey: string, destinationKey: string): Promise<boolean>;

  /**
   * List files in a folder.
   */
  list(folder: string): Promise<any[]>;
}
