import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { StorageProvider } from './storage-provider.interface';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class SupabaseStorageProvider implements StorageProvider {
  private readonly logger = new Logger(SupabaseStorageProvider.name);
  private bucketName: string;

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
  ) {
    this.bucketName = this.configService.get<string>('supabase.bucketName') || 'meetifyy-dev';
    
    if (this.supabaseService.isConfigured) {
      this.logger.log(`Supabase Storage configured (bucket: ${this.bucketName})`);
    } else {
      this.logger.warn('Supabase not fully configured — uploads will return mock URLs.');
    }
  }

  async createSignedUploadUrl(
    filename: string,
    contentType: string,
    folder = 'general',
    expiresIn = 900,
  ): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
    const ext = filename.split('.').pop() || 'bin';
    const key = `${folder}/${randomUUID()}.${ext}`;

    if (!this.supabaseService.isConfigured) {
      const uploadUrl = `/api/media/direct-upload?key=${encodeURIComponent(key)}`;
      const publicUrl = `/api/media/${key}`;
      return { uploadUrl, publicUrl, key };
    }

    try {
      const client = this.supabaseService.client;
      const { data: uploadData, error: uploadError } = await client.storage
        .from(this.bucketName)
        .createSignedUploadUrl(key);

      if (uploadError || !uploadData?.signedUrl) {
        this.logger.warn(`Supabase storage failed to generate presigned URL (${uploadError?.message || 'No signedUrl'}). Falling back to local direct upload.`);
        const uploadUrl = `/api/media/direct-upload?key=${encodeURIComponent(key)}`;
        const publicUrl = `/api/media/${key}`;
        return { uploadUrl, publicUrl, key };
      }

      const { data: publicUrlData } = client.storage.from(this.bucketName).getPublicUrl(key);
      return { uploadUrl: uploadData.signedUrl, publicUrl: publicUrlData.publicUrl, key };
    } catch (err: any) {
      this.logger.warn(`Supabase storage exception (${err?.message}). Falling back to local direct upload.`);
      const uploadUrl = `/api/media/direct-upload?key=${encodeURIComponent(key)}`;
      const publicUrl = `/api/media/${key}`;
      return { uploadUrl, publicUrl, key };
    }
  }

  async createSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!this.supabaseService.isConfigured) return `/api/media/${key}`;
    try {
      const { data, error } = await this.supabaseService.client.storage
        .from(this.bucketName)
        .createSignedUrl(key, expiresIn);
      if (error || !data) return `/api/media/${key}`;
      return data.signedUrl;
    } catch (e) {
      return `/api/media/${key}`;
    }
  }

  async createSignedUrls(keys: string[], expiresIn = 3600): Promise<{ [key: string]: string }> {
    const result: { [key: string]: string } = {};
    if (!keys || keys.length === 0) return result;

    if (!this.supabaseService.isConfigured) {
      keys.forEach(k => { result[k] = `/api/media/${k}`; });
      return result;
    }

    try {
      const { data, error } = await this.supabaseService.client.storage
        .from(this.bucketName)
        .createSignedUrls(keys, expiresIn);

      if (error || !data) {
        keys.forEach(k => { result[k] = `/api/media/${k}`; });
        return result;
      }

      data.forEach((item, idx) => {
        const itemKey = item.path || keys[idx];
        if (itemKey) {
          if (item.error || !item.signedUrl) {
            result[itemKey] = `/api/media/${itemKey}`;
          } else {
            result[itemKey] = item.signedUrl;
          }
        }
      });
    } catch (e) {
      keys.forEach(k => { result[k] = `/api/media/${k}`; });
    }

    return result;
  }

  getPublicUrl(key: string): string {
    if (!this.supabaseService.isConfigured) return `/api/media/${key}`;
    try {
      const { data } = this.supabaseService.client.storage.from(this.bucketName).getPublicUrl(key);
      return data?.publicUrl || `/api/media/${key}`;
    } catch (e) {
      return `/api/media/${key}`;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.supabaseService.isConfigured) return true;
    try {
      const { error } = await this.supabaseService.client.storage.from(this.bucketName).remove([key]);
      if (error) {
        this.logger.error(`Failed to delete object ${key}`, error);
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async upload(key: string, fileBuffer: Buffer, contentType: string): Promise<string> {
    if (!this.supabaseService.isConfigured) return this.getPublicUrl(key);
    try {
      const { error } = await this.supabaseService.client.storage
        .from(this.bucketName)
        .upload(key, fileBuffer, { contentType, upsert: true });
      if (error) {
        this.logger.warn(`Failed to upload object ${key} to Supabase (${error.message}). Falling back to local.`);
        throw error;
      }
      return this.getPublicUrl(key);
    } catch (err) {
      return `/api/media/${key}`;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.supabaseService.isConfigured) return false;
    const folder = key.substring(0, key.lastIndexOf('/')) || '';
    const filename = key.substring(key.lastIndexOf('/') + 1);
    const { data, error } = await this.supabaseService.client.storage.from(this.bucketName).list(folder, { search: filename });
    if (error) return false;
    return data?.some(file => file.name === filename) || false;
  }

  async getMetadata(key: string): Promise<any> {
    if (!this.supabaseService.isConfigured) return null;
    const folder = key.substring(0, key.lastIndexOf('/')) || '';
    const filename = key.substring(key.lastIndexOf('/') + 1);
    const { data, error } = await this.supabaseService.client.storage.from(this.bucketName).list(folder, { search: filename });
    if (error || !data || data.length === 0) return null;
    return data.find(file => file.name === filename) || null;
  }

  async copy(sourceKey: string, destinationKey: string): Promise<boolean> {
    if (!this.supabaseService.isConfigured) return true;
    const { error } = await this.supabaseService.client.storage.from(this.bucketName).copy(sourceKey, destinationKey);
    return !error;
  }

  async move(sourceKey: string, destinationKey: string): Promise<boolean> {
    if (!this.supabaseService.isConfigured) return true;
    const { error } = await this.supabaseService.client.storage.from(this.bucketName).move(sourceKey, destinationKey);
    return !error;
  }

  async list(folder: string): Promise<any[]> {
    if (!this.supabaseService.isConfigured) return [];
    const { data, error } = await this.supabaseService.client.storage.from(this.bucketName).list(folder);
    if (error) {
      this.logger.error(`Failed to list folder ${folder}`, error);
      return [];
    }
    return data || [];
  }
}
