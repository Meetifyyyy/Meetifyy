import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private supabaseClient: SupabaseClient;
  private supabaseAnonClient: SupabaseClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const url = config.auth.supabase.url;
    const serviceRoleKey = config.auth.supabase.serviceRoleKey;
    const anonKey = config.auth.supabase.anonKey;

    if (!url || url.includes('placeholder')) {
      this.logger.warn(
        'Supabase URL is placeholder. Using local fallback simulation.',
      );
      return;
    }

    const validServiceRoleKey =
      serviceRoleKey && !serviceRoleKey.includes('placeholder')
        ? serviceRoleKey
        : null;
    const validAnonKey =
      anonKey && !anonKey.includes('placeholder') ? anonKey : null;
    const keyToUse = validServiceRoleKey || validAnonKey;

    if (!keyToUse) {
      this.logger.warn(
        'Supabase keys are placeholder or missing. Using local fallback simulation.',
      );
      return;
    }

    try {
      this.supabaseClient = createClient(url, keyToUse, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      this.logger.log(
        `Supabase client initialized (${validServiceRoleKey ? 'admin' : 'anon fallback'}).`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize Supabase client', error);
    }

    // ── The anon client, kept separate on purpose ─────────────────────────
    //
    // Not a duplicate of the client above, and not interchangeable with it.
    // GoTrue decides what an auth call MEANS from the key that made it: a
    // `POST /signup` carrying the service-role key is treated as an admin
    // creating a user, so the account comes back already confirmed and NO
    // confirmation email is sent. Routed through the shared client above —
    // which prefers the service-role key whenever one is configured — the
    // signup proxy would therefore mint verified accounts without anybody ever
    // proving they own the address, and the OTP step would have nothing to
    // verify.
    //
    // So every call that must behave exactly as it would from a browser —
    // signup, confirmation-code resend, password-reset request — goes through
    // this client instead, and `anonClient` throws rather than falling back
    // when no anon key is configured. A missing key must fail loudly at the
    // call site; silently borrowing the admin key is the one outcome that
    // cannot be allowed.
    if (!validAnonKey) {
      this.logger.warn(
        'No Supabase anon key configured — public auth calls (signup, resend, password reset) will be refused.',
      );
      return;
    }

    try {
      this.supabaseAnonClient = createClient(url, validAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      this.logger.log('Supabase anon client initialized (public auth calls).');
    } catch (error) {
      this.logger.error('Failed to initialize Supabase anon client', error);
    }
  }

  get client(): SupabaseClient {
    if (!this.supabaseClient) {
      throw new Error(
        'Supabase client is not initialized due to placeholder config.',
      );
    }
    return this.supabaseClient;
  }

  /**
   * The client for auth calls that must behave as a browser's would.
   *
   * Throws rather than degrading to `client`: see the note in onModuleInit.
   * The difference between the two keys is the difference between a signup that
   * sends a confirmation email and one that quietly skips verification, and
   * that is not a distinction to leave to a fallback.
   */
  get anonClient(): SupabaseClient {
    if (!this.supabaseAnonClient) {
      throw new Error(
        'Supabase anon client is not initialized. SUPABASE_ANON_KEY is required for signup, resend and password-reset requests.',
      );
    }
    return this.supabaseAnonClient;
  }

  get isConfigured(): boolean {
    return !!this.supabaseClient;
  }

  /** Whether the public auth calls above can be served. */
  get isAnonConfigured(): boolean {
    return !!this.supabaseAnonClient;
  }
}
