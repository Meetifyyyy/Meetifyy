const getBackendUrl = (): string => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl;
  }
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return envUrl || 'http://localhost:4000';
};

const BASE_URL = getBackendUrl();

function getCsrfToken(): string | null {
  const match = document.cookie.match(new RegExp('(^| )admin_csrf=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Includes HttpOnly cookies (admin_access, admin_refresh)
  });

  // Handle 401 & attempt token refresh once
  if (response.status === 401 && !endpoint.includes('/admin/auth/refresh') && !endpoint.includes('/admin/auth/login')) {
    try {
      const refreshRes = await fetch(`${BASE_URL}/admin/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (refreshRes.ok) {
        // Retry original request
        const retryHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string>),
        };
        const newCsrf = getCsrfToken();
        if (newCsrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          retryHeaders['X-CSRF-Token'] = newCsrf;
        }

        const retryRes = await fetch(url, {
          ...options,
          headers: retryHeaders,
          credentials: 'include',
        });

        if (!retryRes.ok) {
          const errData = await retryRes.json().catch(() => ({}));
          throw new Error(errData.message || 'Request failed');
        }
        return retryRes.json();
      }
    } catch (refreshErr) {
      // Refresh failed — clear local session
      window.location.href = '/login';
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${response.status} error`);
  }

  return response.json();
}
