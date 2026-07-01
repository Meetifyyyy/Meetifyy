import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import Feed from '../components/feed/Feed';
import RightPanel, { FindFriends, OnlineFriends, UpcomingEvents } from '../components/layout/RightPanel';

export default function FeedRoute() {
  const navigate = useNavigate();
  const { communities } = useData();

  const handlePostClick = (post, sourceContext, communityId) => {
    const postId = post.id;
    if (postId) {
      navigate(`/post/${postId}`, { state: { post, sourceContext, communityId } });
    }
  };

  // Trending Communities card (inline — no behaviour change)
  const trendingActions = Object.values(communities)
    .slice(0, 4)
    .map(c => ({
      label: c.name,
      icon: (
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: c.avatar?.startsWith('http') ? 'transparent' : 'linear-gradient(135deg,#094887,#3B82F6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.6rem', fontWeight: 700, color: '#fff', flexShrink: 0,
          overflow: 'hidden',
        }}>
          {c.avatar?.startsWith('http')
            ? <img src={c.avatar} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
            : c.name?.[0]?.toUpperCase()}
        </div>
      ),
      onClick: () => navigate(`/communities/${c.id}`),
    }));

  const quickActions = trendingActions.length > 0 ? trendingActions : [
    {
      label: 'Find Crew',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>,
      onClick: () => navigate('/crew'),
    },
    {
      label: 'Find People',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
      onClick: () => navigate('/search'),
    },
    {
      label: 'Send Message',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
      onClick: () => navigate('/messages'),
    },
  ];

  return (
    <>
      <main className="centre animate-in">
        <Feed onPostClick={handlePostClick} />
      </main>

      <RightPanel className="animate-in">

        {/* ── Find Friends — live people search ── */}
        <FindFriends />

        {/* ── Trending Communities ── */}
        <div style={{
          background: 'var(--color-bg-white)',
          border: '1px solid var(--color-border-light)',
          borderRadius: 18, padding: '1.1rem 1.15rem',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <h3 style={{
            fontFamily: 'var(--font-family-display)', fontWeight: 700,
            fontSize: '0.88rem', color: 'var(--color-text-main)',
            marginBottom: '0.85rem', letterSpacing: '-0.01em',
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>
            Trending Communities
          </h3>

          {quickActions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '0.65rem',
                padding: '0.5rem 0.6rem', marginBottom: '0.1rem',
                fontFamily: 'var(--font-family-sans)', fontSize: '0.82rem', fontWeight: 600,
                color: 'var(--color-text-main)', background: 'none', border: 'none',
                borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-border-light)'; e.currentTarget.style.transform = 'translateX(2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.transform = 'none'; }}
            >
              {a.icon}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
            </button>
          ))}

          <button
            onClick={() => navigate('/communities')}
            style={{
              width: '100%', marginTop: '0.55rem', padding: '0.42rem',
              fontFamily: 'var(--font-family-sans)', fontSize: '0.78rem', fontWeight: 600,
              color: 'var(--color-primary)',
              background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.12)',
              borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(37,99,235,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(37,99,235,0.05)'}
          >
            Browse all communities →
          </button>
        </div>

        <UpcomingEvents />

      </RightPanel>
    </>
  );
}
