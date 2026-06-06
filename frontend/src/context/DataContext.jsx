import { createContext, useContext, useState, useCallback } from 'react';
import { initialUsers, initialPosts } from '../data/mockData';
import { communities } from '../data/communities';
import { useAuth } from './AuthContext';

const DataContext = createContext(null);

const allCommPosts = Object.values(communities).flatMap(comm => 
  comm.posts.map((p, i) => ({
    id: p.id || `c_post_${comm.id}_${i}`,
    authorId: p.authorId || 'u1',
    time: p.time,
    text: p.text,
    likes: p.likes || 0,
    comments: p.comments || 0,
    isLikedByMe: false,
    replies: [],
    communityId: comm.id
  }))
);

export function DataProvider({ children }) {
  const [users, setUsers] = useState(initialUsers);
  const [posts, setPosts] = useState([...initialPosts, ...allCommPosts]);
  const { currentUser } = useAuth();

  const getUserByUsername = useCallback((uName) => {
    return Object.values(users).find(u => u.username === uName) || null;
  }, [users]);

  const getUserById = useCallback((id) => {
    return Object.values(users).find(u => u.id === id) || null;
  }, [users]);

  const getPostById = useCallback((postId) => {
    return posts.find(p => p.id === postId) || null;
  }, [posts]);

  const getUserPosts = useCallback((authorId) => {
    return posts.filter(p => p.authorId === authorId);
  }, [posts]);

  const likePost = useCallback(async (postId) => {
    await new Promise(resolve => setTimeout(resolve, 600));
    setPosts(prev => prev.map(p => {
      if (p.id === postId) {
        // In a real app, we'd track WHO liked it to toggle correctly.
        // Here we just increment for simplicity, but simulating toggle:
        const isLiked = p.isLikedByMe;
        return { 
          ...p, 
          likes: isLiked ? p.likes - 1 : p.likes + 1,
          isLikedByMe: !isLiked
        };
      }
      return p;
    }));
  }, []);

  const addPost = useCallback(async (text, poll) => {
    await new Promise(resolve => setTimeout(resolve, 600));
    const newPost = {
      id: `post_${Date.now()}`,
      authorId: currentUser.id,
      time: 'Just now',
      text,
      poll,
      likes: 0,
      comments: 0,
      replies: []
    };
    
    // If it's a new user not in our mockDB, add them so the post works
    if (!users[currentUser.username]) {
      setUsers(prev => ({ ...prev, [currentUser.username]: currentUser }));
    }

    setPosts(prev => [newPost, ...prev]);
  }, [currentUser, users]);

  const addComment = useCallback(async (postId, text, parentCommentId = null) => {
    await new Promise(resolve => setTimeout(resolve, 600));
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;

      const newReply = {
        id: `r_${Date.now()}`,
        authorId: currentUser.id,
        time: 'Just now',
        text,
        likes: 0,
        replies: []
      };

      if (!parentCommentId) {
        // Top level comment
        return {
          ...p,
          comments: p.comments + 1,
          replies: [newReply, ...(p.replies || [])]
        };
      }

      // Recursive function to find parent and add reply
      const addReplyToNode = (nodes) => {
        return nodes.map(node => {
          if (node.id === parentCommentId) {
            return {
              ...node,
              replies: [...(node.replies || []), newReply]
            };
          } else if (node.replies && node.replies.length > 0) {
            return {
              ...node,
              replies: addReplyToNode(node.replies)
            };
          }
          return node;
        });
      };

      return {
        ...p,
        comments: p.comments + 1,
        replies: addReplyToNode(p.replies || [])
      };
    }));

    // Ensure the user exists in our DB
    if (!users[currentUser.username]) {
      setUsers(prev => ({ ...prev, [currentUser.username]: currentUser }));
    }
  }, [currentUser, users]);

  const likeComment = useCallback(async (postId, commentId) => {
    await new Promise(resolve => setTimeout(resolve, 600));
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;

      const toggleLikeInNode = (nodes) => {
        return nodes.map(node => {
          if (node.id === commentId) {
            const isLiked = node.isLikedByMe;
            return {
              ...node,
              likes: isLiked ? node.likes - 1 : node.likes + 1,
              isLikedByMe: !isLiked
            };
          } else if (node.replies && node.replies.length > 0) {
            return {
              ...node,
              replies: toggleLikeInNode(node.replies)
            };
          }
          return node;
        });
      };

      return {
        ...p,
        replies: toggleLikeInNode(p.replies || [])
      };
    }));
  }, []);

  return (
    <DataContext.Provider value={{
      users,
      posts,
      currentUser,
      getUserByUsername,
      getUserById,
      getPostById,
      getUserPosts,
      likePost,
      addPost,
      addComment,
      likeComment
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
