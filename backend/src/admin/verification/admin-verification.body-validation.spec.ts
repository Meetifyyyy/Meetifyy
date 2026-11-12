import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { VerificationStatus } from '@prisma/client';
import { createPaginationApp } from '../../common/testing/pagination-app';
import { AdminVerificationController } from './admin-verification.controller';
import { AdminVerificationService } from './admin-verification.service';
import { MAX_VERIFICATION_NOTES_LENGTH } from './dto/update-verification-status.dto';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';

describe('AdminVerificationController body validation', () => {
  let app: INestApplication<Server>;
  const updateStatus = jest.fn((..._args: unknown[]) => Promise.resolve({}));

  beforeAll(async () => {
    app = await createPaginationApp({
      controller: AdminVerificationController,
      guards: [AdminJwtGuard],
      validate: true,
      providers: [
        { provide: AdminVerificationService, useValue: { updateStatus } },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const patch = (body: unknown) =>
    request(app.getHttpServer())
      .patch('/admin/verification/requests/r1/status')
      .send(body as object);

  it('passes what the review screen sends, with the reviewer from the session', async () => {
    await patch({
      status: VerificationStatus.REJECTED,
      adminNotes: 'Photo is blurry',
    }).expect(200);
    expect(updateStatus).toHaveBeenCalledWith(
      'r1',
      VerificationStatus.REJECTED,
      'Photo is blurry',
      'admin-1',
    );
  });

  it('accepts an approval with no notes (the screen sends adminNotes undefined)', async () => {
    await patch({ status: VerificationStatus.VERIFIED }).expect(200);
    expect(updateStatus).toHaveBeenCalledWith(
      'r1',
      VerificationStatus.VERIFIED,
      undefined,
      'admin-1',
    );
  });

  it('accepts notes of exactly the limit and refuses more', async () => {
    await patch({
      status: VerificationStatus.REJECTED,
      adminNotes: 'n'.repeat(MAX_VERIFICATION_NOTES_LENGTH),
    }).expect(200);
    await patch({
      status: VerificationStatus.REJECTED,
      adminNotes: 'n'.repeat(MAX_VERIFICATION_NOTES_LENGTH + 1),
    }).expect(400);
    expect(updateStatus).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an unknown status', { status: 'MAYBE' }],
    ['a missing status', { adminNotes: 'x' }],
    ['a numeric status', { status: 1 }],
    ['an array of notes', { status: 'REJECTED', adminNotes: ['x'] }],
    ['an object as notes', { status: 'REJECTED', adminNotes: { a: 1 } }],
    ['a reviewer id in the body', { status: 'VERIFIED', reviewerId: 'x' }],
  ])('refuses %s', async (_l, body) => {
    await patch(body).expect(400);
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
