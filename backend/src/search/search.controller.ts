import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { SearchService } from './search.service';
import { JwtGuard } from '../common/guards/jwt.guard';

@Controller('api/search')
@UseGuards(JwtGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(
    @Req() req: any,
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    const currentUserId = req.user?.id;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.searchService.globalSearch(query, currentUserId, limitNum);
  }
}
