import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  Param,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminAuthService } from './admin-auth.service';
import {
  AdminLoginDto,
  VerifyOtpDto,
  VerifyTotpDto,
} from './dto/admin-auth.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import * as crypto from 'crypto';
import { config } from '../../config';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  /**
   * Cookie domain / secure / sameSite all come from configuration, so the same
   * code issues host-only insecure cookies in local development and
   * domain-scoped Secure cookies in production, without a branch.
   */
  private get cookieBase() {
    const { domain, secure, sameSite, path } = config.auth.cookie;
    return { domain, secure, sameSite, path } as const;
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const { accessMaxAgeMs, refreshMaxAgeMs } = config.auth.cookie;

    res.cookie('admin_access', accessToken, {
      ...this.cookieBase,
      httpOnly: true,
      maxAge: accessMaxAgeMs,
    });

    res.cookie('admin_refresh', refreshToken, {
      ...this.cookieBase,
      httpOnly: true,
      maxAge: refreshMaxAgeMs,
    });

    res.cookie('admin_csrf', csrfToken, {
      ...this.cookieBase,
      httpOnly: false, // exposed to frontend JS to attach as X-CSRF-Token header
      maxAge: accessMaxAgeMs,
    });
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie('admin_access', { ...this.cookieBase, httpOnly: true });
    res.clearCookie('admin_refresh', { ...this.cookieBase, httpOnly: true });
    res.clearCookie('admin_csrf', { ...this.cookieBase });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AdminLoginDto, @Req() req: any) {
    const ip =
      (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    return this.authService.login(dto, ip, userAgent);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const result = await this.authService.verifyOtp(dto, ip, userAgent);

    if ('accessToken' in result) {
      this.setAuthCookies(res, result.accessToken, result.refreshToken);
      return { success: true, admin: result.admin };
    }

    return result;
  }

  @Post('verify-totp')
  @HttpCode(HttpStatus.OK)
  async verifyTotp(
    @Body() dto: VerifyTotpDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const result = await this.authService.verifyTotp(dto, ip, userAgent);

    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { success: true, admin: result.admin };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const refreshToken = req.cookies?.admin_refresh || req.body?.refreshToken;
    if (!refreshToken) {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token missing');
    }

    const ip =
      (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    try {
      const result = await this.authService.refreshTokens(
        refreshToken,
        ip,
        userAgent,
      );
      this.setAuthCookies(res, result.accessToken, result.refreshToken);
      return { success: true };
    } catch (err) {
      this.clearAuthCookies(res);
      throw err;
    }
  }

  @UseGuards(AdminJwtGuard)
  @Get('me')
  async getProfile(@Req() req: any) {
    return { success: true, admin: req.admin };
  }

  @UseGuards(AdminJwtGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    if (req.adminSession?.id) {
      await this.authService.logout(req.adminSession.id);
    }
    this.clearAuthCookies(res);
    return { success: true, message: 'Logged out' };
  }

  @UseGuards(AdminJwtGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.authService.logoutAll(req.admin.id);
    this.clearAuthCookies(res);
    return { success: true, message: 'Logged out from all devices' };
  }

  @UseGuards(AdminJwtGuard)
  @Get('sessions')
  async listSessions(@Req() req: any) {
    return this.authService.listSessions(req.admin.id);
  }

  @UseGuards(AdminJwtGuard)
  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Req() req: any, @Param('id') id: string) {
    return this.authService.revokeSession(req.admin.id, id);
  }
}
