import { Test, TestingModule } from '@nestjs/testing';
import { KeysController } from './keys.controller';

describe('KeysController', () => {
  let controller: KeysController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KeysController],
    }).compile();

    controller = module.get<KeysController>(KeysController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
