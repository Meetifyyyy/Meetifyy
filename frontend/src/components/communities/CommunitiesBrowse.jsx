import { useState } from 'react';
import { communities, categoriesList } from '../../data/communities';
import CommunityCard from './CommunityCard';
import CommunityGrid from './CommunityGrid';

export default function CommunitiesBrowse({ onOpenCommunity }) {
  const [activeCategory, setActiveCategory] = useState(null);

  const filtered = Object.values(communities).filter((c) => {
    if (!activeCategory) return true;
    return c.categories?.includes(activeCategory);
  });

  return (
    <div className="feed">
      <div className="comm-browse-hero">
        <nav className="comm-cat-nav">
          <a
            className={`comm-cat-tab${activeCategory === null ? ' comm-cat-tab-active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            Home
          </a>
          {categoriesList.map((cat) => (
            <a
              key={cat.id}
              className={`comm-cat-tab${activeCategory === cat.id ? ' comm-cat-tab-active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.label}
            </a>
          ))}
        </nav>
        <h1 className="comm-browse-hero-title">FIND YOUR<br />COMMUNITY</h1>
        <p className="comm-browse-hero-sub">From design, to tech, to startups — there's a place for you.</p>
      </div>

      <div className="comm-section-heading">Featured Communities</div>

      <CommunityGrid>
        {filtered.map((c) => (
          <CommunityCard key={c.id} comm={c} onClick={() => onOpenCommunity(c.id)} />
        ))}
      </CommunityGrid>

      {filtered.length === 0 && (
        <div className="comm-empty">No communities found in this category.</div>
      )}
    </div>
  );
}
