import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { CampusEventsService } from './campus-events.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateCampusEventDto,
  UpdateCampusEventDto,
  CampusEventScope,
  CAMPUS_EVENT_SCOPES,
} from './dto/campus-event.dto';

@Controller('api/campus-events')
@UseGuards(JwtGuard)
export class CampusEventsController {
  constructor(private readonly service: CampusEventsService) {}

  @Get()
  async list(
    @CurrentUser() user: any,
    @Query('scope') scope?: string,
    @Query('campusId') campusId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const s = (scope || 'upcoming') as CampusEventScope;
    if (!CAMPUS_EVENT_SCOPES.includes(s)) {
      throw new BadRequestException(
        'scope must be one of: upcoming, ongoing, past',
      );
    }
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.service.listByScope(user?.id, s, {
      campusId: campusId || undefined,
      limit: parsedLimit,
      cursor: cursor || undefined,
    });
  }

  // Static routes before `:id`.
  @Get('mine')
  async listMine(@CurrentUser() user: any) {
    return this.service.listMine(user.id);
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getById(id, user?.id);
  }

  @Post()
  async create(@Body() dto: CreateCampusEventDto, @CurrentUser() user: any) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCampusEventDto,
    @CurrentUser() user: any,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.publish(user.id, id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(user.id, id);
  }
}
