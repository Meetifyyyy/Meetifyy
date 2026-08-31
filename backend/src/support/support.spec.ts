import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SupportCategory } from '@prisma/client';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';
import { PUBLIC_SUPPORT_CATEGORIES } from './support.constants';

describe('Support Request Validation & Security', () => {
  function createDto(overrides: Partial<Record<string, any>> = {}) {
    const raw = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      category: SupportCategory.TECHNICAL,
      subject: 'Login page button is unresponsive',
      description:
        'Whenever I click the submit button, nothing happens at all.',
      ...overrides,
    };
    return plainToInstance(CreateSupportRequestDto, raw);
  }

  describe('CreateSupportRequestDto field validation', () => {
    it('passes for a valid payload with all compulsory fields', async () => {
      const dto = createDto();
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    describe('name (compulsory)', () => {
      it('rejects when name is missing or undefined', async () => {
        const dto = createDto({ name: undefined });
        const errors = await validate(dto);
        const nameError = errors.find((e) => e.property === 'name');
        expect(nameError).toBeDefined();
      });

      it('rejects when name is empty or only whitespace', async () => {
        const dto = createDto({ name: '   ' });
        const errors = await validate(dto);
        const nameError = errors.find((e) => e.property === 'name');
        expect(nameError).toBeDefined();
      });

      it('rejects when name is shorter than 2 characters', async () => {
        const dto = createDto({ name: 'J' });
        const errors = await validate(dto);
        const nameError = errors.find((e) => e.property === 'name');
        expect(nameError).toBeDefined();
      });

      it('rejects when name exceeds 100 characters', async () => {
        const dto = createDto({ name: 'A'.repeat(101) });
        const errors = await validate(dto);
        const nameError = errors.find((e) => e.property === 'name');
        expect(nameError).toBeDefined();
      });

      it('accepts a valid name and trims surrounding whitespace', async () => {
        const dto = createDto({ name: '  Jane Smith  ' });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
        expect(dto.name).toBe('Jane Smith');
      });
    });

    describe('email (compulsory)', () => {
      it('rejects when email is missing or empty', async () => {
        const dto = createDto({ email: '' });
        const errors = await validate(dto);
        const emailError = errors.find((e) => e.property === 'email');
        expect(emailError).toBeDefined();
      });

      it('rejects invalid email formats', async () => {
        const dto = createDto({ email: 'not-an-email' });
        const errors = await validate(dto);
        const emailError = errors.find((e) => e.property === 'email');
        expect(emailError).toBeDefined();
      });

      it('accepts valid email and trims whitespace', async () => {
        const dto = createDto({ email: '  user@college.edu  ' });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
        expect(dto.email).toBe('user@college.edu');
      });
    });

    describe('category (compulsory)', () => {
      it('rejects when category is missing or empty', async () => {
        const dto = createDto({ category: undefined });
        const errors = await validate(dto);
        const categoryError = errors.find((e) => e.property === 'category');
        expect(categoryError).toBeDefined();
      });

      it('rejects invalid category string', async () => {
        const dto = createDto({ category: 'INVALID_CATEGORY' });
        const errors = await validate(dto);
        const categoryError = errors.find((e) => e.property === 'category');
        expect(categoryError).toBeDefined();
      });

      it.each(PUBLIC_SUPPORT_CATEGORIES)(
        'accepts public category %s',
        async (category) => {
          const dto = createDto({ category });
          const errors = await validate(dto);
          expect(errors.length).toBe(0);
        },
      );
    });

    describe('subject (compulsory)', () => {
      it('rejects when subject is missing or empty', async () => {
        const dto = createDto({ subject: '   ' });
        const errors = await validate(dto);
        const subjectError = errors.find((e) => e.property === 'subject');
        expect(subjectError).toBeDefined();
      });

      it('rejects when subject is under 3 characters', async () => {
        const dto = createDto({ subject: 'Hi' });
        const errors = await validate(dto);
        const subjectError = errors.find((e) => e.property === 'subject');
        expect(subjectError).toBeDefined();
      });

      it('rejects when subject exceeds 200 characters', async () => {
        const dto = createDto({ subject: 'S'.repeat(201) });
        const errors = await validate(dto);
        const subjectError = errors.find((e) => e.property === 'subject');
        expect(subjectError).toBeDefined();
      });
    });

    describe('description (compulsory)', () => {
      it('rejects when description is missing or empty', async () => {
        const dto = createDto({ description: '   ' });
        const errors = await validate(dto);
        const descError = errors.find((e) => e.property === 'description');
        expect(descError).toBeDefined();
      });

      it('rejects when description is under 20 characters', async () => {
        const dto = createDto({ description: 'Too short message' });
        const errors = await validate(dto);
        const descError = errors.find((e) => e.property === 'description');
        expect(descError).toBeDefined();
      });

      it('rejects when description exceeds 10000 characters', async () => {
        const dto = createDto({ description: 'D'.repeat(10001) });
        const errors = await validate(dto);
        const descError = errors.find((e) => e.property === 'description');
        expect(descError).toBeDefined();
      });
    });

    describe('attachments (optional)', () => {
      it('accepts valid attachment objects', async () => {
        const dto = createDto({
          attachments: [
            { key: 'support/abcdef123456.png', filename: 'screenshot.png' },
          ],
        });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });

      it('rejects attachment with missing or empty key', async () => {
        const dto = createDto({
          attachments: [{ key: '   ', filename: 'screenshot.png' }],
        });
        const errors = await validate(dto);
        const attachError = errors.find((e) => e.property === 'attachments');
        expect(attachError).toBeDefined();
      });
    });
  });
});
