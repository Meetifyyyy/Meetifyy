import { Test, TestingModule } from '@nestjs/testing';
import { AdminVerificationController } from './admin-verification.controller';
import { AdminVerificationService } from './admin-verification.service';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { VerificationStatus } from '@prisma/client';

describe('AdminVerificationController', () => {
  let controller: AdminVerificationController;
  let service: AdminVerificationService;

  const mockAdminVerificationService = {
    listRequests: jest.fn(),
    updateStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminVerificationController],
      providers: [
        {
          provide: AdminVerificationService,
          useValue: mockAdminVerificationService,
        },
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<AdminVerificationController>(
      AdminVerificationController,
    );
    service = module.get<AdminVerificationService>(AdminVerificationService);
    jest.clearAllMocks();
  });

  describe('listRequests', () => {
    it('should call listRequests on service with correct params', async () => {
      const statusResponse = { total: 10, requests: [] };
      mockAdminVerificationService.listRequests.mockResolvedValue(
        statusResponse,
      );

      const result = await controller.listRequests(
        VerificationStatus.PENDING,
        '10',
        '5',
      );

      expect(service.listRequests).toHaveBeenCalledWith(
        VerificationStatus.PENDING,
        10,
        5,
      );
      expect(result).toEqual(statusResponse);
    });

    it('should use default limit and offset if not provided', async () => {
      mockAdminVerificationService.listRequests.mockResolvedValue({});

      await controller.listRequests(VerificationStatus.PENDING);

      expect(service.listRequests).toHaveBeenCalledWith(
        VerificationStatus.PENDING,
        20,
        0,
      );
    });
  });

  describe('updateStatus', () => {
    /** What AdminJwtGuard attaches after verifying the admin session. */
    const req = { admin: { id: 'super-admin-7' } };

    it('should call updateStatus on service with correct params', async () => {
      const updateResponse = {
        request: { id: 'req-1' },
        user: { id: 'user-1' },
      };
      mockAdminVerificationService.updateStatus.mockResolvedValue(
        updateResponse,
      );

      const result = await controller.updateStatus(
        req,
        'req-1',
        VerificationStatus.VERIFIED,
        'Looks good',
      );

      expect(service.updateStatus).toHaveBeenCalledWith(
        'req-1',
        VerificationStatus.VERIFIED,
        'Looks good',
        'super-admin-7',
      );
      expect(result).toEqual(updateResponse);
    });

    it('takes the reviewer from the session, never from the request body', async () => {
      mockAdminVerificationService.updateStatus.mockResolvedValue({});

      await controller.updateStatus(
        // A caller trying to attribute the review to someone else.
        {
          admin: { id: 'super-admin-7' },
          body: { reviewerId: 'super-admin-1' },
        },
        'req-1',
        VerificationStatus.REJECTED,
        'Blurry',
      );

      expect(service.updateStatus).toHaveBeenCalledWith(
        'req-1',
        VerificationStatus.REJECTED,
        'Blurry',
        'super-admin-7',
      );
    });
  });
});
