import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { MAX_RECENT_SEARCH_TERM_LENGTH } from './dto/recent-search.dto';
import { JwtGuard } from '../common/guards/jwt.guard';
import { createPaginationApp } from '../common/testing/pagination-app';

describe('SearchController body validation', () => {
  let app: INestApplication<Server>;
  const addRecentSearch = jest.fn((..._args: unknown[]) => Promise.resolve([]));

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: SearchController,
      guards: [JwtGuard],
      validate: true,
      providers: [{ provide: SearchService, useValue: { addRecentSearch } }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => addRecentSearch.mockClear());

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/api/search/recent')
      .send(body as object);

  it('remembers the term the web and native apps send', async () => {
    await post({ term: 'chess club' }).expect(201);
    expect(addRecentSearch).toHaveBeenCalledWith('user-1', 'chess club');
  });

  it('accepts the length the search box allows and refuses more', async () => {
    await post({ term: 'a'.repeat(MAX_RECENT_SEARCH_TERM_LENGTH) }).expect(201);
    await post({ term: 'a'.repeat(MAX_RECENT_SEARCH_TERM_LENGTH + 1) }).expect(
      400,
    );
    expect(addRecentSearch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a number', { term: 5 }],
    ['an array', { term: ['a'] }],
    ['an object', { term: { q: 'a' } }],
    ['a missing field', {}],
    ['an undeclared field', { term: 'a', extra: 1 }],
  ])('refuses %s', async (_label, body) => {
    await post(body).expect(400);
    expect(addRecentSearch).not.toHaveBeenCalled();
  });
});
