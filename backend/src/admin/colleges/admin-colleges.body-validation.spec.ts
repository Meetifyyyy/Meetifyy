import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPaginationApp } from '../../common/testing/pagination-app';
import { AdminCollegesController } from './admin-colleges.controller';
import { AdminCollegesService } from './admin-colleges.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

describe('AdminCollegesController body validation', () => {
  let app: INestApplication<Server>;
  const addDomain = jest.fn((..._args: unknown[]) => Promise.resolve({}));
  const toggleDomainStatus = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );
  const updateCollegeRequestStatus = jest.fn((..._args: unknown[]) =>
    Promise.resolve({}),
  );
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: AdminCollegesController,
      guards: [AdminJwtGuard],
      validate: true,
      providers: [
        {
          provide: AdminCollegesService,
          useValue: {
            addDomain,
            toggleDomainStatus,
            updateCollegeRequestStatus,
          },
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('POST /admin/colleges/:id/domains', () => {
    it('passes the domain and the primary flag through', async () => {
      await http()
        .post('/admin/colleges/c1/domains')
        .send({ domain: 'iitd.ac.in', isPrimary: true })
        .expect(201);
      expect(addDomain).toHaveBeenCalledWith('c1', 'iitd.ac.in', true);
    });

    it('leaves the primary flag unset when it is not sent', async () => {
      await http()
        .post('/admin/colleges/c1/domains')
        .send({ domain: 'iitd.ac.in' })
        .expect(201);
      expect(addDomain).toHaveBeenCalledWith('c1', 'iitd.ac.in', undefined);
    });

    it.each([
      ['an empty domain', { domain: '' }],
      ['an over-long domain', { domain: 'a'.repeat(254) }],
      ['a numeric domain', { domain: 5 }],
      ['an array domain', { domain: ['a.edu'] }],
      ['a missing domain', {}],
      ['a non-boolean flag', { domain: 'a.edu', isPrimary: 'yes' }],
      ['an undeclared field', { domain: 'a.edu', a: 1 }],
    ])('refuses %s', async (_l, body) => {
      await http().post('/admin/colleges/c1/domains').send(body).expect(400);
      expect(addDomain).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /admin/colleges/:id/domains/:domainId/status', () => {
    it.each(['ACTIVE', 'DISABLED'])('accepts %s', async (status) => {
      await http()
        .patch('/admin/colleges/c1/domains/d1/status')
        .send({ status })
        .expect(200);
      expect(toggleDomainStatus).toHaveBeenCalledWith('c1', 'd1', status);
    });

    it.each([
      ['an unknown status', { status: 'PENDING' }],
      ['a lower-case status', { status: 'active' }],
      ['a number', { status: 1 }],
      ['a missing status', {}],
    ])('refuses %s', async (_l, body) => {
      await http()
        .patch('/admin/colleges/c1/domains/d1/status')
        .send(body)
        .expect(400);
      expect(toggleDomainStatus).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /admin/colleges/requests/:requestId/status', () => {
    it('passes the status to the service, which decides what is valid', async () => {
      await http()
        .patch('/admin/colleges/requests/r1/status')
        .send({ status: 'added' })
        .expect(200);
      expect(updateCollegeRequestStatus).toHaveBeenCalledWith('r1', 'added');
    });

    it.each([
      ['an over-long status', { status: 'A'.repeat(33) }],
      ['a number', { status: 1 }],
      ['an array', { status: ['ADDED'] }],
      ['a missing status', {}],
      ['an undeclared field', { status: 'ADDED', a: 1 }],
    ])('refuses %s', async (_l, body) => {
      await http()
        .patch('/admin/colleges/requests/r1/status')
        .send(body)
        .expect(400);
      expect(updateCollegeRequestStatus).not.toHaveBeenCalled();
    });
  });
});
