import { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(
    () => localStorage.getItem('loggedIn') === 'true'
  );
  const [username, setUsername] = useState(
    () => localStorage.getItem('username') || ''
  );

  const login = useCallback((user) => {
    localStorage.setItem('loggedIn', 'true');
    localStorage.setItem('username', user);
    setUsername(user);
    setIsLoggedIn(true);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('loggedIn');
    localStorage.removeItem('username');
    setUsername('');
    setIsLoggedIn(false);
  }, []);

  const initial = username ? username.charAt(0).toUpperCase() : '?';
  const displayName = username
    ? username.charAt(0).toUpperCase() + username.slice(1)
    : '';

  return (
    <AuthContext.Provider
      value={{ isLoggedIn, username, displayName, initial, login, logout }}
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
