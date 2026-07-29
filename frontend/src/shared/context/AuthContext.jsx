import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { E2EEManager } from '@shared/lib/signal/E2EEManager';
import { usersApi, apiClient, postsApi, getBackendUrl } from '@shared/api/apiClient';
import { useSavedPostsStore } from '../stores/savedPostsStore';
import { useSavedActivitiesStore } from '../stores/savedActivitiesStore';
import usePostStore from '../stores/postStore';
import { showToast } from '@shared/utils/toast';
import { getCollegeName } from '@shared/utils/user';

import { supabase, isSupabaseConfigured } from '@shared/lib/supabase';
export { supabase, isSupabaseConfigured };

const AuthContext = createContext(null);

function isValidUser(u) {
  return (
    u !== null &&
    typeof u === 'object' &&
    typeof u.id === 'string'
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

  const isLoggedIn = !!session;

  const lastSyncAtRef = useRef(0);
  const syncPromiseRef = useRef(null);
  const bookmarksHydratedRef = useRef(false);
  const syncDebounceRef = useRef(null);
  const isLoggingOutRef = useRef(false);

  const performSync = useCallback(async (supabaseSession, event) => {
    if (syncPromiseRef.current) {
      return syncPromiseRef.current;
    }

    syncPromiseRef.current = (async () => {
      try {
        const syncRes = await apiClient.post('/api/auth/sync');
        const syncedUser = syncRes?.user || syncRes;
        lastSyncAtRef.current = Date.now();
        if (isValidUser(syncedUser)) {
          setCurrentUser(prev => {
            const sbEmail = supabaseSession?.user?.email;
            const cleanEmail = (syncedUser.email && !syncedUser.email.endsWith('@meetifyy.user'))
              ? syncedUser.email
              : (sbEmail || prev?.email || '');
            const mergedUser = {
              ...syncedUser,
              email: cleanEmail,
              settings: syncedUser.settings || prev?.settings || prev?.preferences,
              preferences: syncedUser.settings || prev?.preferences || prev?.settings,
              isNewUser: syncedUser.profileCompleted !== true
            };
            localStorage.setItem('currentUser', JSON.stringify(mergedUser));
            return mergedUser;
          });

          // Hydrate bookmarks only ONCE per session — not on token refresh events.
          if (!bookmarksHydratedRef.current && event !== 'TOKEN_REFRESHED') {
            bookmarksHydratedRef.current = true;

            const meta = syncRes?.meta;
            if (meta?.postBookmarkIds) {
              useSavedPostsStore.getState().hydrateFromServer(meta.postBookmarkIds);
            }
            if (meta?.activityBookmarkIds) {
              useSavedActivitiesStore.getState().hydrateFromServer(meta.activityBookmarkIds);
            }

            if (!meta?.postBookmarkIds) {
              setTimeout(async () => {
                try {
                  const response = await postsApi.getBookmarks(50);
                  const bookmarkedPostIds = (response?.posts || response?.data || []).map(p => p.id);
                  useSavedPostsStore.getState().hydrateFromServer(bookmarkedPostIds);
                } catch (bookmarkErr) {
                  console.error('Failed to hydrate bookmarks', bookmarkErr);
                }
              }, 2000);
            }
          }
        }
        return syncRes;
      } catch (err) {
        if (err?.status !== 401) {
          console.error('Failed to sync profile on auth change', err);
        }
      } finally {
        syncPromiseRef.current = null;
      }
    })();

    return syncPromiseRef.current;
  }, []);

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
      if (!isLoggingOutRef.current) {
        setSession(session);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, supabaseSession) => {
        if (event === 'SIGNED_OUT') {
          isLoggingOutRef.current = false;
          setSession(null);
          setCurrentUser(null);
          localStorage.removeItem('currentUser');
          localStorage.removeItem('meetifyy_deviceId');
          localStorage.removeItem('meetifyy_recent_searches');
          localStorage.removeItem('meetify_muted_communities');
          localStorage.removeItem('read_invitations');
          useSavedPostsStore.getState().clearAll?.();
          useSavedActivitiesStore.getState().clearAll?.();
          usePostStore.getState().clearAll?.();
          setLoading(false);
          return;
        }

        if (event === 'PASSWORD_RECOVERY') {
          setSession(supabaseSession);
          setLoading(false);
          return;
        }

        if (isLoggingOutRef.current) {
          setSession(null);
          setCurrentUser(null);
          setLoading(false);
          return;
        }

        setSession(supabaseSession);
        
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
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
            const now = Date.now();
            if (now - lastSyncAtRef.current < 5000) {
              E2EEManager.getInstance().initialize().catch(console.error);
            } else {
              if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
              syncDebounceRef.current = setTimeout(() => {
                performSync(supabaseSession, event);
              }, 200);
              E2EEManager.getInstance().initialize().catch(console.error);
            }
          }
        }
        
        setLoading(false);
      }
    );
    
    return () => subscription.unsubscribe();
  }, [performSync]);


  const login = useCallback(async (usernameOrEmail, password) => {
    isLoggingOutRef.current = false;
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

    try {
      const apiUrl = getBackendUrl();
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

    if (!userData.email || !userData.email.trim()) {
      throw new Error('College email is required to sign up. Please check your details.');
    }
    if (!userData.password) {
      throw new Error('Password is required.');
    }

    const { data, error } = await supabase.auth.signUp({
      email: userData.email.trim().toLowerCase(),
      password: userData.password,
      options: {
        data: {
          displayName: userData.name || userData.displayName || userData.username,
          username: userData.username,
          birthday: userData.birthday,
        }
      }
    });
    
    if (error) {
      const msg = typeof error.message === 'string' && error.message.trim() !== '' && error.message !== '{}'
        ? error.message
        : (error.error_description || error.msg || 'Signup failed. Please try again.');
      throw new Error(msg);
    }

    // Supabase signUp returns a user with identities=[] when the email already
    // exists but is unconfirmed. Detect this and surface a clean error so the
    // user knows to check their inbox rather than seeing a silent failure.
    if (data?.user && (!data.user.identities || data.user.identities.length === 0)) {
      throw new Error(
        'A signup is already pending for this email. Check your inbox for the verification code, or wait a moment and try again.'
      );
    }
    
    // We don't log them in yet — they must verify OTP first.
    return true;
  }, []);

  const resendSignupOtp = useCallback(async (email) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
    });
    
    if (error) {
      const msg = typeof error.message === 'string' && error.message.trim() !== '' && error.message !== '{}'
        ? error.message
        : (error.error_description || error.msg || 'Failed to resend code. Please try again.');
      throw new Error(msg);
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
      const msg = typeof error.message === 'string' && error.message.trim() !== '' && error.message !== '{}'
        ? error.message
        : (error.error_description || error.msg || 'Invalid verification code.');
      throw new Error(msg);
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

      // Clear stale signup session data — the OTP is now used and should not be replayable
      sessionStorage.removeItem('meetifyy_signup_data');

      // Immediately persist gathered profile details to backend database.
      // The backend syncProfile gate will allow this because email_confirmed_at
      // is now set (Supabase marks it on successful OTP verification).
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
    setCurrentUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updatedData };
      delete updated.password;
      localStorage.setItem('currentUser', JSON.stringify(updated));
      return updated;
    });

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
    setCurrentUser(prev => {
      if (!prev) return prev;
      const mergedSettings = {
        ...(prev?.settings || {}),
        ...(prev?.preferences || {}),
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
    if (user === null) {
      setCurrentUser(null);
      localStorage.removeItem('currentUser');
      return;
    }
    if (isValidUser(user)) {
      const safeUser = { ...user };
      delete safeUser.password;
      setCurrentUser(safeUser);
      localStorage.setItem('currentUser', JSON.stringify(safeUser));
    } else {
      console.warn('updateCurrentUser received invalid user object, ignoring update:', user);
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
    isLoggingOutRef.current = true;
    setSession(null);
    setCurrentUser(null);
    localStorage.removeItem('currentUser');
    localStorage.removeItem('meetifyy_deviceId');
    localStorage.removeItem('meetifyy_recent_searches');
    localStorage.removeItem('meetify_muted_communities');
    localStorage.removeItem('read_invitations');
    localStorage.removeItem('meetify_show_community_details');
    sessionStorage.removeItem('meetifyy_signup_data');
    useSavedPostsStore.getState().clearAll?.();
    useSavedActivitiesStore.getState().clearAll?.();
    usePostStore.getState().clearAll?.();

    if (isSupabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.error('Supabase signOut error', e);
      }
    }
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
  const collegeName = getCollegeName(currentUser);

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
        collegeName,
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
  if (!ctx) {
    return {
      isLoggedIn: false,
      session: null,
      loading: false,
      currentUser: null,
      username: '',
      displayName: '',
      initial: '?',
      collegeName: '',
      login: async () => {},
      initiateSignup: async () => {},
      resendSignupOtp: async () => {},
      verifySignupOtp: async () => {},
      completeOnboarding: async () => {},
      updateProfile: async () => {},
      updateSettings: async () => {},
      updateCurrentUser: () => {},
      changePassword: async () => {},
      logout: async () => {},
      isSupabaseConfigured: true,
    };
  }
  return ctx;
}
