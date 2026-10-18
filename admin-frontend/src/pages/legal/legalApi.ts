import { apiRequest } from '../../api/apiClient';

/**
 * The Legal section's server calls, in one place.
 *
 * Every path sits under `/admin/legal`, which puts them behind AdminJwtGuard
 * (session + CSRF) and makes AuditInterceptor log each mutation as
 * LEGAL_DOCUMENT activity.
 *
 * There is no call that edits a published version — the server has no such
 * route. The only writes are to the draft, and the only transitions are
 * publish and notify.
 */

export type LegalDocumentType =
  | 'TERMS_OF_SERVICE'
  | 'PRIVACY_POLICY'
  | 'COOKIE_POLICY'
  | 'COMMUNITY_GUIDELINES';

export const LEGAL_DOCUMENT_TYPES: LegalDocumentType[] = [
  'TERMS_OF_SERVICE',
  'PRIVACY_POLICY',
  'COOKIE_POLICY',
  'COMMUNITY_GUIDELINES',
];

export const isLegalDocumentType = (value: unknown): value is LegalDocumentType =>
  typeof value === 'string' && (LEGAL_DOCUMENT_TYPES as string[]).includes(value);

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
}

export type LegalVersionWithContent = LegalVersion & { content: string };

export interface AcceptanceStats {
  acknowledged: number;
  totalActiveUsers: number;
}

export interface LegalDocumentSummary {
  documentType: LegalDocumentType;
  label: string;
  path: string;
  published: LegalVersion | null;
  draft: LegalVersion | null;
  publishedVersionCount: number;
  lastNotifiedAt: string | null;
  stats: AcceptanceStats | null;
}

export type LegalHistoryEntry = LegalVersion & {
  notified: boolean;
  stats: AcceptanceStats | null;
};

export interface LegalDocumentDetail {
  documentType: LegalDocumentType;
  label: string;
  path: string;
  published: LegalVersion | null;
  draft: LegalVersionWithContent | null;
  history: LegalHistoryEntry[];
  totalActiveUsers: number;
}

export interface PublishPayload {
  notifyUsers: boolean;
  changeSummary?: string;
  effectiveAt?: string;
}

export interface NotifyPayload {
  documentTypes: LegalDocumentType[];
  changeSummary: string;
  effectiveAt?: string;
}

export interface PreviewResult {
  html: string;
  plainText: string;
  wasModified: boolean;
}

const json = (body: unknown) => JSON.stringify(body);

export const legalApi = {
  listDocuments: (): Promise<LegalDocumentSummary[]> =>
    apiRequest<LegalDocumentSummary[]>('/admin/legal/documents'),

  audience: (): Promise<{ totalActiveUsers: number }> =>
    apiRequest<{ totalActiveUsers: number }>('/admin/legal/audience'),

  getDocument: (type: LegalDocumentType): Promise<LegalDocumentDetail> =>
    apiRequest<LegalDocumentDetail>(`/admin/legal/documents/${type}`),

  getVersion: (id: string): Promise<LegalVersionWithContent> =>
    apiRequest<LegalVersionWithContent>(`/admin/legal/versions/${encodeURIComponent(id)}`),

  /** Runs content through the save path's sanitizer without storing it. */
  preview: (content: string): Promise<PreviewResult> =>
    apiRequest<PreviewResult>('/admin/legal/preview', {
      method: 'POST',
      body: json({ content }),
    }),

  /** Opens a draft from the live text, or — with a version id — from that version. */
  startDraft: (
    type: LegalDocumentType,
    fromVersionId?: string,
  ): Promise<LegalVersionWithContent> =>
    apiRequest<LegalVersionWithContent>(`/admin/legal/documents/${type}/draft`, {
      method: 'POST',
      body: json(fromVersionId ? { fromVersionId } : {}),
    }),

  saveDraft: (
    type: LegalDocumentType,
    body: { title: string; subtitle?: string; content: string },
  ): Promise<LegalVersionWithContent> =>
    apiRequest<LegalVersionWithContent>(`/admin/legal/documents/${type}/draft`, {
      method: 'PUT',
      body: json(body),
    }),

  deleteDraft: (type: LegalDocumentType): Promise<{ success: true }> =>
    apiRequest<{ success: true }>(`/admin/legal/documents/${type}/draft`, {
      method: 'DELETE',
    }),

  publish: (type: LegalDocumentType, body: PublishPayload): Promise<LegalVersion> =>
    apiRequest<LegalVersion>(`/admin/legal/documents/${type}/publish`, {
      method: 'POST',
      body: json(body),
    }),

  notify: (body: NotifyPayload): Promise<{ versions: LegalVersion[] }> =>
    apiRequest<{ versions: LegalVersion[] }>('/admin/legal/notify', {
      method: 'POST',
      body: json(body),
    }),
};
