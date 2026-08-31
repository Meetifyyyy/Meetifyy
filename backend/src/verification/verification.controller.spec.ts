import { Test, TestingModule } from '@nestjs/testing';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { JwtGuard } from '../common/guards';

describe('VerificationController', () => {
  let controller: VerificationController;
  let service: VerificationService;

  const mockVerificationService = {
    submitVerification: jest.fn(),
    getStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VerificationController],
      providers: [
        {
          provide: VerificationService,
          useValue: mockVerificationService,
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<VerificationController>(VerificationController);
    service = module.get<VerificationService>(VerificationService);
    jest.clearAllMocks();
  });

  describe('submitVerification', () => {
    it('should call submitVerification on service with correct params', async () => {
      const userId = 'user-1';
      const body = { selfieMediaId: 'selfie-1', idCardMediaId: 'id-1' };
      mockVerificationService.submitVerification.mockResolvedValue({
        id: 'req-1',
      });

      const result = await controller.submitVerification(userId, body);

      expect(service.submitVerification).toHaveBeenCalledWith(
        userId,
        body.selfieMediaId,
        body.idCardMediaId,
      );
      expect(result).toEqual({ id: 'req-1' });
    });
  });

  describe('getStatus', () => {
    it('should call getStatus on service with correct params', async () => {
      const userId = 'user-1';
      const statusResponse = { status: 'UNVERIFIED', request: null };
      mockVerificationService.getStatus.mockResolvedValue(statusResponse);

      const result = await controller.getStatus(userId);

      expect(service.getStatus).toHaveBeenCalledWith(userId);
      expect(result).toEqual(statusResponse);
    });
  });
});
