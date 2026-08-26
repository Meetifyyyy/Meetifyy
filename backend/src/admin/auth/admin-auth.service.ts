import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { RedisService } from '../../redis/redis.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import {
  AdminLoginDto,
  VerifyOtpDto,
  VerifyTotpDto,
  ResetPasswordRequestDto,
  ResetPasswordDto,
} from './dto/admin-auth.dto';
import { config } from '../../config';
const { authenticator } = require('otplib');
const { UAParser } = require('ua-parser-js');

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  /**
   * Fixed-window brute-force guard for admin auth. Backed by Redis so it holds
   * across replicas; fails OPEN if Redis is unavailable (never lock admins out
   * due to infra). Throws HTTP 429 when the window limit is exceeded.
   */
  private async enforceRateLimit(
    bucket: string,
    max: number,
    windowSec: number,
  ) {
    const client = this.redisService?.getClient?.();
    if (!client) return; // fail-open when Redis isn't configured
    const key = `admin-auth-rl:${bucket}`;
    try {
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, windowSec);
      if (count > max) {
        const ttl = await client.ttl(key).catch(() => windowSec);
        throw new HttpException(
          `Too many attempts. Try again in ${Math.max(1, ttl)}s.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis error → fail open, don't block legitimate admins.
    }
  }

  async onModuleInit() {
    await this.seedDefaultSuperAdmin();
  }

  /**
   * Seed/sync Super Admin account on startup
   */
  async seedDefaultSuperAdmin() {
    try {
      const email = config.auth.admin.superAdminEmail.toLowerCase().trim();
      const pass = config.auth.admin.superAdminPassword;

      if (!email || !pass) {
        this.logger.warn(
          'SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD is missing in environment variables. Skipping initial Super Admin seeding.',
        );
        return;
      }

      const existing = await this.prisma.superAdmin.findUnique({
        where: { email },
      });
      if (existing) {
        const isSamePassword = await bcrypt.compare(
          pass,
          existing.passwordHash,
        );
        if (isSamePassword && existing.isActive) {
          return;
        }
      }

      const passwordHash = await bcrypt.hash(pass, 10);

      await this.prisma.superAdmin.upsert({
        where: { email },
        update: {
          passwordHash,
          isActive: true,
        },
        create: {
          email,
          passwordHash,
          name: 'Super Admin',
          isActive: true,
        },
      });
      this.logger.log(`Super Admin account synced: ${email}`);
    } catch (err: any) {
      if (err?.message?.includes('Cannot use a pool after calling end')) return;
      this.logger.error('Failed to seed Super Admin', err);
    }
  }

  private getAccessSecret(): string {
    const secret = config.auth.admin.accessSecret;
    if (!secret) {
      throw new UnauthorizedException(
        'ADMIN_JWT_ACCESS_SECRET is missing in server environment',
      );
    }
    return secret;
  }

  private getRefreshSecret(): string {
    const secret = config.auth.admin.refreshSecret;
    if (!secret) {
      throw new UnauthorizedException(
        'ADMIN_JWT_REFRESH_SECRET is missing in server environment',
      );
    }
    return secret;
  }

  private getPendingSecret(): string {
    const secret = config.auth.admin.pendingSecret;
    if (!secret) {
      throw new UnauthorizedException(
        'ADMIN_JWT_PENDING_SECRET is missing in server environment',
      );
    }
    return secret;
  }

  private hashOtp(otp: string): string {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }

  /**
   * Step 1: Verify Email + Password, then send Email OTP
   */
  async login(dto: AdminLoginDto, ip: string, userAgent: string) {
    const email = dto.email.toLowerCase().trim();

    // Brute-force protection: cap attempts per IP and per (IP+email) in a 15-min
    // window. Per-IP catches password spraying; per-email catches targeting.
    await this.enforceRateLimit(`login:ip:${ip}`, 20, 15 * 60);
    await this.enforceRateLimit(`login:id:${ip}:${email}`, 8, 15 * 60);

    const admin = await this.prisma.superAdmin.findUnique({
      where: { email },
    });

    if (!admin || !admin.isActive) {
      this.prisma.loginAudit
        .create({
          data: {
            email,
            success: false,
            failureReason: 'INVALID_CREDENTIALS_OR_INACTIVE',
            ip,
            userAgent,
          },
        })
        .catch(() => {});
      throw new UnauthorizedException('Invalid admin credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!isMatch) {
      this.prisma.loginAudit
        .create({
          data: {
            adminId: admin.id,
            email,
            success: false,
            failureReason: 'INVALID_PASSWORD',
            ip,
            userAgent,
          },
        })
        .catch(() => {});
      throw new UnauthorizedException('Invalid admin credentials');
    }

    // Generate 6-digit OTP with a cryptographically secure RNG (not Math.random).
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = this.hashOtp(rawOtp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    // Invalidate old OTPs & store new OTP in a single transaction
    await this.prisma.$transaction([
      this.prisma.adminOtp.deleteMany({ where: { adminId: admin.id } }),
      this.prisma.adminOtp.create({
        data: {
          adminId: admin.id,
          otpHash,
          expiresAt,
        },
      }),
    ]);

    // Dispatch OTP email asynchronously (non-blocking)
    this.emailService
      .sendAdminVerificationOtpEmail(admin.email, admin.name, rawOtp)
      .catch((emailErr) => {
        this.logger.error(
          `Failed to send admin OTP email to ${admin.email}`,
          emailErr,
        );
      });

    // Issue short-lived pendingToken for OTP step
    const pendingToken = jwt.sign(
      { sub: admin.id, email: admin.email, step: 'OTP' },
      this.getPendingSecret(),
      { expiresIn: '10m' },
    );

    return {
      success: true,
      step: 'OTP_REQUIRED',
      pendingToken,
      message: 'Verification code sent to email',
    };
  }

  /**
   * Step 2: Verify Email OTP
   */
  async verifyOtp(dto: VerifyOtpDto, ip: string, userAgent: string) {
    // Cap OTP submissions per IP (defense-in-depth on top of the per-record
    // 5-attempt lockout) to blunt distributed guessing.
    await this.enforceRateLimit(`verify-otp:ip:${ip}`, 30, 15 * 60);

    let payload: any;
    try {
      payload = jwt.verify(dto.pendingToken, this.getPendingSecret());
    } catch (err) {
      throw new UnauthorizedException(
        'Verification session expired or invalid',
      );
    }

    if (payload.step !== 'OTP') {
      throw new UnauthorizedException('Invalid authentication step');
    }

    const admin = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
    });

    if (!admin || !admin.isActive) {
      throw new ForbiddenException('Super Admin account disabled');
    }

    const otpRecord = await this.prisma.adminOtp.findFirst({
      where: { adminId: admin.id, used: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      throw new UnauthorizedException(
        'Verification code has expired. Please login again.',
      );
    }

    if (otpRecord.attempts >= 5) {
      await this.prisma.adminOtp.delete({ where: { id: otpRecord.id } });
      throw new UnauthorizedException(
        'Too many failed attempts. Please login again.',
      );
    }

    const inputHash = this.hashOtp(dto.otp);
    if (inputHash !== otpRecord.otpHash) {
      await this.prisma.adminOtp.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid verification code');
    }

    // OTP Verified! Delete record
    await this.prisma.adminOtp.delete({ where: { id: otpRecord.id } });

    // Check if TOTP is enabled
    if (admin.totpEnabled && admin.totpSecret) {
      const pendingToken2 = jwt.sign(
        { sub: admin.id, email: admin.email, step: 'TOTP' },
        this.getPendingSecret(),
        { expiresIn: '5m' },
      );
      return {
        success: true,
        step: 'TOTP_REQUIRED',
        pendingToken: pendingToken2,
      };
    }

    // Complete login and return session tokens
    return this.createAdminSession(admin, ip, userAgent);
  }

  /**
   * Step 3: Verify optional TOTP (Google Authenticator)
   */
  async verifyTotp(dto: VerifyTotpDto, ip: string, userAgent: string) {
    // A 6-digit TOTP has only 1M values — rate-limit submissions per IP so the
    // 5-minute pending window can't be exhausted by brute force.
    await this.enforceRateLimit(`verify-totp:ip:${ip}`, 15, 15 * 60);

    let payload: any;
    try {
      payload = jwt.verify(dto.pendingToken, this.getPendingSecret());
    } catch (err) {
      throw new UnauthorizedException('Verification session expired');
    }

    if (payload.step !== 'TOTP') {
      throw new UnauthorizedException('Invalid authentication step');
    }

    const admin = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
    });

    if (!admin || !admin.isActive || !admin.totpSecret) {
      throw new ForbiddenException('TOTP authentication not configured');
    }

    const isValid = authenticator.verify({
      token: dto.totpCode,
      secret: admin.totpSecret,
    });

    if (!isValid) {
      await this.prisma.loginAudit.create({
        data: {
          adminId: admin.id,
          email: admin.email,
          success: false,
          failureReason: 'INVALID_TOTP',
          ip,
          userAgent,
        },
      });
      throw new UnauthorizedException('Invalid TOTP authenticator code');
    }

    return this.createAdminSession(admin, ip, userAgent);
  }

  /**
   * Create SuperAdminSession & generate Access/Refresh tokens
   */
  private async createAdminSession(admin: any, ip: string, userAgent: string) {
    const parser = new UAParser(userAgent);
    const ua = parser.getResult();
    const browser =
      `${ua.browser.name || 'Unknown'} ${ua.browser.version || ''}`.trim();
    const os = `${ua.os.name || 'Unknown'} ${ua.os.version || ''}`.trim();
    const deviceName =
      `${ua.device.vendor || ''} ${ua.device.model || ua.os.name || 'Desktop'}`.trim();

    // Use fast SHA-256 for high-entropy random refresh tokens
    const rawRefreshToken = crypto.randomBytes(64).toString('hex');
    const refreshHash = crypto
      .createHash('sha256')
      .update(rawRefreshToken)
      .digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const session = await this.prisma.superAdminSession.create({
      data: {
        adminId: admin.id,
        refreshHash,
        ip,
        userAgent,
        deviceName,
        browser,
        os,
        expiresAt,
      },
    });

    // Sign Access Token (15 mins)
    const accessToken = jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        name: admin.name,
        sessionId: session.id,
      },
      this.getAccessSecret(),
      { expiresIn: '15m' },
    );

    // Sign Refresh Token (30 days) containing session ID
    const refreshToken = jwt.sign(
      { sub: admin.id, sessionId: session.id, tokenKey: rawRefreshToken },
      this.getRefreshSecret(),
      { expiresIn: '30d' },
    );

    // Audit Log (non-blocking)
    this.prisma.loginAudit
      .create({
        data: {
          adminId: admin.id,
          email: admin.email,
          success: true,
          ip,
          userAgent,
          deviceName,
          browser,
          os,
        },
      })
      .catch(() => {});

    // Send New Login Alert Email (non-blocking)
    this.emailService
      .sendNewLoginEmail(
        admin.email,
        admin.name,
        deviceName,
        ip,
        new Date().toISOString(),
      )
      .catch((err) => {
        this.logger.warn('Failed to send login alert email', err);
      });

    return {
      accessToken,
      refreshToken,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        totpEnabled: admin.totpEnabled,
      },
    };
  }

  /**
   * Rotate Refresh Token
   */
  async refreshTokens(refreshTokenStr: string, ip: string, userAgent: string) {
    let payload: any;
    try {
      payload = jwt.verify(refreshTokenStr, this.getRefreshSecret());
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const session = await this.prisma.superAdminSession.findUnique({
      where: { id: payload.sessionId },
      include: { admin: true },
    });

    if (!session || session.revoked || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session has been revoked or expired');
    }

    if (!session.admin || !session.admin.isActive) {
      throw new ForbiddenException('Super Admin account disabled');
    }

    // Verify token key (SHA-256 with timingSafeEqual, fallback to bcrypt for legacy sessions)
    let isMatch = false;
    if (session.refreshHash.startsWith('$2')) {
      isMatch = await bcrypt.compare(payload.tokenKey, session.refreshHash);
    } else {
      const computedHash = crypto
        .createHash('sha256')
        .update(payload.tokenKey)
        .digest('hex');
      const hashBuf = Buffer.from(computedHash, 'utf8');
      const storedBuf = Buffer.from(session.refreshHash, 'utf8');
      isMatch =
        hashBuf.length === storedBuf.length &&
        crypto.timingSafeEqual(hashBuf, storedBuf);
    }

    if (!isMatch) {
      // Refresh Token Reuse Detected! Revoke session family for security
      this.prisma.superAdminSession
        .updateMany({
          where: { adminId: session.adminId },
          data: { revoked: true, revokedReason: 'REUSE_DETECTED' },
        })
        .catch(() => {});

      this.prisma.securityEvent
        .create({
          data: {
            type: 'TOKEN_REUSE',
            adminId: session.adminId,
            ip,
            metadata: { sessionId: session.id, userAgent },
          },
        })
        .catch(() => {});

      throw new UnauthorizedException(
        'Security alert: Token reuse detected. Sessions revoked.',
      );
    }

    // Rotate refresh token with SHA-256
    const newRawRefreshToken = crypto.randomBytes(64).toString('hex');
    const newRefreshHash = crypto
      .createHash('sha256')
      .update(newRawRefreshToken)
      .digest('hex');

    await this.prisma.superAdminSession.update({
      where: { id: session.id },
      data: {
        refreshHash: newRefreshHash,
        lastActiveAt: new Date(),
        ip,
        userAgent,
      },
    });

    const newAccessToken = jwt.sign(
      {
        sub: session.admin.id,
        email: session.admin.email,
        name: session.admin.name,
        sessionId: session.id,
      },
      this.getAccessSecret(),
      { expiresIn: '15m' },
    );

    const newRefreshToken = jwt.sign(
      {
        sub: session.admin.id,
        sessionId: session.id,
        tokenKey: newRawRefreshToken,
      },
      this.getRefreshSecret(),
      { expiresIn: '30d' },
    );

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Revoke current session
   */
  async logout(sessionId: string) {
    if (sessionId) {
      await this.prisma.superAdminSession
        .update({
          where: { id: sessionId },
          data: { revoked: true, revokedReason: 'LOGOUT' },
        })
        .catch(() => {});
    }
    return { success: true, message: 'Logged out successfully' };
  }

  /**
   * Revoke all sessions for admin
   */
  async logoutAll(adminId: string) {
    await this.prisma.superAdminSession.updateMany({
      where: { adminId },
      data: { revoked: true, revokedReason: 'LOGOUT_ALL' },
    });
    return { success: true, message: 'All sessions revoked successfully' };
  }

  /**
   * List active sessions
   */
  async listSessions(adminId: string) {
    return this.prisma.superAdminSession.findMany({
      where: { adminId, revoked: false, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        ip: true,
        deviceName: true,
        browser: true,
        os: true,
        createdAt: true,
        lastActiveAt: true,
      },
    });
  }

  /**
   * Revoke specific session by ID
   */
  async revokeSession(adminId: string, targetSessionId: string) {
    const session = await this.prisma.superAdminSession.findUnique({
      where: { id: targetSessionId },
    });
    if (!session || session.adminId !== adminId) {
      throw new NotFoundException('Session not found');
    }
    await this.prisma.superAdminSession.update({
      where: { id: targetSessionId },
      data: { revoked: true, revokedReason: 'ADMIN_REVOKED' },
    });
    return { success: true };
  }
}
