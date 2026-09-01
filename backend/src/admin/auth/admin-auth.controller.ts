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
import type { AdminRequest } from '../../common/types/authenticated-request';
import {
  clearAdminSessionCookies,
  issueAdminSessionCookies,
} from './admin-auth-cookies';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): string {
    return issueAdminSessionCookies(res, accessToken, refreshToken).csrfToken;
  }

  private clearAuthCookies(res: Response) {
    clearAdminSessionCookies(res);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AdminLoginDto, @Req() req: AdminRequest) {
    const ip =
      (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    return this.authService.login(dto, ip, userAgent);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: any,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const result = await this.authService.verifyOtp(dto, ip, userAgent);

    if ('accessToken' in result) {
      const csrfToken = this.setAuthCookies(
        res,
        result.accessToken,
        result.refreshToken,
      );
      return { success: true, admin: result.admin, csrfToken };
    }

    return result;
  }

  @Post('verify-totp')
  @HttpCode(HttpStatus.OK)
  async verifyTotp(
    @Body() dto: VerifyTotpDto,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: any,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string) || req.ip || '0.0.0.0';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const result = await this.authService.verifyTotp(dto, ip, userAgent);

    const csrfToken = this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
    );
    return { success: true, admin: result.admin, csrfToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: any,
  ) {
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
      const csrfToken = this.setAuthCookies(
        res,
        result.accessToken,
        result.refreshToken,
      );
      // Rotated with the access token, so the client must take the new value —
      // the old one stops matching the cookie the moment this responds.
      return { success: true, csrfToken };
    } catch (err) {
      this.clearAuthCookies(res);
      throw err;
    }
  }

  /**
   * Also echoes the session's current CSRF token.
   *
   * The admin app holds the token in memory, which a page reload discards. This
   * is the route it already calls on boot to restore the session, so returning
   * the token here is what lets a refreshed tab keep performing mutations
   * instead of silently failing every one of them until the next sign-in.
   *
   * Safe to return: the route is behind `AdminJwtGuard`, so it requires the
   * session cookie, and CORS stops a cross-site page from reading the response.
   * An attacker who could read this could already read the session itself.
   */
  @UseGuards(AdminJwtGuard)
  @Get('me')
  getProfile(@Req() req: AdminRequest) {
    return {
      success: true,
      admin: req.admin,
      csrfToken: req.cookies?.admin_csrf ?? null,
    };
  }

  @UseGuards(AdminJwtGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: AdminRequest, @Res({ passthrough: true }) res: any) {
    if (req.adminSession?.id) {
      await this.authService.logout(req.adminSession.id);
    }
    this.clearAuthCookies(res);
    return { success: true, message: 'Logged out' };
  }

  @UseGuards(AdminJwtGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: any,
  ) {
    await this.authService.logoutAll(req.admin.id);
    this.clearAuthCookies(res);
    return { success: true, message: 'Logged out from all devices' };
  }

  @UseGuards(AdminJwtGuard)
  @Get('sessions')
  async listSessions(@Req() req: AdminRequest) {
    return this.authService.listSessions(req.admin.id);
  }

  @UseGuards(AdminJwtGuard)
  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.authService.revokeSession(req.admin.id, id);
  }
}
