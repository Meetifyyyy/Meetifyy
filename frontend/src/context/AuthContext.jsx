import { createContext, useContext, useState, useCallback } from 'react';
import { initialUsers } from '../data/mockData';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) return JSON.parse(savedUser);
    
    const oldUsername = localStorage.getItem('username');
    if (oldUsername) {
      const user = Object.values(initialUsers).find(u => u.username === oldUsername) || {
        id: `u_${Date.now()}`,
        username: oldUsername,
        displayName: oldUsername.charAt(0).toUpperCase() + oldUsername.slice(1),
        avatar: oldUsername.charAt(0).toUpperCase(),
        bio: 'Just joined Meetify!',
        location: 'Earth',
        role: 'New User',
        email: `${oldUsername}@meetify.app`,
        followers: 0,
        following: 0,
        communities: []
      };
      localStorage.setItem('currentUser', JSON.stringify(user));
      return user;
    }
    return null;
  });

  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    const hasUser = !!localStorage.getItem('currentUser') || !!localStorage.getItem('username');
    return localStorage.getItem('loggedIn') === 'true' && hasUser;
  });

  const login = useCallback((username) => {
    // Find the user in mockData, or create a fallback guest if not found
    const user = Object.values(initialUsers).find(u => u.username === username) || {
      id: `u_${Date.now()}`,
      username: username || 'guest',
      displayName: username ? username.charAt(0).toUpperCase() + username.slice(1) : 'Guest',
      avatar: username ? username.charAt(0).toUpperCase() : '?',
      bio: 'Just joined Meetify!',
      location: 'Earth',
      role: 'New User',
      email: `${username || 'guest'}@meetify.app`,
      followers: 0,
      following: 0,
      communities: []
    };

    localStorage.setItem('loggedIn', 'true');
    localStorage.setItem('currentUser', JSON.stringify(user));
    setCurrentUser(user);
    setIsLoggedIn(true);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('loggedIn');
    localStorage.removeItem('currentUser');
    setCurrentUser(null);
    setIsLoggedIn(false);
  }, []);

  const username = currentUser?.username || '';
  const initial = username ? username.charAt(0).toUpperCase() : '?';
  const displayName = currentUser?.displayName || '';

  return (
    <AuthContext.Provider
      value={{ isLoggedIn, currentUser, username, displayName, initial, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
