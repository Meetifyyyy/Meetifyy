import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { E2EEManager } from '@shared/lib/signal/E2EEManager';
import { usersApi, apiClient, postsApi, getBackendUrl } from '@shared/api/apiClient';
import { useSavedPostsStore } from '../stores/savedPostsStore';
import { useSavedActivitiesStore } from '../stores/savedActivitiesStore';
import usePostStore from '../stores/postStore';
import { showToast } from '@shared/utils/toast';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const apiUrl = getBackendUrl();

const isSupabaseConfigured = supabaseUrl && !supabaseUrl.includes('placeholder') && supabaseUrl.trim().length > 0;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const AuthContext = createContext(null);

function isValidUser(u) {
  return (
    u !== null &&
    typeof u === 'object' &&
    typeof u.id === 'string' &&
    typeof u.email === 'string' &&
    typeof u.username === 'string' &&
    (!u.role || ['Student', 'New User', 'Admin'].includes(u.role))
  );
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (isValidUser(parsed)) {
            setTimeout(() => E2EEManager.getInstance().initialize().catch(console.error), 1000);
            return parsed;
        }
      } catch (e) {}
    }
    return null;
  });
  
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // Debounce guard: SIGNED_IN, TOKEN_REFRESHED, and INITIAL_SESSION can all fire
  // within milliseconds of each other on page load. Only allow one sync per 5 seconds.
  const lastSyncAtRef = useRef(0);
  const syncDebounceRef = useRef(null);

  // Derive isLoggedIn from the session object instead of tracking separately in localStorage
  const isLoggedIn = !!session;

  useEffect(() => {
    if (!isSupabaseConfigured) {
       setLoading(false);
       return;
     }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        setCurrentUser(null);
        localStorage.removeItem('currentUser');
      }
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, supabaseSession) => {
        setSession(supabaseSession);
        
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
          // Optimistically set currentUser based on metadata to avoid blank profile / wrong role during sync delay
          const sbUser = supabaseSession?.user;
          if (sbUser) {
            const isNew = sbUser.user_metadata?.profileCompleted !== true;
            const optProfile = {
              id: sbUser.id,
              email: sbUser.email || '',
              username: sbUser.user_metadata?.username || '',
              displayName: sbUser.user_metadata?.displayName || sbUser.email?.split('@')[0] || '',
              role: isNew ? 'New User' : 'Student',
              isNewUser: isNew,
            };
            setCurrentUser(prev => {
              if (prev && prev.id === sbUser.id && prev.username) {
                return { ...prev, isNewUser: prev.isNewUser ?? isNew };
              }
              return optProfile;
            });
          }

          if (supabaseSession?.user) {
            // Debounce: skip if a sync completed within the last 5 seconds
            const now = Date.now();
            if (now - lastSyncAtRef.current < 5000) {
              E2EEManager.getInstance().initialize().catch(console.error);
            } else {
              if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
              syncDebounceRef.current = setTimeout(async () => {
                try {
                  const { user: syncedUser } = await apiClient.post('/api/auth/sync');
                  lastSyncAtRef.current = Date.now();
                  if (isValidUser(syncedUser)) {
                    setCurrentUser(prev => {
                      const mergedUser = {
                        ...syncedUser,
                        settings: syncedUser.settings || prev?.settings || prev?.preferences,
                        preferences: syncedUser.settings || prev?.preferences || prev?.settings,
                        isNewUser: syncedUser.profileCompleted !== true
                      };
                      localStorage.setItem('currentUser', JSON.stringify(mergedUser));
                      return mergedUser;
                    });

                    // Hydrate saved posts (bookmarks) from backend
                    try {
                      const response = await postsApi.getBookmarks(50);
                      const bookmarkedPostIds = (response?.posts || response?.data || []).map(p => p.id);
                      useSavedPostsStore.getState().hydrateFromServer(bookmarkedPostIds);
                    } catch (bookmarkErr) {
                      console.error('Failed to hydrate bookmarks on auth change', bookmarkErr);
                    }
                  }
                } catch (err) {
                  console.error('Failed to sync profile on auth change', err);
                }
              }, 200);
              E2EEManager.getInstance().initialize().catch(console.error);
            }
          }
        }
        
        if (event === 'SIGNED_OUT') {
          setCurrentUser(null);
          localStorage.removeItem('currentUser');
          localStorage.removeItem('meetifyy_deviceId');
          localStorage.removeItem('meetifyy_recent_searches');
          localStorage.removeItem('meetify_muted_communities');
          localStorage.removeItem('read_invitations');
          // Clear saved posts and other stores on logout to isolate sessions
          useSavedPostsStore.getState().clearAll?.();
          useSavedActivitiesStore.getState().clearAll?.();
          usePostStore.getState().clearAll?.();
        }
        setLoading(false);
      }
    );
    
    return () => subscription.unsubscribe();
  }, []);


  const login = useCallback(async (usernameOrEmail, password) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');

    const BASE_URL = getBackendUrl();
    let email = usernameOrEmail.trim().toLowerCase();

    // If it looks like a username (no @), resolve it to an email first
    if (!email.includes('@')) {
      const res = await fetch(`${BASE_URL}/api/auth/lookup-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.message || 'No account found with that username.');
      }
      const { email: resolvedEmail } = await res.json();
      email = resolvedEmail;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      throw new Error(error.message);
    }
    
    const user = data.user;
    const accessToken = data.session?.access_token;

    // Trigger new login email — use the token directly from the fresh session
    // to avoid the race where apiClient.getSession() returns nothing yet.
    try {
      await fetch(`${apiUrl}/api/auth/events/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          email: user.email,
          name: user.user_metadata?.displayName || user.email.split('@')[0],
        }),
      });
    } catch (e) {
      console.error('Failed to trigger login email', e);
    }

    return true;
  }, []);

  const initiateSignup = useCallback(async (userData) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.auth.signUp({
      email: userData.email,
      password: userData.password,
      options: {
        data: {
          displayName: userData.firstName ? `${userData.firstName} ${userData.lastName || ''}`.trim() : userData.username,
          username: userData.username,
        }
      }
    });
    
    if (error) {
      throw new Error(error.message);
    }
    
    // We don't log them in yet, they must verify OTP first.
    return true;
  }, []);

  const resendSignupOtp = useCallback(async (email) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
    });
    
    if (error) {
      throw new Error(error.message);
    }
    return true;
  }, []);

  const verifySignupOtp = useCallback(async (email, token, signupData = {}) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'signup'
    });

    if (error) {
      throw new Error(error.message);
    }

    if (data.session) {
      const user = data.user;
      const username = typeof signupData === 'string' ? signupData : (signupData.username || user.user_metadata?.username);
      const payloadObj = typeof signupData === 'object' && signupData !== null ? signupData : { username };
      const displayName = payloadObj.firstName
        ? `${payloadObj.firstName} ${payloadObj.lastName || ''}`.trim()
        : (user.user_metadata?.displayName || username);

      let profile = {
        id: user.id,
        email: user.email,
        username: username,
        displayName: displayName,
        role: 'New User',
        isNewUser: true,
      };
      
      localStorage.setItem('currentUser', JSON.stringify(profile));
      setCurrentUser(profile);

      // Immediately persist gathered profile details to backend database
      try {
        const { password, ...safeData } = payloadObj;
        const response = await usersApi.updateProfile({
          ...safeData,
          displayName,
          username,
        });
        const syncedUser = response?.user || response;
        if (syncedUser) {
          profile = { ...profile, ...syncedUser };
          localStorage.setItem('currentUser', JSON.stringify(profile));
          setCurrentUser(profile);
        }
      } catch (err) {
        console.error('Failed to sync profile immediately on OTP verification', err);
      }
    }
    
    return true;
  }, []);

  const completeOnboarding = useCallback(async (updatedData) => {
    try {
      const { password, ...safeData } = updatedData;
      const response = await usersApi.updateProfile({ ...safeData, profileCompleted: true });
      const syncedUser = response?.user || response;

      if (isSupabaseConfigured) {
        await supabase.auth.updateUser({
          data: { profileCompleted: true }
        }).catch(err => console.error('Failed to update Supabase profileCompleted metadata', err));
      }

      if (syncedUser) {
        setCurrentUser(prev => {
          const updated = { ...prev, ...syncedUser, profileCompleted: true, isNewUser: false };
          delete updated.password;
          localStorage.setItem('currentUser', JSON.stringify(updated));
          
          // Trigger welcome email
          apiClient.post('/api/auth/events/welcome', { email: updated.email, name: updated.displayName })
            .catch(console.error);
          
          return updated;
        });
      }
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }, []);

  const updateProfile = useCallback(async (updatedData) => {
    try {
      const response = await usersApi.updateProfile(updatedData);
      const syncedUser = response?.user || response;
      if (syncedUser) {
        setCurrentUser(prev => {
          const updated = { ...prev, ...syncedUser };
          delete updated.password;
          localStorage.setItem('currentUser', JSON.stringify(updated));
          return updated;
        });
      }
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }, []);

  const updateSettings = useCallback(async (settingsData) => {
    try {
      const res = await usersApi.updateSettings(settingsData);
      const { id, userId, createdAt, updatedAt, ...cleanRes } = (res && typeof res === 'object') ? res : {};
      setCurrentUser(prev => {
        const mergedSettings = {
          ...(prev?.settings || {}),
          ...(prev?.preferences || {}),
          ...cleanRes,
          ...settingsData
        };
        const updated = {
          ...prev,
          settings: mergedSettings,
          preferences: mergedSettings
        };
        localStorage.setItem('currentUser', JSON.stringify(updated));
        return updated;
      });
      return true;
    } catch (e) {
      console.error('Failed to update settings in AuthContext:', e);
      return false;
    }
  }, []);

  const updateCurrentUser = useCallback((user) => {
    if (isValidUser(user)) {
      const safeUser = { ...user };
      delete safeUser.password;
      setCurrentUser(safeUser);
      localStorage.setItem('currentUser', JSON.stringify(safeUser));
    } else {
      setCurrentUser(null);
      localStorage.removeItem('currentUser');
    }
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    if (!currentUser?.email) throw new Error('User email not found');

    // 1. Verify current password via reauthenticate to avoid triggering onAuthStateChange SIGNED_IN event
    const { error: reauthError } = await supabase.auth.reauthenticate({
      token: currentPassword,
    });

    if (reauthError) {
      throw new Error('Incorrect current password');
    }

    // 2. Update to new password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (updateError) {
      throw new Error(updateError.message);
    }

    return true;
  }, [currentUser, isSupabaseConfigured]);

  const logout = useCallback(async () => {
    if (isSupabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.error('Supabase signOut error', e);
      }
    }
    // Storage cleanup is handled by onAuthStateChange('SIGNED_OUT')
    localStorage.removeItem('meetify_show_community_details');
    // Ensure signup data doesn't persist across logouts
    sessionStorage.removeItem('meetifyy_signup_data');
  }, []);

  // Listen to global auth:unauthorized events dispatched from the apiClient
  useEffect(() => {
    const handleUnauthorized = () => {
      logout();
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [logout]);

  const username = currentUser?.username || '';
  const initial = username ? username.charAt(0).toUpperCase() : '?';
  const displayName = currentUser?.displayName || '';

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn,
        session,
        loading,
        currentUser,
        username,
        displayName,
        initial,
        login,
        initiateSignup,
        resendSignupOtp,
        verifySignupOtp,
        completeOnboarding,
        updateProfile,
        updateSettings,
        updateCurrentUser,
        changePassword,
        logout,
        isSupabaseConfigured
      }}
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
