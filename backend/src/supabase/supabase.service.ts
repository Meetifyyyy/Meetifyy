import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private supabaseClient: SupabaseClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('supabase.url');
    const serviceRoleKey = this.configService.get<string>('supabase.serviceRoleKey');
    const anonKey = this.configService.get<string>('supabase.anonKey');

    if (!url || url.includes('placeholder')) {
      this.logger.warn('Supabase URL is placeholder. Using local fallback simulation.');
      return;
    }

    const validServiceRoleKey = serviceRoleKey && !serviceRoleKey.includes('placeholder') ? serviceRoleKey : null;
    const validAnonKey = anonKey && !anonKey.includes('placeholder') ? anonKey : null;
    const keyToUse = validServiceRoleKey || validAnonKey;

    if (!keyToUse) {
      this.logger.warn('Supabase keys are placeholder or missing. Using local fallback simulation.');
      return;
    }

    try {
      this.supabaseClient = createClient(url, keyToUse, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      this.logger.log(`Supabase client initialized (${validServiceRoleKey ? 'admin' : 'anon fallback'}).`);
    } catch (error) {
      this.logger.error('Failed to initialize Supabase client', error);
    }
  }

  get client(): SupabaseClient {
    if (!this.supabaseClient) {
      throw new Error('Supabase client is not initialized due to placeholder config.');
    }
    return this.supabaseClient;
  }

  get isConfigured(): boolean {
    return !!this.supabaseClient;
  }
}
