import { createContext, useContext, useState, useCallback } from 'react';
import { initialUsers } from '../data/mockData';

const AuthContext = createContext(null);

const getUsersDB = () => {
  try {
    const db = localStorage.getItem('meetify_users_db');
    return db ? JSON.parse(db) : {};
  } catch (e) {
    return {};
  }
};

const saveUserToDB = (user) => {
  if (!user || !user.username) return;
  try {
    const db = getUsersDB();
    db[user.username] = user;
    localStorage.setItem('meetify_users_db', JSON.stringify(db));
  } catch (e) {
    console.error('Could not save user to DB', e);
  }
};

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) return JSON.parse(savedUser);
    
    const oldUsername = localStorage.getItem('username');
    if (oldUsername) {
      const db = getUsersDB();
      const user = db[oldUsername] || Object.values(initialUsers).find(u => u.username === oldUsername) || {
        id: `u_${Date.now()}`,
        username: oldUsername,
        displayName: oldUsername.charAt(0).toUpperCase() + oldUsername.slice(1),
        avatar: oldUsername.charAt(0).toUpperCase(),
        bio: 'Just joined Meetifyy!',
        location: 'Earth',
        role: 'New User',
        email: `${oldUsername}@meetifyy.app`,
        followers: 0,
        following: 0,
        communities: []
      };
      localStorage.setItem('currentUser', JSON.stringify(user));
      saveUserToDB(user);
      return user;
    }
    return null;
  });

  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    const hasUser = !!localStorage.getItem('currentUser') || !!localStorage.getItem('username');
    return localStorage.getItem('loggedIn') === 'true' && hasUser;
  });

  const login = useCallback((username, password) => {
    const db = getUsersDB();
    // Check our persistent DB first
    let user = Object.values(db).find(u => u.username === username || u.email === username);
    
    // Fallback to initial mock data
    if (!user) {
      user = Object.values(initialUsers).find(u => u.username === username || u.email === username);
    }

    if (!user) {
      return false; // User not found
    }

    // Check password (default mock password if not set is password)
    const userPassword = user.password || 'password';
    if (userPassword !== password) {
      return false; // Incorrect password
    }

    localStorage.setItem('loggedIn', 'true');
    localStorage.setItem('currentUser', JSON.stringify(user));
    saveUserToDB(user);
    setCurrentUser(user);
    setIsLoggedIn(true);
    return true;
  }, []);

  const signup = useCallback((userData) => {
    const newUser = {
      id: `u_${Date.now()}`,
      ...userData,
      displayName: userData.firstName ? `${userData.firstName} ${userData.lastName || ''}`.trim() : userData.username,
      avatar: userData.firstName ? userData.firstName.charAt(0).toUpperCase() : (userData.username || '?').charAt(0).toUpperCase(),
      bio: 'Just joined Meetifyy!',
      role: 'New User',
      followers: 0,
      following: 0,
      communities: [],
      isNewUser: true
    };
    
    localStorage.setItem('loggedIn', 'true');
    localStorage.setItem('currentUser', JSON.stringify(newUser));
    saveUserToDB(newUser);
    setCurrentUser(newUser);
    setIsLoggedIn(true);
  }, []);

  const completeOnboarding = useCallback((updatedData) => {
    setCurrentUser(prev => {
      const updated = { ...prev, ...updatedData, isNewUser: false };
      localStorage.setItem('currentUser', JSON.stringify(updated));
      saveUserToDB(updated);
      return updated;
    });
  }, []);

  const updateProfile = useCallback((updatedData) => {
    setCurrentUser(prev => {
      const updated = { ...prev, ...updatedData };
      localStorage.setItem('currentUser', JSON.stringify(updated));
      saveUserToDB(updated);
      return updated;
    });
  }, []);

  const updateCurrentUser = useCallback((user) => {
    setCurrentUser(user);
    if (user) {
      localStorage.setItem('currentUser', JSON.stringify(user));
      saveUserToDB(user);
    } else {
      localStorage.removeItem('currentUser');
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('loggedIn');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('meetify_show_community_details');
    setCurrentUser(null);
    setIsLoggedIn(false);
  }, []);

  const username = currentUser?.username || '';
  const initial = username ? username.charAt(0).toUpperCase() : '?';
  const displayName = currentUser?.displayName || '';

  return (
    <AuthContext.Provider
      value={{ isLoggedIn, currentUser, username, displayName, initial, login, signup, completeOnboarding, updateProfile, updateCurrentUser, logout }}
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
