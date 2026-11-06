import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COMMUNITY_DESCRIPTION_MAX } from '../community-limits';
import { CreateCommunityDto, UpdateCommunityDto } from './community.dto';

describe('community description whitespace', () => {
  it('normalises the description on create and on edit', () => {
    const raw = '  Robotics\t\t& AI \n\n\n\n Meet   weekly.  ';
    const create = plainToInstance(CreateCommunityDto, {
      name: 'Bots',
      description: raw,
    });
    const update = plainToInstance(UpdateCommunityDto, { description: raw });
    expect(create.description).toBe('Robotics & AI\n\nMeet weekly.');
    expect(update.description).toBe('Robotics & AI\n\nMeet weekly.');
  });

  it('applies the length limit to the normalised text', async () => {
    const text = 'a'.repeat(COMMUNITY_DESCRIPTION_MAX);
    const padded = plainToInstance(UpdateCommunityDto, {
      description: `   ${text}   \n\n\n`,
    });
    expect(await validate(padded)).toHaveLength(0);

    const tooLong = plainToInstance(UpdateCommunityDto, {
      description: `${text}b`,
    });
    expect(await validate(tooLong)).not.toHaveLength(0);
  });

  it('still rejects a non-string description', async () => {
    const dto = plainToInstance(UpdateCommunityDto, { description: 42 });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('accepts ten line breaks and refuses an eleventh', async () => {
    const lines = (n: number) =>
      Array.from({ length: n + 1 }, (_, i) => `line ${i}`).join('\n');
    const ten = plainToInstance(UpdateCommunityDto, { description: lines(10) });
    expect(await validate(ten)).toHaveLength(0);
    const eleven = plainToInstance(CreateCommunityDto, {
      name: 'Bots',
      description: lines(11),
    });
    const errors = await validate(eleven);
    expect(JSON.stringify(errors)).toContain('at most 10 line breaks');
  });

  it('counts breaks after normalising, so stacked blank lines count once', async () => {
    const dto = plainToInstance(UpdateCommunityDto, {
      description: 'a\n\n\n\n\n\n\n\n\n\n\n\n\nb',
    });
    expect(dto.description).toBe('a\n\nb');
    expect(await validate(dto)).toHaveLength(0);
  });
});
