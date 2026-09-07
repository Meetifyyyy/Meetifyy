import { apiRequest } from '../../api/apiClient';

/**
 * The Legal section's server calls, in one place.
 *
 * Every path sits under `/admin/legal`, which is what puts them behind
 * AdminJwtGuard (session + CSRF) and what makes AuditInterceptor classify their
 * mutations as LEGAL_DOCUMENT activity.
 *
 * Note what is missing: there is no call that edits a published version. The
 * server has no such route either — a published version is immutable, and the
 * only transitions are publish and rollback.
 */

export type LegalDocumentType =
  | 'TERMS_OF_SERVICE'
  | 'PRIVACY_POLICY'
  | 'COOKIE_POLICY'
  | 'COMMUNITY_GUIDELINES';

export type LegalDocumentStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface LegalAdminRef {
  id: string;
  name: string;
  email: string;
}

export interface LegalVersion {
  id: string;
  documentType: LegalDocumentType;
  versionNumber: number;
  title: string;
  subtitle: string | null;
  status: LegalDocumentStatus;
  isCurrent: boolean;
  requiresAcknowledgement: boolean;
  changeSummary: string | null;
  effectiveAt: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  restoredFromVersionId: string | null;
  createdBy: LegalAdminRef | null;
  publishedBy: LegalAdminRef | null;
  content?: string;
  _count?: { acknowledgements: number };
}

export interface LegalDocumentSummary {
  documentType: LegalDocumentType;
  label: string;
  published: LegalVersion | null;
  draft: LegalVersion | null;
  publishedVersionCount: number;
}

export interface LegalDocumentDetail {
  documentType: LegalDocumentType;
  label: string;
  published: LegalVersion | null;
  draft: LegalVersion | null;
  history: LegalVersion[];
}

export interface PublishPayload {
  changeSummary: string;
  effectiveAt?: string;
  requiresAcknowledgement?: boolean;
}

const json = (body: unknown) => JSON.stringify(body);

export const legalApi = {
  listDocuments: (): Promise<LegalDocumentSummary[]> =>
    apiRequest('/admin/legal/documents'),

  getDocument: (type: LegalDocumentType): Promise<LegalDocumentDetail> =>
    apiRequest(`/admin/legal/documents/${type}`),

  getVersion: (id: string): Promise<LegalVersion> =>
    apiRequest(`/admin/legal/versions/${id}`),

  getAcknowledgementStats: (id: string) =>
    apiRequest(`/admin/legal/versions/${id}/acknowledgements`),

  compare: (
    type: LegalDocumentType,
  ): Promise<{ draft: LegalVersion; published: LegalVersion | null }> =>
    apiRequest(`/admin/legal/documents/${type}/compare`),

  /** Runs content through the save path's sanitizer without storing it. */
  preview: (content: string): Promise<{
    html: string;
    plainText: string;
    wasModified: boolean;
  }> =>
    apiRequest('/admin/legal/preview', {
      method: 'POST',
      body: json({ content }),
    }),

  /** Opens a draft seeded from the published text, or returns the existing one. */
  startDraft: (type: LegalDocumentType): Promise<LegalVersion> =>
    apiRequest(`/admin/legal/documents/${type}/draft`, { method: 'POST' }),

  saveDraft: (
    type: LegalDocumentType,
    body: { title: string; subtitle?: string; content: string },
  ): Promise<LegalVersion> =>
    apiRequest(`/admin/legal/documents/${type}/draft`, {
      method: 'PUT',
      body: json(body),
    }),

  deleteDraft: (type: LegalDocumentType) =>
    apiRequest(`/admin/legal/documents/${type}/draft`, { method: 'DELETE' }),

  publish: (
    type: LegalDocumentType,
    body: PublishPayload,
  ): Promise<LegalVersion> =>
    apiRequest(`/admin/legal/documents/${type}/publish`, {
      method: 'POST',
      body: json(body),
    }),

  rollback: (
    type: LegalDocumentType,
    body: PublishPayload & { targetVersionNumber: number },
  ): Promise<LegalVersion> =>
    apiRequest(`/admin/legal/documents/${type}/rollback`, {
      method: 'POST',
      body: json(body),
    }),
};
