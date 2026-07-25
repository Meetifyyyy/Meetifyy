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
      const mockPublicUrl = `/mock-upload/${key}`;
      return { uploadUrl: mockPublicUrl, publicUrl: mockPublicUrl, key };
    }

    const client = this.supabaseService.client;
    const { data: uploadData, error: uploadError } = await client.storage
      .from(this.bucketName)
      .createSignedUploadUrl(key);

    if (uploadError || !uploadData) {
      this.logger.error('Failed to create Supabase signed upload URL', uploadError);
      throw new Error('Failed to generate upload URL');
    }

    const { data: publicUrlData } = client.storage.from(this.bucketName).getPublicUrl(key);
    return { uploadUrl: uploadData.signedUrl, publicUrl: publicUrlData.publicUrl, key };
  }

  async createSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!this.supabaseService.isConfigured) return `/mock-download/${key}`;
    const { data, error } = await this.supabaseService.client.storage
      .from(this.bucketName)
      .createSignedUrl(key, expiresIn);
    if (error || !data) throw new Error('Failed to generate signed download URL');
    return data.signedUrl;
  }

  getPublicUrl(key: string): string {
    if (!this.supabaseService.isConfigured) return `/mock-public/${key}`;
    const { data } = this.supabaseService.client.storage.from(this.bucketName).getPublicUrl(key);
    return data.publicUrl;
  }

  async delete(key: string): Promise<boolean> {
    if (!this.supabaseService.isConfigured) return true;
    const { error } = await this.supabaseService.client.storage.from(this.bucketName).remove([key]);
    if (error) {
      this.logger.error(`Failed to delete object ${key}`, error);
      return false;
    }
    return true;
  }

  async upload(key: string, fileBuffer: Buffer, contentType: string): Promise<string> {
    if (!this.supabaseService.isConfigured) return this.getPublicUrl(key);
    const { error } = await this.supabaseService.client.storage
      .from(this.bucketName)
      .upload(key, fileBuffer, { contentType, upsert: true });
    if (error) {
      this.logger.error(`Failed to upload object ${key}`, error);
      throw new Error('Upload failed');
    }
    return this.getPublicUrl(key);
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
