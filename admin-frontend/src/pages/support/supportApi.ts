import { apiRequest } from '../../api/apiClient';

/**
 * The Support section's server calls, in one place.
 *
 * Every path sits under `/admin/support`, which is what puts them behind
 * AdminJwtGuard (session + CSRF) and what makes AuditInterceptor classify their
 * mutations as support activity. Help-content management is nested under the
 * same prefix deliberately - see AdminHelpController.
 */

export interface TicketFilters {
  status?: string;
  category?: string;
  priority?: string;
  assignedAdminId?: string;
  search?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

function toQuery(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    // Empty strings are how the selects represent "no filter"; sending them
    // would fail the server's enum validation rather than being ignored.
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

const json = (body: unknown) => JSON.stringify(body);

export const supportApi = {
  listTickets: (filters: TicketFilters) => apiRequest(`/admin/support${toQuery(filters as Record<string, unknown>)}`),
  getStats: () => apiRequest('/admin/support/stats'),
  getAssignees: () => apiRequest('/admin/support/assignees'),
  getTicket: (id: string) => apiRequest(`/admin/support/${id}`),

  setStatus: (id: string, status: string) =>
    apiRequest(`/admin/support/${id}/status`, { method: 'PATCH', body: json({ status }) }),

  setPriority: (id: string, priority: string) =>
    apiRequest(`/admin/support/${id}/priority`, { method: 'PATCH', body: json({ priority }) }),

  assign: (id: string, adminId: string | null) =>
    apiRequest(`/admin/support/${id}/assign`, { method: 'PATCH', body: json({ adminId }) }),

  addNote: (id: string, body: string) =>
    apiRequest(`/admin/support/${id}/notes`, { method: 'POST', body: json({ body }) }),

  reply: (id: string, payload: { body: string; status?: string; internalNote?: string }) =>
    apiRequest(`/admin/support/${id}/reply`, { method: 'POST', body: json(payload) }),

  previewReply: (body: string) =>
    apiRequest('/admin/support/reply-preview', { method: 'POST', body: json({ body }) }),

  resendReply: (ticketId: string, messageId: string) =>
    apiRequest(`/admin/support/${ticketId}/messages/${messageId}/resend`, { method: 'POST' }),

  resendConfirmation: (ticketId: string) =>
    apiRequest(`/admin/support/${ticketId}/resend-confirmation`, { method: 'POST' }),
};

export interface HelpCategoryPayload {
  title?: string;
  slug?: string;
  description?: string;
  icon?: string;
  sortOrder?: number;
  status?: string;
}

export interface HelpArticlePayload {
  categoryId?: string;
  question?: string;
  slug?: string;
  summary?: string;
  body?: string;
  keywords?: string[];
  sortOrder?: number;
  isFeatured?: boolean;
  status?: string;
}

export const helpApi = {
  listCategories: () => apiRequest('/admin/support/help/categories'),
  createCategory: (payload: HelpCategoryPayload) =>
    apiRequest('/admin/support/help/categories', { method: 'POST', body: json(payload) }),
  updateCategory: (id: string, payload: HelpCategoryPayload) =>
    apiRequest(`/admin/support/help/categories/${id}`, { method: 'PATCH', body: json(payload) }),
  setCategoryStatus: (id: string, status: string) =>
    apiRequest(`/admin/support/help/categories/${id}/status`, { method: 'PATCH', body: json({ status }) }),
  archiveCategory: (id: string) => apiRequest(`/admin/support/help/categories/${id}/archive`, { method: 'POST' }),
  deleteCategory: (id: string) => apiRequest(`/admin/support/help/categories/${id}`, { method: 'DELETE' }),
  reorderCategories: (items: Array<{ id: string; sortOrder: number }>) =>
    apiRequest('/admin/support/help/categories/reorder', { method: 'PUT', body: json({ items }) }),

  listArticles: (filters: { search?: string; status?: string; categoryId?: string; featuredOnly?: boolean }) =>
    apiRequest(`/admin/support/help/articles${toQuery(filters as Record<string, unknown>)}`),
  createArticle: (payload: HelpArticlePayload) =>
    apiRequest('/admin/support/help/articles', { method: 'POST', body: json(payload) }),
  updateArticle: (id: string, payload: HelpArticlePayload) =>
    apiRequest(`/admin/support/help/articles/${id}`, { method: 'PATCH', body: json(payload) }),
  setArticleStatus: (id: string, status: string) =>
    apiRequest(`/admin/support/help/articles/${id}/status`, { method: 'PATCH', body: json({ status }) }),
  deleteArticle: (id: string) => apiRequest(`/admin/support/help/articles/${id}`, { method: 'DELETE' }),
  reorderArticles: (items: Array<{ id: string; sortOrder: number }>) =>
    apiRequest('/admin/support/help/articles/reorder', { method: 'PUT', body: json({ items }) }),
  previewArticle: (body: string) =>
    apiRequest('/admin/support/help/articles/preview', { method: 'POST', body: json({ body }) }),
};
