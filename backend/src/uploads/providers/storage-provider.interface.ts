/**
 * What storage holds for an object, in one shape whatever the backend. `null`
 * from getMetadata means the object could not be found or read.
 */
export interface ObjectMetadata {
  contentLength?: number;
  contentType?: string;
}

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
    explicitKey?: string,
  ): Promise<{ uploadUrl: string; publicUrl: string; key: string }>;

  /**
   * Generate a presigned URL for downloading a private file.
   */
  createSignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * Generate presigned URLs in bulk for downloading private files.
   */
  createSignedUrls(
    keys: string[],
    expiresIn?: number,
  ): Promise<{ [key: string]: string }>;

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
  getMetadata(key: string): Promise<ObjectMetadata | null>;

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
  list(folder: string): Promise<StoredObject[]>;
}

/** An entry in a folder listing: the S3 object shape, of which only these are read. */
export interface StoredObject {
  Key?: string;
  Size?: number;
}
