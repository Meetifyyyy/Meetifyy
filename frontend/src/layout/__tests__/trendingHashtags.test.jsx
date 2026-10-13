/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

let hookValue;
vi.mock('@shared/hooks/useTrendingHashtags', () => ({ useTrendingHashtags: () => hookValue }));

const { default: TrendingHashtags } = await import('../TrendingHashtags');

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

const renderPanel = () =>
  render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route path="/home" element={<TrendingHashtags />} />
        <Route path="/search" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

describe('TrendingHashtags', () => {
  beforeEach(() => {
    hookValue = { scope: 'campus', tags: [], isLoading: false };
  });

  it('renders nothing when nothing is trending', () => {
    const { container } = renderPanel();
    expect(container.textContent).toBe('');
  });

  it('lists up to five tags, ranked, with how many people post them', () => {
    hookValue.tags = Array.from({ length: 7 }, (_, i) => ({ name: `tag${i}`, posts: 4, authors: i === 0 ? 1 : 3 }));
    const { container, getByText } = renderPanel();
    expect(getByText('Trending on campus')).toBeTruthy();
    expect(container.querySelectorAll('button')).toHaveLength(5);
    expect(getByText('#tag0')).toBeTruthy();
    expect(getByText('1 person posting')).toBeTruthy();
  });

  it('says so when the list is from every college, not this campus', () => {
    hookValue = { scope: 'everywhere', tags: [{ name: 'freshers', posts: 3, authors: 3 }], isLoading: false };
    const { getByText } = renderPanel();
    expect(getByText('Trending on Meetifyy')).toBeTruthy();
  });

  it('opens the posts for a tag when tapped', () => {
    hookValue.tags = [{ name: 'hackathon', posts: 3, authors: 3 }];
    const { getByText, getByTestId } = renderPanel();
    fireEvent.click(getByText('#hackathon'));
    expect(getByTestId('where').textContent).toBe('/search?q=%23hackathon&type=posts');
  });
});
