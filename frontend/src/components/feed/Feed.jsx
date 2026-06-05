import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import PostComposer from './PostComposer';
import Post from './Post';

const defaultPosts = [
  { name: 'Alice Chen', avatar: 'A', time: '2 hours ago', text: 'Just finished an amazing hackathon! Built a real-time collab tool with 3 new friends I met here. Meetify is the best place to find your tribe 🚀', likes: 24, comments: 8 },
  { name: 'Marcus Rivera', avatar: 'M', time: '5 hours ago', text: 'Looking for a UI/UX designer to join my startup project. We\'re building a mental-wellness app. DM me if interested! ✨', likes: 18, comments: 12 },
  { name: 'Priya Sharma', avatar: 'P', time: 'Yesterday', text: 'Hosting a virtual coffee chat this Saturday at 4PM EST. Topic: "Breaking into AI/ML as a self-taught dev." All welcome — link in bio! ☕', likes: 42, comments: 15 },
];

export default function Feed() {
  const { username, initial } = useAuth();
  const [userPosts, setUserPosts] = useState([]);

  const handleNewPost = (text, pollData) => {
    const newId = `post-${Date.now()}-${Math.random()}`;
    if (pollData) {
      setUserPosts([
        { id: newId, name: username, avatar: initial, time: 'Just now', text, poll: pollData, likes: 0, comments: 0 },
        ...userPosts,
      ]);
    } else if (text) {
      setUserPosts([
        { id: newId, name: username, avatar: initial, time: 'Just now', text, likes: 0, comments: 0 },
        ...userPosts,
      ]);
    }
  };

  return (
    <div className="feed">
      <PostComposer onSubmit={handleNewPost} />
      {userPosts.map((p) => (
        <Post key={p.id} {...p} initialLikes={p.likes} initialComments={p.comments} />
      ))}
      {defaultPosts.map((p, i) => (
        <Post key={`default-${i}`} {...p} initialLikes={p.likes} initialComments={p.comments} />
      ))}
    </div>
  );
}
