import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pushToast } from '../../components/Toaster';
import { useConfirm } from '../../components/ConfirmProvider';
import {
  AlertTriangle,
  Bold,
  Check,
  ChevronLeft,
  Code,
  Heading2,
  Heading3,
  Italic,
  LinkIcon,
  List,
  ListOrdered,
  Loader2,
  Pilcrow,
  RemoveFormatting,
  Save,
  ShieldCheck,
  Trash2,
  Unlink,
} from '../../components/icons';
import {
  isLegalDocumentType,
  legalApi,
  type LegalDocumentType,
  type LegalVersionWithContent,
} from './legalApi';
import { errorMessage, formatDateTime } from './legalFormat';
import { DocumentPreview, Field } from './LegalBits';
import { PublishDialog } from './PublishDialog';
import './legal.css';

/** /legal/:type/edit — the draft editor with a live, server-sanitized preview. */
export const LegalEditorPage: React.FC = () => {
  const { type } = useParams();
  if (!isLegalDocumentType(type)) {
    return (
      <Link to="/legal" className="btn-secondary" style={{ textDecoration: 'none' }}>
        All documents
      </Link>
    );
  }
  return <Editor documentType={type} />;
};

/** The value, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled;
}

type Mode = 'visual' | 'source';

const Editor: React.FC<{ documentType: LegalDocumentType }> = ({ documentType }) => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({ title: '', subtitle: '', content: '' });
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [dirty, setDirtyState] = useState(false);
  /**
   * `dirty`, readable synchronously. The navigation guard below consults it at
   * the moment of navigating, and a leave that has just been confirmed (or a
   * discard that has just succeeded) clears it in the same tick as the
   * navigate() that follows — state alone would still read "dirty" there and
   * block the very navigation the person asked for.
   */
  const dirtyRef = useRef(false);
  const setDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirtyState(next);
  }, []);
  const [mode, setMode] = useState<Mode>('visual');
  const [linking, setLinking] = useState<{ url: string; range: Range | null } | null>(null);
  const [publishing, setPublishing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['adminLegalDocument', documentType],
    queryFn: () => legalApi.getDocument(documentType),
  });
  const draft = data?.draft ?? null;
  const backTo = `/legal/${documentType}`;

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['adminLegalDocument', documentType] });
    void queryClient.invalidateQueries({ queryKey: ['adminLegalDocuments'] });
  }, [queryClient, documentType]);

  const seed = useCallback((d: LegalVersionWithContent) => {
    setForm({ title: d.title, subtitle: d.subtitle ?? '', content: d.content });
    setLoadedId(d.id);
    setDirty(false);
    if (editorRef.current) editorRef.current.innerHTML = d.content;
  }, [setDirty]);

  // Opening the editor with no draft opens one from the live text.
  const startDraft = useMutation({
    mutationFn: () => legalApi.startDraft(documentType),
    onSuccess: (d) => {
      seed(d);
      invalidate();
    },
    onError: (e: unknown) => pushToast(errorMessage(e, 'Could not open a draft')),
  });
  const startedRef = useRef(false);
  useEffect(() => {
    if (!data || data.draft || startedRef.current) return;
    startedRef.current = true;
    startDraft.mutate();
  }, [data, startDraft]);

  // Seed once per draft. A background refetch must not wipe unsaved typing.
  useEffect(() => {
    if (draft && draft.id !== loadedId) seed(draft);
  }, [draft, loadedId, seed]);

  // Populate the editable surface when it mounts for a draft, and when
  // returning from the HTML view. Not on every keystroke: while editing
  // visually the DOM is the source, and rewriting it would move the caret.
  const contentRef = useRef(form.content);
  contentRef.current = form.content;
  useEffect(() => {
    const el = editorRef.current;
    if (mode === 'visual' && el && el.innerHTML !== contentRef.current) {
      el.innerHTML = contentRef.current;
    }
  }, [mode, loadedId]);

  /**
   * Unsaved changes block every in-app navigation, not just this page's own
   * back link: the sidebar, the browser's back button, a link in a toast. The
   * shared confirm dialog asks; Leave lets the navigation through, anything
   * else (Stay, Escape, the backdrop) cancels it. Reloads and closing the tab
   * are the beforeunload handler's job below.
   */
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  // Read through a ref: `blocker` is a new object every render, and opening
  // the dialog re-renders this page, so depending on it would reopen the
  // dialog in a loop. The effect runs on the state transition only.
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const blocked = blockerRef.current;
    confirm({
      title: 'Leave without saving?',
      description: 'Your unsaved changes to this draft will be lost.',
      severity: 'moderate',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      onConfirm: () => {
        setDirty(false);
        blocked.proceed?.();
      },
      onCancel: () => blocked.reset?.(),
    });
  }, [blocker.state, confirm, setDirty]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const update = (next: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...next }));
    setDirty(true);
  };

  const syncFromEditor = () => {
    const html = editorRef.current?.innerHTML ?? '';
    setForm((prev) => (prev.content === html ? prev : { ...prev, content: html }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () =>
      legalApi.saveDraft(documentType, {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || undefined,
        content: form.content,
      }),
    onSuccess: (saved) => {
      // What is stored is the sanitized text; show exactly that.
      if (saved.content !== form.content) seed(saved);
      else setDirty(false);
      pushToast('Draft saved', 'success');
      invalidate();
    },
    onError: (e: unknown) => pushToast(errorMessage(e, 'Could not save the draft')),
  });

  const discard = useMutation({
    mutationFn: () => legalApi.deleteDraft(documentType),
    onSuccess: () => {
      setDirty(false);
      pushToast('Draft discarded', 'success');
      invalidate();
      navigate(backTo);
    },
  });

  const canSave = !!form.title.trim() && !!form.content.trim() && !save.isPending;

  // Cmd/Ctrl+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty && canSave) save.mutate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, canSave, save]);

  // Live preview: the server's sanitizer, so it is exactly what will be stored.
  const settled = useDebounced(form.content, 400);
  const { data: preview, isFetching: previewing } = useQuery({
    queryKey: ['adminLegalPreview', settled],
    queryFn: () => legalApi.preview(settled),
    enabled: settled.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

  /**
   * `execCommand` is deprecated but is still the only way to format a
   * contentEditable selection without an editor framework — the same choice
   * the support reply composer makes. The server sanitizes regardless.
   */
  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncFromEditor();
  };

  const beginLink = () => {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    setLinking({ url: 'https://', range });
  };

  const applyLink = () => {
    if (!linking) return;
    const url = linking.url.trim();
    if (linking.range) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(linking.range);
    }
    if (/^(https?:\/\/|mailto:|\/)/i.test(url)) exec('createLink', url);
    setLinking(null);
  };

  // The navigation guard asks about unsaved changes, here as everywhere else.
  const leave = () => navigate(backTo);

  if ((isLoading && !data) || (!draft && startDraft.isPending)) {
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div className="legal-skeleton" style={{ height: 70 }} />
        <div className="legal-skeleton" style={{ height: 480 }} />
      </div>
    );
  }
  if (!data || !draft) {
    return (
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ marginBottom: '1rem' }}>The draft could not be opened.</p>
        <Link to={backTo} className="btn-secondary" style={{ textDecoration: 'none' }}>
          Back
        </Link>
      </div>
    );
  }

  const tools: { label: string; icon: React.ReactNode; run: () => void }[] = [
    { label: 'Paragraph', icon: <Pilcrow size={15} />, run: () => exec('formatBlock', '<p>') },
    { label: 'Heading', icon: <Heading2 size={15} />, run: () => exec('formatBlock', '<h2>') },
    { label: 'Subheading', icon: <Heading3 size={15} />, run: () => exec('formatBlock', '<h3>') },
    { label: 'Bold', icon: <Bold size={15} />, run: () => exec('bold') },
    { label: 'Italic', icon: <Italic size={15} />, run: () => exec('italic') },
    { label: 'Bulleted list', icon: <List size={15} />, run: () => exec('insertUnorderedList') },
    { label: 'Numbered list', icon: <ListOrdered size={15} />, run: () => exec('insertOrderedList') },
    { label: 'Link', icon: <LinkIcon size={15} />, run: beginLink },
    { label: 'Remove link', icon: <Unlink size={15} />, run: () => exec('unlink') },
    { label: 'Clear formatting', icon: <RemoveFormatting size={15} />, run: () => exec('removeFormat') },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <button type="button" className="legal-link" onClick={leave} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <ChevronLeft size={14} />
            {data.label}
          </button>
          <h2 className="page-title" style={{ marginTop: '0.35rem' }}>
            Editing draft v{draft.versionNumber}
          </h2>
          <p className="page-subtitle">
            The live version is untouched until you publish. Anything the sanitizer would remove
            is already gone in the preview.
          </p>
        </div>
      </div>

      <div className="legal-editor-layout">
        <div className="glass-panel" style={{ padding: '1.1rem' }}>
          <Field label="Title" htmlFor="legal-title">
            <input id="legal-title" className="input-control" value={form.title} maxLength={200} onChange={(e) => update({ title: e.target.value })} />
          </Field>
          <Field label="Subtitle" htmlFor="legal-subtitle" hint="The one line under the heading on the public page.">
            <input id="legal-subtitle" className="input-control" value={form.subtitle} maxLength={300} onChange={(e) => update({ subtitle: e.target.value })} />
          </Field>

          <div className="legal-field-label">
            <span>Document</span>
          </div>
          <div className="legal-toolbar" role="toolbar" aria-label="Formatting">
            {mode === 'visual' &&
              tools.map((t, i) => (
                <React.Fragment key={t.label}>
                  {(i === 3 || i === 5 || i === 7) && <span className="legal-tool-sep" aria-hidden="true" />}
                  <button
                    type="button"
                    className="legal-tool"
                    title={t.label}
                    aria-label={t.label}
                    // Keep the selection in the editor while clicking.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={t.run}
                  >
                    {t.icon}
                  </button>
                </React.Fragment>
              ))}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className={`legal-tool${mode === 'source' ? ' is-active' : ''}`}
              title="Edit HTML"
              aria-pressed={mode === 'source'}
              onClick={() => setMode((m) => (m === 'visual' ? 'source' : 'visual'))}
            >
              <Code size={15} />
              <span style={{ marginLeft: 4 }}>HTML</span>
            </button>
          </div>

          {linking && (
            <div style={{ display: 'flex', gap: '0.4rem', padding: '0.5rem', border: '1px solid var(--color-border)', borderBottom: 'none', background: 'var(--color-bg-white)' }}>
              <input
                className="input-control"
                autoFocus
                aria-label="Link address"
                value={linking.url}
                onChange={(e) => setLinking({ ...linking, url: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyLink();
                  }
                  if (e.key === 'Escape') setLinking(null);
                }}
              />
              <button type="button" className="btn-primary" onClick={applyLink}>
                <Check size={14} />
              </button>
            </div>
          )}

          {mode === 'visual' ? (
            <div
              ref={editorRef}
              className="legal-editable"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Document body"
              data-placeholder="Write the document…"
              onInput={syncFromEditor}
            />
          ) : (
            <textarea
              className="input-control legal-source"
              aria-label="Document HTML"
              value={form.content}
              onChange={(e) => update({ content: e.target.value })}
              spellCheck={false}
            />
          )}
        </div>

        <div className="legal-preview-frame" aria-label="Preview">
          <div className="legal-preview-bar">
            <span>Preview · as on the website</span>
            {previewing && <Loader2 size={13} className="spin" />}
          </div>
          {preview?.wasModified && (
            <div className="legal-callout legal-callout-warn" style={{ margin: '0.75rem 1rem 0' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>Some markup is not allowed and will be removed on save. The preview shows what will be stored.</span>
            </div>
          )}
          <DocumentPreview title={form.title} subtitle={form.subtitle} html={preview?.html ?? ''} />
        </div>
      </div>

      <div className="legal-savebar">
        <span className="legal-savebar-status" style={{ fontSize: '0.78rem', color: dirty ? '#B45309' : 'var(--color-text-light)' }}>
          {dirty ? 'Unsaved changes — save the draft before publishing' : `Saved ${formatDateTime(draft.updatedAt)}`}
        </span>
        <span className="legal-savebar-spacer" />
        <button
          type="button"
          className="btn-danger legal-savebar-discard"
          onClick={() =>
            confirm({
              title: 'Discard this draft?',
              description: 'The unpublished changes are deleted. The live version is not affected.',
              consequences: ['This cannot be undone.'],
              severity: 'moderate',
              confirmLabel: 'Discard draft',
              onConfirm: () => discard.mutateAsync(),
            })
          }
          disabled={save.isPending}
        >
          <Trash2 size={14} />
          <span>Discard</span>
        </button>
        <button type="button" className="btn-secondary legal-savebar-save" onClick={() => save.mutate()} disabled={!dirty || !canSave}>
          {save.isPending ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          <span>{save.isPending ? 'Saving…' : 'Save draft'}</span>
        </button>
        <button
          type="button"
          className="btn-primary legal-savebar-publish"
          onClick={() => setPublishing(true)}
          disabled={dirty || save.isPending}
          title={dirty ? 'Save the draft first — publishing ships what is saved' : undefined}
          style={dirty ? { opacity: 0.55 } : undefined}
        >
          <ShieldCheck size={14} />
          <span>Publish…</span>
        </button>
      </div>

      {publishing && (
        <PublishDialog
          documentType={documentType}
          label={data.label}
          draftVersionNumber={draft.versionNumber}
          totalActiveUsers={data.totalActiveUsers}
          onClose={() => setPublishing(false)}
          onDone={() => {
            setPublishing(false);
            invalidate();
            navigate(backTo);
          }}
        />
      )}
    </div>
  );
};
