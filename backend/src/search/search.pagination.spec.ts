import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { createPaginationApp } from '../common/testing/pagination-app';

describe('SearchController pagination', () => {
  let app: INestApplication<Server>;
  const globalSearch = jest.fn((..._args: unknown[]) => Promise.resolve({}));

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: SearchController,
      guards: [JwtGuard],
      providers: [{ provide: SearchService, useValue: { globalSearch } }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => globalSearch.mockClear());

  it('clamps a huge limit before it reaches the service', async () => {
    await request(app.getHttpServer())
      .get('/api/search?q=a&limit=100000')
      .expect(200);
    expect(globalSearch.mock.calls[0][2]).toBe(50);
  });

  it('keeps the default of 15 for junk and for a missing limit', async () => {
    await request(app.getHttpServer())
      .get('/api/search?q=a&limit=abc')
      .expect(200);
    await request(app.getHttpServer()).get('/api/search?q=a').expect(200);
    expect(globalSearch.mock.calls[0][2]).toBe(15);
    expect(globalSearch.mock.calls[1][2]).toBe(15);
  });
});
