import { countInterestMatches } from './interest-match.util';

describe('countInterestMatches', () => {
  it('matches interests at the start of a word', () => {
    expect(countInterestMatches('Sunday art walk', ['art'], 2)).toBe(1);
    expect(countInterestMatches('Meet the artists', ['art'], 2)).toBe(1);
    expect(
      countInterestMatches('Football, then music', ['music', 'football'], 2),
    ).toBe(2);
  });

  it('does not match inside a word', () => {
    expect(
      countInterestMatches('Start-up party at the smart lab', ['art'], 2),
    ).toBe(0);
  });

  it('is case-insensitive and ignores short or blank interests', () => {
    expect(countInterestMatches('CODING night', [' Coding '], 2)).toBe(1);
    expect(countInterestMatches('ai and tv', ['ai', 'tv', ''], 2)).toBe(0);
  });

  it('treats regex characters in an interest literally', () => {
    expect(countInterestMatches('c++ study group', ['c++'], 2)).toBe(1);
    expect(countInterestMatches('cxx study group', ['c++'], 2)).toBe(0);
  });

  it('stops at the cap', () => {
    expect(
      countInterestMatches('music art dance', ['music', 'art', 'dance'], 2),
    ).toBe(2);
  });
});
