import { useAuth } from '../../context/AuthContext';

export default function ProfileActivity() {
  const { username, initial } = useAuth();

  const posts = [
    { time: '2 days ago', text: 'Just pushed a new open-source project — a real-time whiteboard collab tool! Built with WebSockets and Canvas API. Check it out on my GitHub 🚀', likes: 12, comments: 4 },
    { time: '1 week ago', text: 'Had an amazing session at the NYC Hackathon this weekend! Met 10+ devs from Meetify and we ended up building a working prototype together. This community is unreal 🔥', likes: 34, comments: 11 },
  ];

  return (
    <div className="profile-section">
      <h2 className="section-title">Recent Activity</h2>
      {posts.map((p, i) => (
        <div key={i} className="profile-post">
          <div className="profile-post-header">
            <div className="profile-post-avatar">{initial}</div>
            <div className="profile-post-user">
              <div className="profile-post-name">{username}</div>
              <div className="profile-post-time">{p.time}</div>
            </div>
          </div>
          <div className="profile-post-body">{p.text}</div>
          <div className="profile-post-actions">
            <span><strong>{p.likes}</strong> likes</span>
            <span><strong>{p.comments}</strong> comments</span>
          </div>
        </div>
      ))}
    </div>
  );
}
