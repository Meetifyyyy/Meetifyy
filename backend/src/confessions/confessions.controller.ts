import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-request';
import { clampPageParam, singleQueryValue } from '../common/pagination.util';
import { CampusAccessService } from '../common/campus/campus-access.service';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitPolicyGuard } from '../common/rate-limit/rate-limit-policy.guard';
import {
  ConfessionsService,
  type ConfessionDto,
  type ConfessionPage,
  type ConfessionProfileDto,
  type HandleAvailability,
  type RelateState,
} from './confessions.service';
import {
  CreateConfessionDto,
  CreateConfessionProfileDto,
} from './dto/confession.dto';

/**
 * Anonymous campus confessions. Every route but deleting your own requires an
 * active college affiliation (403 `campus_affiliation_required`), and the campus is always
 * the affiliation's, never one from the request. Responses identify authors
 * by handle only.
 */
@Controller('api/confessions')
@UseGuards(JwtGuard)
export class ConfessionsController {
  constructor(
    private readonly service: ConfessionsService,
    private readonly campusAccess: CampusAccessService,
  ) {}

  // Static routes before `:id`.
  @Get('me')
  async me(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ profile: ConfessionProfileDto | null }> {
    await this.campusAccess.requireAffiliation(user.id);
    return this.service.getMyProfile(user.id);
  }

  @Get('handle-availability')
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('confession.handle.check')
  async handleAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Query('handle') handle?: string,
  ): Promise<HandleAvailability> {
    await this.campusAccess.requireAffiliation(user.id);
    return this.service.checkAvailability(user.id, singleQueryValue(handle));
  }

  @Post('profile')
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('confession.profile.create')
  async createProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConfessionProfileDto,
  ): Promise<{ profile: ConfessionProfileDto }> {
    await this.campusAccess.requireAffiliation(user.id);
    return this.service.createProfile(user.id, dto.handle);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ConfessionPage> {
    const { collegeId } = await this.campusAccess.requireAffiliation(user.id);
    return this.service.list(user.id, collegeId, {
      limit: clampPageParam(singleQueryValue(limit), {
        def: 20,
        max: 50,
        min: 1,
      }),
      cursor: singleQueryValue(cursor),
    });
  }

  @Post()
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('confession.create', 'confession.create.daily')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConfessionDto,
  ): Promise<{ confession: ConfessionDto }> {
    const { collegeId } = await this.campusAccess.requireAffiliation(user.id);
    return this.service.create(user.id, collegeId, dto.content);
  }

  @Post(':id/relate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('confession.relate')
  async relate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RelateState> {
    const { collegeId } = await this.campusAccess.requireAffiliation(user.id);
    return this.service.relate(user.id, collegeId, id);
  }

  @Delete(':id/relate')
  @UseGuards(RateLimitPolicyGuard)
  @RateLimit('confession.relate')
  async unrelate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RelateState> {
    const { collegeId } = await this.campusAccess.requireAffiliation(user.id);
    return this.service.unrelate(user.id, collegeId, id);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    // No affiliation check: deleting your own confession needs only that it
    // is yours (see ConfessionsService.remove).
    return this.service.remove(user.id, id);
  }
}
