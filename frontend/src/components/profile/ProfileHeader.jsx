import { useAuth } from '../../context/AuthContext';

export default function ProfileHeader() {
  const { displayName, username, initial } = useAuth();

  return (
    <div className="profile">
      <div className="profile-cover">
        <div className="profile-avatar-large">{initial}</div>
      </div>

      <div className="profile-info">
        <h1 className="profile-name">{displayName}</h1>
        <p className="profile-username">@{username}</p>
        <p className="profile-tagline">Building cool stuff & meeting awesome people</p>
        <p className="profile-location">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          New York, USA
        </p>
        <div className="profile-stats">
          <div className="stat"><div className="stat-value">156</div><div className="stat-label">Friends</div></div>
          <div className="stat"><div className="stat-value">43</div><div className="stat-label">Posts</div></div>
          <div className="stat"><div className="stat-value">12</div><div className="stat-label">Communities</div></div>
          <div className="stat"><div className="stat-value">2.1k</div><div className="stat-label">Moments</div></div>
        </div>
      </div>
    </div>
  );
}
