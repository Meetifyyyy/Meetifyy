import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pushToast } from '../../components/Toaster';
import { useConfirm } from '../../components/ConfirmProvider';
import {
  ChevronLeft,
  Eye,
  Save,
  Check,
  Clock,
  Trash2,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  FileText,
  List,
} from '../../components/icons';
import {
  legalApi,
  type LegalDocumentType,
  type LegalVersion,
} from './legalApi';
import {
  attribution,
  blockText,
  diffBlocks,
  formatDate,
  formatDateTime,
  STATUS_STYLE,
} from './legalFormat';
import { PublishDialog } from './PublishDialog';

type Tab = 'draft' | 'preview' | 'compare' | 'history';

/**
 * One document: its live version, its draft, and everything that has ever been
 * published.
 *
 * The tab order is the workflow — edit the draft, preview exactly what will be
 * stored, compare it against what is live, then publish. Publishing is the only
 * control that changes what a user sees, and it is the only one that asks for a
 * reason.
 */
export const LegalDocumentDetail: React.FC<{
  documentType: LegalDocumentType;
  onBack: () => void;
}> = ({ documentType, onBack }) => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('draft');
  const [publishing, setPublishing] = useState<
    { mode: 'publish' } | { mode: 'rollback'; version: LegalVersion } | null
  >(null);

  const { data, isLoading } = useQuery({
    queryKey: ['adminLegalDocument', documentType],
    queryFn: () => legalApi.getDocument(documentType),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['adminLegalDocument', documentType] });
    queryClient.invalidateQueries({ queryKey: ['adminLegalDocuments'] });
  };

  const draft = data?.draft ?? null;
  const published = data?.published ?? null;

  // ── Editor state ─────────────────────────────────────────────────────────
  // Seeded from the saved draft, then owned locally so typing is not fighting a
  // refetch. Keyed on the draft's id rather than the whole object: re-seeding on
  // every background refetch would discard unsaved edits.
  //
  // The body arrives with the document itself. It used to be a second request
  // (`getVersion(draft.id)`), which made opening the editor a waterfall — list
  // the document, wait, then ask for its text — for two round trips to the
  // database region before the textarea had anything in it.
  const [form, setForm] = useState({ title: '', subtitle: '', content: '' });
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!draft || draft.id === loadedDraftId) return;
    setForm({
      title: draft.title,
      subtitle: draft.subtitle ?? '',
      content: draft.content ?? '',
    });
    setLoadedDraftId(draft.id);
    setDirty(false);
  }, [draft, loadedDraftId]);

  // Leaving with unsaved edits loses them. The browser's own prompt is the only
  // one that can interrupt a tab close, so it is what this uses.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const startDraft = useMutation({
    mutationFn: () => legalApi.startDraft(documentType),
    onSuccess: () => {
      pushToast('Draft opened from the published version', 'success');
      invalidate();
    },
    onError: (err: any) => pushToast(err?.message || 'Could not open a draft'),
  });

  const saveDraft = useMutation({
    mutationFn: () =>
      legalApi.saveDraft(documentType, {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || undefined,
        content: form.content,
      }),
    onSuccess: () => {
      pushToast('Draft saved', 'success');
      setDirty(false);
      invalidate();
    },
    onError: (err: any) => pushToast(err?.message || 'Could not save the draft'),
  });

  const deleteDraft = useMutation({
    mutationFn: () => legalApi.deleteDraft(documentType),
    onSuccess: () => {
      pushToast('Draft discarded', 'success');
      setLoadedDraftId(null);
      setForm({ title: '', subtitle: '', content: '' });
      setDirty(false);
      invalidate();
    },
    onError: (err: any) => pushToast(err?.message || 'Could not discard the draft'),
  });

  if (isLoading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
        Loading document…
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { key: 'draft', label: 'Draft', icon: <Save size={14} /> },
    { key: 'preview', label: 'Preview', icon: <Eye size={14} />, disabled: !draft },
    { key: 'compare', label: 'Compare', icon: <List size={14} />, disabled: !draft },
    { key: 'history', label: 'History', icon: <Clock size={14} /> },
  ];

  return (
    <div>
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <button
            className="btn-secondary"
            onClick={onBack}
            style={{ marginBottom: '0.75rem', padding: '0.35rem 0.7rem', fontSize: '0.78rem' }}
          >
            <ChevronLeft size={14} />
            <span>All documents</span>
          </button>
          <h2 className="page-title">{data?.label}</h2>
          <p className="page-subtitle">
            {published
              ? `Version ${published.versionNumber} is live, published ${formatDate(published.publishedAt)} by ${attribution(published.publishedBy)}.`
              : 'This document has never been published.'}
          </p>
        </div>
      </div>

      {published?.requiresAcknowledgement && (
        <div
          className="glass-panel"
          style={{
            padding: '0.85rem 1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            fontSize: '0.85rem',
            color: 'var(--color-text-main)',
          }}
        >
          <ShieldCheck size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
          <span>
            Users must accept version {published.versionNumber} before they can
            continue using Meetifyy.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            disabled={t.disabled}
            className={tab === t.key ? 'btn-primary' : 'btn-secondary'}
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.78rem',
              opacity: t.disabled ? 0.5 : 1,
              cursor: t.disabled ? 'not-allowed' : 'pointer',
            }}
            title={t.disabled ? 'Open a draft first' : undefined}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'draft' && (
        <DraftTab
          draft={draft}
          form={form}
          dirty={dirty}
          saving={saveDraft.isPending}
          starting={startDraft.isPending}
          onChange={(next) => {
            setForm(next);
            setDirty(true);
          }}
          onStart={() => startDraft.mutate()}
          onSave={() => saveDraft.mutate()}
          onDiscard={() =>
            confirm({
              title: 'Discard this draft?',
              description:
                'The unpublished changes in this draft are deleted. The live version is not affected.',
              consequences: ['This cannot be undone.'],
              severity: 'moderate',
              confirmLabel: 'Discard draft',
              onConfirm: () => deleteDraft.mutateAsync(),
            })
          }
          onPublish={() => setPublishing({ mode: 'publish' })}
        />
      )}

      {tab === 'preview' && <PreviewTab content={form.content} />}

      {tab === 'compare' && (
        <CompareTab documentType={documentType} draftContent={form.content} dirty={dirty} />
      )}

      {tab === 'history' && (
        <HistoryTab
          history={data?.history ?? []}
          onRollback={(version) => setPublishing({ mode: 'rollback', version })}
        />
      )}

      {publishing && (
        <PublishDialog
          documentType={documentType}
          label={data?.label ?? ''}
          mode={publishing.mode}
          targetVersion={publishing.mode === 'rollback' ? publishing.version : null}
          nextVersionNumber={
            publishing.mode === 'publish'
              ? draft?.versionNumber ?? null
              : null
          }
          onClose={() => setPublishing(null)}
          onDone={() => {
            setPublishing(null);
            setLoadedDraftId(null);
            setForm({ title: '', subtitle: '', content: '' });
            setDirty(false);
            setTab('history');
            invalidate();
          }}
        />
      )}
    </div>
  );
};

// ── Draft ──────────────────────────────────────────────────────────────────

const DraftTab: React.FC<{
  draft: LegalVersion | null;
  form: { title: string; subtitle: string; content: string };
  dirty: boolean;
  saving: boolean;
  starting: boolean;
  onChange: (next: { title: string; subtitle: string; content: string }) => void;
  onStart: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onPublish: () => void;
}> = ({ draft, form, dirty, saving, starting, onChange, onStart, onSave, onDiscard, onPublish }) => {
  if (!draft) {
    return (
      <div className="glass-panel" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <FileText size={44} style={{ color: 'var(--color-text-dim)', margin: '0 auto 0.75rem', opacity: 0.6 }} />
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '0.35rem' }}>
          No draft open
        </h3>
        <p style={{ color: 'var(--color-text-light)', fontSize: '0.85rem', maxWidth: '32rem', margin: '0 auto 1.25rem' }}>
          Editing starts from a copy of the published text, so nothing is
          rewritten from scratch. The live version stays untouched until you
          publish.
        </p>
        <button className="btn-primary" onClick={onStart} disabled={starting}>
          {starting ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          <span>{starting ? 'Opening…' : 'Start a draft'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '1.25rem' }}>
      <Field label="Title">
        <input
          className="input-control"
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
        />
      </Field>

      <Field label="Subtitle" hint="The one-line description under the heading on the public page.">
        <input
          className="input-control"
          value={form.subtitle}
          onChange={(e) => onChange({ ...form, subtitle: e.target.value })}
        />
      </Field>

      <Field
        label="Document body"
        hint="Basic HTML — p, ul, ol, li, strong, em, a, h2-h4, tables. Anything else is stripped on save; use Preview to see exactly what will be stored."
      >
        <textarea
          className="input-control"
          rows={22}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.78rem', lineHeight: 1.6 }}
          value={form.content}
          onChange={(e) => onChange({ ...form, content: e.target.value })}
        />
      </Field>

      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: '1rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <span style={{ fontSize: '0.78rem', color: dirty ? '#eab308' : 'var(--color-text-light)' }}>
          {dirty ? 'Unsaved changes' : `Draft v${draft.versionNumber} saved ${formatDateTime(draft.updatedAt)}`}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn-secondary" onClick={onDiscard} disabled={saving}>
          <Trash2 size={14} />
          <span>Discard</span>
        </button>
        <button
          className="btn-secondary"
          onClick={onSave}
          disabled={saving || !form.title.trim() || !form.content.trim()}
        >
          {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          <span>{saving ? 'Saving…' : 'Save draft'}</span>
        </button>
        <button
          className="btn-primary"
          onClick={onPublish}
          disabled={dirty || saving}
          title={dirty ? 'Save the draft before publishing it' : undefined}
        >
          <Check size={14} />
          <span>Publish…</span>
        </button>
      </div>
      {dirty && (
        <p style={{ margin: '0.6rem 0 0', fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
          Save the draft before publishing — publishing ships what is stored on
          the server, not what is in this editor.
        </p>
      )}
    </div>
  );
};

// ── Preview ────────────────────────────────────────────────────────────────

const PreviewTab: React.FC<{ content: string }> = ({ content }) => {
  /**
   * Keyed on the content itself, so switching away to Compare and back does not
   * re-ask the server to sanitize text it has already sanitized. Every admin
   * request pays the session check before it reaches the handler, and this one
   * does no database work at all — re-issuing it on a tab click was pure
   * latency.
   *
   * Rendered server-side rather than in the browser on purpose: the point of
   * the preview is to show exactly what the SAVE path will store, and a
   * client-side approximation of the sanitizer is a second implementation that
   * can disagree with the real one.
   */
  const { data: result, isFetching: loading } = useQuery({
    queryKey: ['adminLegalPreview', content],
    queryFn: () => legalApi.preview(content),
    enabled: content.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <div className="glass-panel" style={{ padding: '1.25rem' }}>
      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, color: 'var(--color-text-light)', marginBottom: '0.75rem' }}>
        Preview — exactly what will be published
      </div>

      {loading && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
          Rendering…
        </div>
      )}

      {!loading && result?.wasModified && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            padding: '0.7rem 0.9rem',
            marginBottom: '1rem',
            borderRadius: '10px',
            background: 'rgba(234, 179, 8, 0.12)',
            color: '#eab308',
            fontSize: '0.82rem',
          }}
        >
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
          <span>
            Some markup was removed by the sanitizer. What you see below is what
            will be saved and shown to users.
          </span>
        </div>
      )}

      {!loading && result && (
        /* Server-sanitized output rendered back — not the raw textarea. */
        <div
          style={{ fontSize: '0.88rem', lineHeight: 1.7, color: 'var(--color-text-main)' }}
          dangerouslySetInnerHTML={{ __html: result.html }}
        />
      )}

      {!loading && !result && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
          {/* An empty body is a state the editor can be in; a failed render is
              not the same thing and should not claim to be. */}
          {content.length === 0
            ? 'Nothing to preview yet — the document body is empty.'
            : 'The preview could not be rendered.'}
        </div>
      )}
    </div>
  );
};

// ── Compare ────────────────────────────────────────────────────────────────

const CompareTab: React.FC<{
  documentType: LegalDocumentType;
  draftContent: string;
  dirty: boolean;
}> = ({ documentType, draftContent, dirty }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['adminLegalCompare', documentType],
    queryFn: () => legalApi.compare(documentType),
  });

  // The draft side comes from the editor when there are unsaved edits, so the
  // comparison shows what the admin is actually about to save rather than the
  // last thing they saved.
  const after = dirty ? draftContent : data?.draft?.content ?? '';
  const before = data?.published?.content ?? '';

  const rows = useMemo(() => diffBlocks(before, after), [before, after]);
  const changed = rows.filter((r) => r.type !== 'same').length;

  if (isLoading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
        Comparing…
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, color: 'var(--color-text-light)' }}>
          Draft vs published{data?.published ? ` v${data.published.versionNumber}` : ''}
        </span>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-light)' }}>
          {changed === 0 ? 'Identical' : `${changed} changed block${changed === 1 ? '' : 's'}`}
        </span>
        {dirty && (
          <span style={{ fontSize: '0.78rem', color: '#eab308' }}>
            Comparing your unsaved editor content
          </span>
        )}
      </div>

      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.76rem', lineHeight: 1.6, overflowX: 'auto' }}>
        {rows.map((row, i) => {
          const text = blockText(row.text);
          if (!text) return null;
          const tone =
            row.type === 'added'
              ? { bg: 'rgba(34, 197, 94, 0.12)', fg: '#22c55e', mark: '+' }
              : row.type === 'removed'
                ? { bg: 'rgba(239, 68, 68, 0.12)', fg: '#ef4444', mark: '−' }
                : { bg: 'transparent', fg: 'var(--color-text-light)', mark: ' ' };
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: '0.6rem',
                padding: '0.2rem 0.5rem',
                background: tone.bg,
                color: tone.fg,
                borderRadius: '4px',
              }}
            >
              <span style={{ flexShrink: 0, fontWeight: 700 }}>{tone.mark}</span>
              <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── History ────────────────────────────────────────────────────────────────

const HistoryTab: React.FC<{
  history: LegalVersion[];
  onRollback: (version: LegalVersion) => void;
}> = ({ history, onRollback }) => {
  if (history.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <Clock size={44} style={{ color: 'var(--color-text-dim)', margin: '0 auto 0.75rem', opacity: 0.6 }} />
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '0.35rem' }}>
          Nothing published yet
        </h3>
        <p style={{ color: 'var(--color-text-light)', fontSize: '0.85rem' }}>
          Versions appear here once they have been published.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      {history.map((v) => {
        const style = STATUS_STYLE[v.status] ?? STATUS_STYLE.ARCHIVED;
        return (
          <div
            key={v.id}
            className="glass-panel"
            style={{
              padding: '1rem 1.15rem',
              display: 'flex',
              gap: '1rem',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0, flex: '1 1 min(100%, 280px)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-main)' }}>
                  Version {v.versionNumber}
                </span>
                <span
                  style={{
                    padding: '0.2rem 0.6rem',
                    borderRadius: '9999px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    background: v.isCurrent ? STATUS_STYLE.PUBLISHED.bg : style.bg,
                    color: v.isCurrent ? STATUS_STYLE.PUBLISHED.fg : style.fg,
                  }}
                >
                  {v.isCurrent ? 'Live' : style.label}
                </span>
                {v.requiresAcknowledgement && (
                  <span style={{ padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 600, background: 'rgba(34, 197, 94, 0.18)', color: '#22c55e' }}>
                    Acceptance required
                  </span>
                )}
                {v.restoredFromVersionId && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>
                    restored an earlier version
                  </span>
                )}
              </div>

              {v.changeSummary && (
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', lineHeight: 1.55, color: 'var(--color-text-main)' }}>
                  {v.changeSummary}
                </p>
              )}

              <div
                style={{
                  marginTop: '0.5rem',
                  display: 'flex',
                  gap: '1.1rem',
                  flexWrap: 'wrap',
                  fontSize: '0.76rem',
                  color: 'var(--color-text-light)',
                }}
              >
                <span>Published {formatDateTime(v.publishedAt)}</span>
                <span>By {attribution(v.publishedBy)}</span>
                <span>Effective {formatDate(v.effectiveAt)}</span>
                {typeof v._count?.acknowledgements === 'number' && v.requiresAcknowledgement && (
                  <span>{v._count.acknowledgements} accepted</span>
                )}
              </div>
            </div>

            {!v.isCurrent && (
              <button className="btn-secondary" onClick={() => onRollback(v)}>
                <Clock size={14} />
                <span>Restore this version</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div style={{ marginBottom: '0.9rem' }}>
    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-light)', marginBottom: '0.35rem' }}>
      {label}
    </label>
    {children}
    {hint && (
      <p style={{ margin: '0.35rem 0 0', fontSize: '0.74rem', lineHeight: 1.5, color: 'var(--color-text-dim)' }}>
        {hint}
      </p>
    )}
  </div>
);
