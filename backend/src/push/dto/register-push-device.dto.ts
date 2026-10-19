import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export const PUSH_PLATFORMS = ['WEB', 'ANDROID'] as const;
export type PushPlatformName = (typeof PUSH_PLATFORMS)[number];

/**
 * PUT /api/push/devices.
 *
 * There is deliberately no user id here: the device is registered to whoever
 * the request authenticates as, under the login (session family) it was made
 * with. Shape is checked here; the endpoint host allow-list (the server POSTs
 * to a web endpoint, so it is an SSRF surface) is enforced in
 * PushDevicesService, because it depends on `platform`.
 */
export class RegisterPushDeviceDto {
  @IsIn(PUSH_PLATFORMS)
  platform!: PushPlatformName;

  /** WEB: the subscription endpoint URL. ANDROID: the FCM registration token. */
  @IsString()
  @Length(20, 2048)
  token!: string;

  /** WEB only: base64url P-256 public key of the subscription (65 bytes). */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{86,88}={0,2}$/)
  p256dh?: string;

  /** WEB only: base64url auth secret of the subscription (16 bytes). */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{21,24}={0,2}$/)
  auth?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Matches(/^[0-9A-Za-z.+_-]+$/)
  appVersion?: string;
}

/** POST /api/push/devices/unregister. Only the caller's own row can match. */
export class UnregisterPushDeviceDto {
  @IsString()
  @Length(20, 2048)
  token!: string;
}

/** PATCH /api/push/preferences. Every field optional; absent means unchanged. */
export class UpdatePushPreferencesDto {
  /** The account-wide push switch (UserSettings.pushNotifs). */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsBoolean() messages?: boolean;
  @IsOptional() @IsBoolean() likes?: boolean;
  @IsOptional() @IsBoolean() comments?: boolean;
  @IsOptional() @IsBoolean() mentions?: boolean;
  @IsOptional() @IsBoolean() follows?: boolean;
  @IsOptional() @IsBoolean() activities?: boolean;
  @IsOptional() @IsBoolean() communities?: boolean;
}
