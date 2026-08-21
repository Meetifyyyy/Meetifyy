import { Controller, Get } from '@nestjs/common';
import { AcademicsService } from './academics.service';
import { CacheControl } from '../common/decorators/cache-control.decorator';

@Controller('api/academics')
export class AcademicsController {
  constructor(private readonly academicsService: AcademicsService) {}

  /**
   * GET /api/academics/catalog
   *
   * The client renders its dropdowns from this rather than shipping its own copy
   * of the course list, so there is exactly one definition of what a valid
   * Course/Branch/Year is and the UI cannot drift from what the server accepts.
   *
   * Deliberately unauthenticated: signup needs it before a session exists, and
   * it is public reference data. It changes about once a year, hence the long
   * cache window.
   */
  @Get('catalog')
  @CacheControl('public, max-age=86400, stale-while-revalidate=604800')
  getCatalog() {
    return { courses: this.academicsService.getCatalog() };
  }
}
