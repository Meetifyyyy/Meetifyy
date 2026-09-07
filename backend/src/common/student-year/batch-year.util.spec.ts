import {
  extractBatchYearFromEmail,
  extractProgrammeFromEmail,
  isPlausibleBatchYear,
} from './batch-year.util';

describe('extractBatchYearFromEmail', () => {
  describe('the real GLA address patterns', () => {
    // Exactly the shapes the university issues, not a simplified stand-in.
    it.each([
      ['sarthak.saini_cs25@gla.ac.in', 2025],
      ['shrangika.agnihotri_cs.h25@gla.ac.in', 2025],
      ['aman.usmani_cs.aiml25@gla.ac.in', 2025],
      ['aaradhya.rawat_cs.h24@gla.ac.in', 2024],
      ['dixita.mishra_cs24@gla.ac.in', 2024],
    ])('%s -> %i', (email, expected) => {
      expect(extractBatchYearFromEmail(email)).toBe(expected);
    });

    it.each([
      ['cs24', 'a.b_cs24@gla.ac.in', 2024],
      ['cs25', 'a.b_cs25@gla.ac.in', 2025],
      ['cs26', 'a.b_cs26@gla.ac.in', 2026],
      ['cs27', 'a.b_cs27@gla.ac.in', 2027],
      ['cs.aiml25', 'a.b_cs.aiml25@gla.ac.in', 2025],
      ['cs.h25', 'a.b_cs.h25@gla.ac.in', 2025],
      ['cs.h24', 'a.b_cs.h24@gla.ac.in', 2024],
    ])('programme token %s resolves to %s -> %i', (_token, email, expected) => {
      expect(extractBatchYearFromEmail(email)).toBe(expected);
    });

    it('handles other programme codes, not just computer science', () => {
      expect(extractBatchYearFromEmail('r.k_me26@gla.ac.in')).toBe(2026);
      expect(extractBatchYearFromEmail('r.k_bba.h26@gla.ac.in')).toBe(2026);
      expect(extractBatchYearFromEmail('r.k_ec.vlsi23@gla.ac.in')).toBe(2023);
    });
  });

  describe('normalisation', () => {
    it('is case-insensitive', () => {
      expect(extractBatchYearFromEmail('Sarthak.Saini_CS25@GLA.AC.IN')).toBe(
        2025,
      );
    });

    it('ignores surrounding whitespace and zero-width characters', () => {
      expect(extractBatchYearFromEmail('  a.b_cs26@gla.ac.in  ')).toBe(2026);
      expect(extractBatchYearFromEmail('a.b_cs​26@gla.ac.in')).toBe(2026);
    });

    it('splits on the last @, so a local part containing one cannot shift it', () => {
      expect(extractBatchYearFromEmail('"weird@name"_cs26@gla.ac.in')).toBe(
        2026,
      );
    });
  });

  describe('fails closed', () => {
    it.each([
      ['empty string', ''],
      ['not a string', 12345],
      ['null', null],
      ['undefined', undefined],
      ['no @', 'sarthak.saini_cs25'],
      ['no local part', '@gla.ac.in'],
      ['no domain', 'a.b_cs25@'],
      ['no programme anchor', 'arjun.kumar26@gmail.com'],
      ['digits with no underscore', 'sarthaksaini26@gla.ac.in'],
      ['underscore but no trailing digits', 'a.b_cs@gla.ac.in'],
      ['digits before the programme', 'a.b_26cs@gla.ac.in'],
      ['programme with digits inside', 'a.b_cs2x6@gla.ac.in'],
      ['fallback platform address', 'e3b0c442-98fc-1c14@meetifyy.user'],
    ])('%s -> null', (_label, email) => {
      expect(extractBatchYearFromEmail(email as unknown)).toBeNull();
    });

    it('refuses plus-addressed variants rather than parsing them', () => {
      // Same mailbox as a.b_cs25@gla.ac.in at most providers. Honouring the
      // tag would let one verified address present two different batches.
      expect(extractBatchYearFromEmail('a.b_cs25+cs26@gla.ac.in')).toBeNull();
      expect(
        extractBatchYearFromEmail('a.b_cs25+anything@gla.ac.in'),
      ).toBeNull();
    });

    it('does not read a year out of a name that happens to end in digits', () => {
      expect(extractBatchYearFromEmail('rahul99@gmail.com')).toBeNull();
    });
  });

  describe('four-digit years', () => {
    it('reads an unambiguous four-digit tail as-is', () => {
      expect(extractBatchYearFromEmail('a.b_cs2025@gla.ac.in')).toBe(2025);
      expect(extractBatchYearFromEmail('a.b_cs.aiml2026@gla.ac.in')).toBe(2026);
    });

    it('does not read the last two digits of a four-digit tail', () => {
      // `_cs2026` is 2026, never 2000 + 26 read off `26` with `20` dropped —
      // which happens to land on the same number, so check a tail where the
      // two readings differ.
      expect(extractBatchYearFromEmail('a.b_cs1998@gla.ac.in')).toBe(1998);
      expect(extractBatchYearFromEmail('a.b_cs1998@gla.ac.in')).not.toBe(2098);
    });
  });
});

describe('extractProgrammeFromEmail', () => {
  it('returns the token that anchored the year', () => {
    expect(extractProgrammeFromEmail('sarthak.saini_cs25@gla.ac.in')).toBe(
      'cs',
    );
    expect(extractProgrammeFromEmail('a.b_cs.h25@gla.ac.in')).toBe('cs.h');
    expect(extractProgrammeFromEmail('a.b_cs.aiml25@gla.ac.in')).toBe(
      'cs.aiml',
    );
  });

  it('returns null when nothing anchored', () => {
    expect(extractProgrammeFromEmail('rahul99@gmail.com')).toBeNull();
  });
});

describe('isPlausibleBatchYear', () => {
  it('accepts the current intake and the one being issued ahead of it', () => {
    expect(isPlausibleBatchYear(2026, 2026)).toBe(true);
    expect(isPlausibleBatchYear(2027, 2026)).toBe(true);
  });

  it('accepts every batch still plausibly enrolled', () => {
    expect(isPlausibleBatchYear(2020, 2026)).toBe(true);
    expect(isPlausibleBatchYear(2006, 2026)).toBe(true);
  });

  it('rejects years too far in the past or future to be a real intake', () => {
    expect(isPlausibleBatchYear(2005, 2026)).toBe(false);
    expect(isPlausibleBatchYear(2028, 2026)).toBe(false);
    expect(isPlausibleBatchYear(2099, 2026)).toBe(false);
  });

  it('rejects non-integers and absent values', () => {
    expect(isPlausibleBatchYear(null, 2026)).toBe(false);
    expect(isPlausibleBatchYear(undefined, 2026)).toBe(false);
    expect(isPlausibleBatchYear(2026.5, 2026)).toBe(false);
  });
});
