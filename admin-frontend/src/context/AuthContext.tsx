import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest } from '../api/apiClient';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  totpEnabled: boolean;
}

interface AuthContextType {
  admin: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<any>;
  verifyOtp: (pendingToken: string, otp: string) => Promise<any>;
  verifyTotp: (pendingToken: string, totpCode: string) => Promise<any>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const checkAuth = async () => {
    try {
      const res = await apiRequest('/admin/auth/me');
      if (res && res.admin) {
        setAdmin(res.admin);
      } else {
        setAdmin(null);
      }
    } catch (err) {
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await apiRequest('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return res;
  };

  const verifyOtp = async (pendingToken: string, otp: string) => {
    const res = await apiRequest('/admin/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, otp }),
    });

    if (res && res.admin) {
      setAdmin(res.admin);
    }
    return res;
  };

  const verifyTotp = async (pendingToken: string, totpCode: string) => {
    const res = await apiRequest('/admin/auth/verify-totp', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, totpCode }),
    });

    if (res && res.admin) {
      setAdmin(res.admin);
    }
    return res;
  };

  const logout = async () => {
    try {
      await apiRequest('/admin/auth/logout', { method: 'POST' });
    } catch (e) {
      // ignore errors
    } finally {
      setAdmin(null);
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider
      value={{
        admin,
        loading,
        login,
        verifyOtp,
        verifyTotp,
        logout,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
