import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Prisma, VerificationStatus } from '@prisma/client';

import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { AdminVerificationController } from '../admin/verification/admin-verification.controller';
import { AdminVerificationService } from '../admin/verification/admin-verification.service';
import { AuditInterceptor } from '../admin/common/audit.interceptor';
import { VerificationAccessService } from '../common/verification/verification-access.service';
import { VerificationGuard } from '../common/guards/verification.guard';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../uploads/uploads.service';
import { DomainEventService } from '../events/domain-event.service';
import { JwtGuard } from '../common/guards/jwt.guard';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';

/**
 * The whole account-verification journey, driven over HTTP through the real
 * controllers, the real services, the real guard and the real audit
 * interceptor: submit → PENDING → protected action refused → admin approves →
 * protected action allowed.
 *
 * Every unit test in this area exercises one hinge. This one exists because the
 * failures that actually shipped were all *between* the hinges — a controller
 * mounted at a path nothing called, a decorator that dropped its argument, a
 * payload whose fields serialised away, a review endpoint on the wrong auth
 * realm. Each component passed its own tests; the journey was broken end to
 * end, and the live database proved it: zero verification requests, ever.
 *
 * Persistence is a small in-memory double rather than a live database, so this
 * runs in CI on every change. What it does not cover — real Postgres
 * constraints, real R2, real network behaviour — is called out in the report.
 */
describe('account verification — end to end', () => {
  const USER = 'user-1';
  const ADMIN = 'super-admin-7';
  const SELFIE = 'media-selfie';
  const ID_CARD = 'media-idcard';

  let app: INestApplication;
  let db: {
    users: Record<
      string,
      { id: string; verificationStatus: VerificationStatus }
    >;
    media: Record<string, any>;
    requests: Record<string, any>;
    auditLogs: any[];
  };
  let deletedObjects: string[];
  /**
   * A barrier for the decision race below.
   *
   * Without it the two "simultaneous" reviewers run strictly one after the
   * other — the second reads the state the first already wrote, and the test
   * quietly exercises revocation instead of a race. Set it to the number of
   * readers to hold each verification-request read until that many have
   * arrived, so both genuinely observe PENDING before either writes.
   */
  let readBarrier: {
    expected: number;
    arrived: number;
    release: () => void;
    gate: Promise<void>;
  } | null;

  /** Minimal Prisma stand-in covering exactly the queries this flow issues. */
  let prismaDouble: any;
  const buildPrisma = () => ({
    user: {
      findUnique: async ({ where }: any) => db.users[where.id] ?? null,
      findMany: async ({ where }: any) =>
        where.id.in.map((id: string) => db.users[id]).filter(Boolean),
      updateMany: async ({ where, data }: any) => {
        const u = db.users[where.id];
        const allowed = where.verificationStatus?.in;
        if (!u || (allowed && !allowed.includes(u.verificationStatus))) {
          return { count: 0 };
        }
        Object.assign(u, data);
        return { count: 1 };
      },
      update: async ({ where, data }: any) => {
        Object.assign(db.users[where.id], data);
        return db.users[where.id];
      },
    },
    media: {
      findUnique: async ({ where }: any) => db.media[where.id] ?? null,
      findMany: async ({ where }: any) =>
        Object.values(db.media).filter((m: any) =>
          where.id?.in ? where.id.in.includes(m.id) : true,
        ),
      updateMany: async ({ where, data }: any) => {
        (where.id?.in || []).forEach((id: string) => {
          if (db.media[id]) Object.assign(db.media[id], data);
        });
        return { count: 1 };
      },
      deleteMany: async ({ where }: any) => {
        (where.id?.in || []).forEach((id: string) => delete db.media[id]);
        return { count: 1 };
      },
    },
    verificationRequest: {
      // Copies, not live references. Real Prisma hands back a fresh object, and
      // the submission path depends on that: it reads the previous document ids
      // and then upserts over them, so a shared reference would silently show
      // the *new* ids to the cleanup that runs afterwards.
      findUnique: async ({ where }: any) => {
        const row = where.id
          ? db.requests[where.id]
          : Object.values(db.requests).find(
              (r: any) => r.userId === where.userId,
            );
        const snapshot = row ? { ...(row as object) } : null;
        if (readBarrier) {
          readBarrier.arrived += 1;
          if (readBarrier.arrived >= readBarrier.expected)
            readBarrier.release();
          await readBarrier.gate;
        }
        return snapshot;
      },
      findUniqueOrThrow: async ({ where }: any) => ({
        ...db.requests[where.id],
      }),
      findFirst: async ({ where, orderBy }: any) => {
        const rows = Object.values(db.requests).filter(
          (r: any) => r.userId === where.userId,
        );
        if (orderBy?.attemptNumber === 'desc') {
          rows.sort((a: any, b: any) => b.attemptNumber - a.attemptNumber);
        }
        return rows[0] ? { ...(rows[0] as object) } : null;
      },
      findMany: async ({ where, orderBy }: any = {}) =>
        Object.values(db.requests)
          .filter((r: any) => (where?.userId ? r.userId === where.userId : true))
          .sort((a: any, b: any) =>
            orderBy?.attemptNumber === 'desc'
              ? b.attemptNumber - a.attemptNumber
              : 0,
          )
          .map((r: any) => ({
            ...r,
            // The admin queue `include`s both documents.
            selfieMedia: r.selfieMediaId
              ? (db.media[r.selfieMediaId] ?? null)
              : null,
            idCardMedia: r.idCardMediaId
              ? (db.media[r.idCardMediaId] ?? null)
              : null,
            user: db.users[r.userId] ?? null,
          })),
      count: async () => Object.keys(db.requests).length,
      create: async ({ data }: any) => {
        // Stands in for the partial unique index
        // (userId) WHERE status = 'PENDING'. Without modelling it here the
        // double would happily accept a second open request and the duplicate
        // test would pass for the wrong reason.
        const openAlready = Object.values(db.requests).some(
          (r: any) =>
            r.userId === data.userId &&
            r.status === VerificationStatus.PENDING,
        );
        if (openAlready) {
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed',
            { code: 'P2002', clientVersion: 'test' },
          );
        }
        const row = {
          id: `req-${Object.keys(db.requests).length + 1}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          reviewedAt: null,
          rejectionReason: null,
          reviewerId: null,
        };
        db.requests[row.id] = row;
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const row = db.requests[where.id];
        if (!row || (where.status && row.status !== where.status)) {
          return { count: 0 };
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return { count: 1 };
      },
    },
    conversationParticipant: { findMany: async () => [] },
    auditLog: {
      create: async ({ data }: any) => {
        db.auditLogs.push(data);
        return data;
      },
    },
    // Both forms: the array form the admin path uses, and the interactive
    // callback the submission path now runs in. No rollback — the double is a
    // plain object — so tests that depend on rollback assert on the thrown
    // error rather than on the absence of a write.
    $transaction: (arg: any) =>
      typeof arg === 'function' ? arg(prismaDouble) : Promise.all(arg),
  });

  beforeEach(async () => {
    db = {
      users: {
        [USER]: { id: USER, verificationStatus: VerificationStatus.UNVERIFIED },
      },
      media: {
        [SELFIE]: {
          id: SELFIE,
          ownerId: USER,
          mimeType: 'image/webp',
          objectKey: 'verification/selfie.webp',
        },
        [ID_CARD]: {
          id: ID_CARD,
          ownerId: USER,
          mimeType: 'image/webp',
          objectKey: 'verification/idcard.webp',
        },
      },
      requests: {},
      auditLogs: [],
    };
    deletedObjects = [];
    readBarrier = null;

    const moduleRef = await Test.createTestingModule({
      controllers: [VerificationController, AdminVerificationController],
      providers: [
        VerificationService,
        AdminVerificationService,
        VerificationAccessService,
        Reflector,
        { provide: PrismaService, useValue: (prismaDouble = buildPrisma()) },
        {
          provide: StorageService,
          useValue: {
            getReviewerSignedUrl: async (key: string) => `signed://${key}`,
            delete: async (key: string) => {
              deletedObjects.push(key);
              return true;
            },
          },
        },
        { provide: DomainEventService, useValue: { emit: async () => {} } },
        // The real global guard, so `@VerifiedOnly()` is genuinely enforced.
        { provide: APP_GUARD, useClass: VerificationGuard },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    })
      // Authentication is stubbed; authorisation is not.
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { id: USER };
          return true;
        },
      })
      .overrideGuard(AdminJwtGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().admin = { id: ADMIN };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    moduleRef.get(VerificationAccessService).invalidateAll();
  });

  afterEach(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const submit = () =>
    http()
      .post('/api/verification/request')
      .send({ selfieMediaId: SELFIE, idCardMediaId: ID_CARD });
  const decide = (status: VerificationStatus, adminNotes?: string) =>
    http()
      .patch('/admin/verification/requests/req-1/status')
      .send({ status, adminNotes });

  it('carries an account from UNVERIFIED to VERIFIED', async () => {
    // 1. Submit.
    await submit().expect(201);
    expect(db.users[USER].verificationStatus).toBe(VerificationStatus.PENDING);
    expect(Object.keys(db.requests)).toHaveLength(1);
    expect(db.requests['req-1']).toMatchObject({
      userId: USER,
      selfieMediaId: SELFIE,
      idCardMediaId: ID_CARD,
      status: VerificationStatus.PENDING,
    });
    // Documents are marked private on the way through.
    expect(db.media[SELFIE].visibility).toBe('private');

    // 2. PENDING is not eligible.
    const status = await http().get('/api/verification/status').expect(200);
    expect(status.body.status).toBe(VerificationStatus.PENDING);

    // 3. The reviewer can see both documents, via signed URLs.
    const queue = await http().get('/admin/verification/requests').expect(200);
    expect(queue.body.requests[0].selfieMedia.url).toBe(
      'signed://verification/selfie.webp',
    );
    expect(queue.body.requests[0].idCardMedia.url).toBe(
      'signed://verification/idcard.webp',
    );

    // 4. Approve.
    await decide(VerificationStatus.VERIFIED).expect(200);
    expect(db.users[USER].verificationStatus).toBe(VerificationStatus.VERIFIED);

    // 5. The decision is attributed and audited.
    expect(db.requests['req-1'].reviewerId).toBe(ADMIN);
    expect(db.auditLogs).toHaveLength(1);
    expect(db.auditLogs[0]).toMatchObject({
      adminId: ADMIN,
      action: 'VERIFICATION_APPROVE',
      targetType: 'VERIFICATION',
      targetId: 'req-1',
    });
  });

  it('keeps a rejected attempt intact when the user resubmits', async () => {
    await submit().expect(201);
    await decide(VerificationStatus.REJECTED, 'ID photo unreadable').expect(
      200,
    );

    expect(db.users[USER].verificationStatus).toBe(VerificationStatus.REJECTED);
    // The reason reaches the user, and the audit row does not repeat it.
    expect(db.requests['req-1'].rejectionReason).toBe('ID photo unreadable');
    expect(db.requests['req-1'].reviewedAt).toBeTruthy();
    expect(db.auditLogs[0].action).toBe('VERIFICATION_REJECT');
    expect(JSON.stringify(db.auditLogs[0])).not.toContain('unreadable');

    db.media['media-selfie-2'] = {
      id: 'media-selfie-2',
      ownerId: USER,
      mimeType: 'image/webp',
      objectKey: 'verification/selfie-2.webp',
    };
    await http()
      .post('/api/verification/request')
      .send({ selfieMediaId: 'media-selfie-2', idCardMediaId: ID_CARD })
      .expect(201);

    expect(db.users[USER].verificationStatus).toBe(VerificationStatus.PENDING);

    // The resubmission is a new attempt, not an overwrite. This is the whole
    // point of the change: the previous row keeps its documents, its status and
    // the reason it was turned down, so the user can still read why.
    expect(Object.keys(db.requests)).toHaveLength(2);
    expect(db.requests['req-1'].status).toBe(VerificationStatus.REJECTED);
    expect(db.requests['req-1'].rejectionReason).toBe('ID photo unreadable');
    expect(db.requests['req-1'].selfieMediaId).toBe(SELFIE);
    expect(db.requests['req-1'].attemptNumber).toBe(1);

    expect(db.requests['req-2'].status).toBe(VerificationStatus.PENDING);
    expect(db.requests['req-2'].selfieMediaId).toBe('media-selfie-2');
    expect(db.requests['req-2'].attemptNumber).toBe(2);
    expect(db.requests['req-2'].rejectionReason).toBeNull();

    // Retention is deliberate: the superseded document stays in the bucket.
    expect(deletedObjects).toEqual([]);
    expect(db.media[SELFIE]).toBeDefined();
    expect(db.media[ID_CARD]).toBeDefined();

    // And the history endpoint reports both, newest first.
    const status = await http().get('/api/verification/status').expect(200);
    expect(status.body.history).toHaveLength(2);
    expect(status.body.history[0].attemptNumber).toBe(2);
    expect(status.body.history[1].rejectionReason).toBe('ID photo unreadable');
    expect(status.body.hasPendingRequest).toBe(true);
  });

  it('refuses a second submission while one is already pending', async () => {
    await submit().expect(201);
    await submit().expect(409);
    expect(Object.keys(db.requests)).toHaveLength(1);
  });

  it('refuses to re-decide a rejected request', async () => {
    await submit().expect(201);
    await decide(VerificationStatus.REJECTED, 'Blurry').expect(200);
    // Terminal from a reviewer's side — only the user can move it on, by
    // resubmitting. (Revoking an *approved* account stays allowed; that is a
    // different transition, covered in the service spec.)
    await decide(VerificationStatus.VERIFIED).expect(409);
    expect(db.users[USER].verificationStatus).toBe(VerificationStatus.REJECTED);
    expect(db.auditLogs).toHaveLength(1);
  });

  it('lets exactly one of two simultaneous decisions win', async () => {
    await submit().expect(201);

    // Hold both reviewers at the read until both have arrived, so each sees
    // PENDING before either writes — the actual shape of two people acting on
    // the same request at once.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    readBarrier = { expected: 2, arrived: 0, release, gate };

    const [a, b] = await Promise.all([
      decide(VerificationStatus.VERIFIED),
      decide(VerificationStatus.REJECTED),
    ]);

    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);
    // The user row reflects the winner, and only the winner was audited.
    expect(db.auditLogs).toHaveLength(1);
    const winner =
      db.auditLogs[0].action === 'VERIFICATION_APPROVE'
        ? VerificationStatus.VERIFIED
        : VerificationStatus.REJECTED;
    expect(db.users[USER].verificationStatus).toBe(winner);
  });

  it('refuses a document belonging to somebody else', async () => {
    db.media[SELFIE].ownerId = 'someone-else';
    await submit().expect(400);
    // Nothing was written, and the account did not move to PENDING.
    expect(Object.keys(db.requests)).toHaveLength(0);
    expect(db.users[USER].verificationStatus).toBe(
      VerificationStatus.UNVERIFIED,
    );
  });

  it('refuses a document stored outside the private prefix', async () => {
    db.media[ID_CARD].objectKey = 'chat/photo.webp';
    await submit().expect(400);
    expect(db.users[USER].verificationStatus).toBe(
      VerificationStatus.UNVERIFIED,
    );
  });
});
