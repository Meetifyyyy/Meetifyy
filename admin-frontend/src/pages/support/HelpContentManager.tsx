import { LoadingState } from '../../components/LoadingState';
import { Dropdown } from '../../components/Dropdown';
import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Archive,
  CheckCircle,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Plus,
  Pencil,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from '../../components/icons';

import { helpApi, type HelpArticlePayload, type HelpCategoryPayload } from './supportApi';
import { HELP_STATUS_BADGE, HELP_STATUS_LABELS, formatDateTime } from './supportConstants';
import { useConfirm } from '../../components/ConfirmProvider';

type Editing =
  | { kind: 'category'; value: any | null }
  | { kind: 'article'; value: any | null }
  | null;

/**
 * Help-centre content management.
 *
 * Everything the public Help & Support page renders is edited here: categories,
 * articles, their order, their publication state and which of them are
 * featured. The public page has no hardcoded content at all, so an empty table
 * here means an empty page there - which is why publishing is a visible,
 * reversible state rather than a delete.
 */
export const HelpContentManager: React.FC = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(timer); }, [search]);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [banner, setBanner] = useState<{ tone: 'error' | 'ok' | 'warn'; text: string } | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['adminHelpCategories'],
    queryFn: () => helpApi.listCategories(),
  });

  const articlesQuery = useQuery({
    queryKey: ['adminHelpArticles', { search: debouncedSearch, statusFilter, categoryFilter }],
    queryFn: () => helpApi.listArticles({ search: debouncedSearch, status: statusFilter, categoryId: categoryFilter }),
    placeholderData: (previous) => previous,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['adminHelpCategories'] });
    queryClient.invalidateQueries({ queryKey: ['adminHelpArticles'] });
  };

  /** One wrapper so every mutation reports success and failure the same way. */
  /**
   * Deleting help content, through the portal-wide dialog.
   *
   * This screen used to carry its own copy of a confirmation modal - the third
   * in the admin portal, each with different wording, spacing and (here) no
   * pending state at all, so the Delete button stayed live while the request
   * was running. `run` still reports into this screen's banner, and the shared
   * dialog reports the same failure inline, so a failed delete is visible
   * whichever the operator is looking at.
   */
  const confirmDeletion = (kind: 'category' | 'article', id: string, label: string) =>
    confirm({
      title: `Delete this ${kind}?`,
      description: `\u201C${label}\u201D will be removed permanently.`,
      consequences: [
        'If you only want it off the public page, unpublish or archive it instead - that is reversible.',
      ],
      severity: 'critical',
      confirmLabel: 'Delete permanently',
      onConfirm: () =>
        run(
          () => (kind === 'category' ? helpApi.deleteCategory(id) : helpApi.deleteArticle(id)),
          'Deleted.',
          true,
        ),
    });

  const run = async (fn: () => Promise<any>, okText: string, propagateError = false) => {
    setBanner(null);
    try {
      const result = await fn();
      refresh();
      // Some endpoints answer with an advisory rather than a plain success -
      // publishing an article whose category is still a draft, for instance.
      setBanner(result?.warning ? { tone: 'warn', text: result.warning } : { tone: 'ok', text: okText });
      return true;
    } catch (e: any) {
      setBanner({ tone: 'error', text: e?.message || 'That change could not be saved.' });
      if (propagateError) throw e;
      return false;
    }
  };

  const saveCategory = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: HelpCategoryPayload }) =>
      id ? helpApi.updateCategory(id, payload) : helpApi.createCategory(payload),
  });

  const saveArticle = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: HelpArticlePayload }) =>
      id ? helpApi.updateArticle(id, payload) : helpApi.createArticle(payload),
  });

  const categories = categoriesQuery.data ?? [];
  const articles = articlesQuery.data ?? [];

  /**
   * Moves one item up or down by swapping its sortOrder with its neighbour's,
   * then sends the whole list. Sending both rows rather than just the moved one
   * is what keeps the order well-defined - writing one side of a swap leaves
   * two items claiming the same position.
   */
  const move = (items: any[], index: number, direction: -1 | 1, kind: 'category' | 'article') => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const reordered = [...items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const payload = reordered.map((item, position) => ({ id: item.id, sortOrder: position }));

    run(
      () => (kind === 'category' ? helpApi.reorderCategories(payload) : helpApi.reorderArticles(payload)),
      'Order updated.',
    );
  };

  return (
    <div className="support-help">
      {banner && (
        <div style={bannerStyle(banner.tone)} role="status">
          {banner.tone === 'error' ? <AlertTriangle size={15} /> : banner.tone === 'warn' ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
          <span style={{ flex: 1 }}>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="support-help-icon" aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Categories ───────────────────────────────────────────────────── */}
      <section className="support-help-section">
        <div className="support-help-header">
          <div>
            <h3 className="support-help-title">Help categories</h3>
            <p className="support-help-subtitle">Order here is the order on the public page.</p>
          </div>
          <button className="btn-primary" onClick={() => { setBanner(null); setEditing({ kind: 'category', value: null }); }}>
            <Plus size={14} />
            <span>New category</span>
          </button>
        </div>

        {categoriesQuery.isLoading ? (
          <LoadingState label="Loading help categories" compact />
        ) : categoriesQuery.isError ? (
          <div className="support-empty">
            <AlertTriangle size={18} color="var(--color-danger)" />
            <span>Categories could not be loaded.</span>
            <button className="btn-secondary" onClick={() => categoriesQuery.refetch()}>
              <RefreshCw size={13} />
              <span>Try again</span>
            </button>
          </div>
        ) : categories.length === 0 ? (
          <div className="support-empty">
            <FileText size={18} />
            <span>No categories yet. Create one to start building the help centre.</span>
          </div>
        ) : (
          <div className="support-help-table-wrap">
            <table className="admin-table support-help-table support-category-table" aria-label="Help categories">
              <colgroup><col className="help-order-column" /><col /><col className="help-count-column" /><col className="help-status-column" /><col className="help-actions-column" /></colgroup>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Category</th>
                  <th>Articles</th>
                  <th>Status</th>
                  <th className="support-help-actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category: any, index: number) => (
                  <tr key={category.id}>
                    <td data-label="Order">
                      <div className="support-entry-order">
                        <button
                          className="support-help-icon"
                          disabled={index === 0}
                          onClick={() => move(categories, index, -1, 'category')}
                          aria-label={`Move ${category.title} up`}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          className="support-help-icon"
                          disabled={index === categories.length - 1}
                          onClick={() => move(categories, index, 1, 'category')}
                          aria-label={`Move ${category.title} down`}
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    </td>
                    <td data-label="Category">
                      <div className="support-entry-title"><span>{category.title}</span></div>
                      <div className="support-entry-slug" title={`/${category.slug}`}>/{category.slug}</div>
                    </td>
                    <td data-label="Articles">
                      <div className="support-entry-count"><strong>{category.publishedArticleCount}</strong><span>published</span></div>
                      {category.articleCount > category.publishedArticleCount && <div className="support-entry-secondary">{category.articleCount - category.publishedArticleCount} draft / archived</div>}
                    </td>
                    <td data-label="Status">
                      <span className={`badge ${HELP_STATUS_BADGE[category.status]}`}>
                        {HELP_STATUS_LABELS[category.status]}
                      </span>
                    </td>
                    <td data-label="Actions">
                      <div className="support-help-actions">
                        <button
                          className="btn-secondary support-help-button support-publish-button"
                          aria-label={`${category.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'} ${category.title}`}
                          title={category.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                          onClick={() =>
                            run(
                              () =>
                                helpApi.setCategoryStatus(
                                  category.id,
                                  category.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED',
                                ),
                              category.status === 'PUBLISHED' ? 'Category unpublished.' : 'Category published.',
                            )
                          }
                        >
                          {category.status === 'PUBLISHED' ? <EyeOff size={12} /> : <Eye size={12} />}
                          <span>{category.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}</span>
                        </button>
                        <button
                          className="btn-secondary support-help-button"
                          aria-label={`Edit ${category.title}`}
                          title="Edit"
                          onClick={() => { setBanner(null); setEditing({ kind: 'category', value: category }); }}
                        >
                          <Pencil size={15} /><span>Edit</span>
                        </button>
                        {category.status !== 'ARCHIVED' && (
                          <button
                            className="btn-secondary support-help-button"
                            onClick={() =>
                              run(() => helpApi.archiveCategory(category.id), 'Category and its articles archived.')
                            }
                            aria-label={`Archive ${category.title} and its articles`}
                            title="Archive category and articles"
                          >
                            <Archive size={12} />
                          </button>
                        )}
                        <button
                          className="btn-danger support-help-button"
                          onClick={() =>
                            confirmDeletion('category', category.id, category.title)
                          }
                          aria-label={`Delete ${category.title}`}
                          title="Delete category"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Articles ─────────────────────────────────────────────────────── */}
      <section className="support-help-section">
        <div className="support-help-header">
          <div>
            <h3 className="support-help-title">Help articles</h3>
            <p className="support-help-subtitle">Featured articles appear in the FAQ list at the top of the public page.</p>
          </div>
          <button
            className="btn-primary"
            disabled={categories.length === 0}
            title={categories.length === 0 ? 'Create a category first' : undefined}
            onClick={() => { setBanner(null); setEditing({ kind: 'article', value: null }); }}
          >
            <Plus size={14} />
            <span>New article</span>
          </button>
        </div>

        <div className="support-help-filters">
          <div style={{ position: 'relative', flex: '1 1 12rem', minWidth: 0 }}>
            <Search size={14} style={searchIcon} />
            <input
              className="input-control"
              style={{ paddingLeft: '2rem', fontSize: '0.8125rem', width: '100%' }}
              placeholder="Search questions, answers and keywords…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search help articles"
            />
          </div>
          <Dropdown
            className="input-control support-help-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {Object.entries(HELP_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Dropdown>
          <Dropdown
            className="input-control support-help-filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {categories.map((category: any) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </Dropdown>
        </div>

        {articlesQuery.isLoading ? (
          <LoadingState label="Loading help articles" compact />
        ) : articlesQuery.isError ? (
          <div className="support-empty">
            <AlertTriangle size={18} color="var(--color-danger)" />
            <span>Articles could not be loaded.</span>
            <button className="btn-secondary" onClick={() => articlesQuery.refetch()}>
              <RefreshCw size={13} />
              <span>Try again</span>
            </button>
          </div>
        ) : articles.length === 0 ? (
          <div className="support-empty">
            <FileText size={18} />
            <span>{search || statusFilter || categoryFilter ? 'No articles match these filters.' : 'No articles yet.'}</span>
          </div>
        ) : (
          <div className="support-help-table-wrap">
            <table className="admin-table support-help-table support-article-table" aria-label="Help articles">
              <colgroup><col className="help-order-column" /><col /><col className="help-category-column" /><col className="help-status-column" /><col className="help-updated-column" /><col className="help-actions-column" /></colgroup>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Question</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th className="support-help-actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((article: any, index: number) => (
                  <tr key={article.id}>
                    <td data-label="Order">
                      <div className="support-entry-order">
                        <button
                          className="support-help-icon"
                          // Reordering is only meaningful within one category;
                          // the arrows are disabled unless the list is filtered
                          // to a single one, where "up" and "down" have an
                          // unambiguous meaning.
                          disabled={!categoryFilter || index === 0}
                          title={!categoryFilter ? 'Filter to one category to reorder' : undefined}
                          onClick={() => move(articles, index, -1, 'article')}
                          aria-label={`Move ${article.question} up`}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          className="support-help-icon"
                          disabled={!categoryFilter || index === articles.length - 1}
                          title={!categoryFilter ? 'Filter to one category to reorder' : undefined}
                          onClick={() => move(articles, index, 1, 'article')}
                          aria-label={`Move ${article.question} down`}
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    </td>
                    <td data-label="Question">
                      <div className="support-entry-title">
                        {article.isFeatured && <span className="support-entry-featured" title="Featured article" aria-label="Featured article"><Star size={14} fill="currentColor" /></span>}
                        <span>{article.question}</span>
                      </div>
                      <div className="support-entry-slug" title={`/${article.slug}`}>/{article.slug}</div>
                    </td>
                    <td data-label="Category"><span className="support-entry-category">{article.category?.title ?? 'Uncategorised'}</span></td>
                    <td data-label="Status">
                      <span className={`badge ${HELP_STATUS_BADGE[article.status]}`}>
                        {HELP_STATUS_LABELS[article.status]}
                      </span>
                    </td>
                    <td data-label="Updated"><time className="support-entry-updated" dateTime={article.updatedAt}>{formatDateTime(article.updatedAt)}</time></td>
                    <td data-label="Actions">
                      <div className="support-help-actions">
                        <button
                          className="btn-secondary support-help-button support-publish-button"
                          aria-label={`${article.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'} ${article.question}`}
                          title={article.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                          onClick={() =>
                            run(
                              () =>
                                helpApi.setArticleStatus(
                                  article.id,
                                  article.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED',
                                ),
                              article.status === 'PUBLISHED' ? 'Article unpublished.' : 'Article published.',
                            )
                          }
                        >
                          {article.status === 'PUBLISHED' ? <EyeOff size={12} /> : <Eye size={12} />}
                          <span>{article.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}</span>
                        </button>
                        <button
                          className="btn-secondary support-help-button"
                          onClick={() =>
                            run(
                              () => helpApi.updateArticle(article.id, { isFeatured: !article.isFeatured }),
                              article.isFeatured ? 'Removed from the FAQ list.' : 'Added to the FAQ list.',
                            )
                          }
                          aria-label={`${article.isFeatured ? 'Unfeature' : 'Feature'} ${article.question}`}
                          aria-pressed={article.isFeatured}
                          title={article.isFeatured ? 'Remove from FAQ list' : 'Feature in FAQ list'}
                        >
                          <Star size={12} fill={article.isFeatured ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          className="btn-secondary support-help-button"
                          aria-label={`Edit ${article.question}`}
                          title="Edit"
                          onClick={() => { setBanner(null); setEditing({ kind: 'article', value: article }); }}
                        >
                          <Pencil size={15} /><span>Edit</span>
                        </button>
                        <button
                          className="btn-danger support-help-button"
                          onClick={() => confirmDeletion('article', article.id, article.question)}
                          aria-label={`Delete ${article.question}`}
                          title="Delete article"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing?.kind === 'category' && (
        <CategoryModal
          category={editing.value}
          saving={saveCategory.isPending}
          error={banner?.tone === 'error' ? banner.text : null}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            const saved = await run(
              () => saveCategory.mutateAsync({ id: editing.value?.id, payload }),
              editing.value ? 'Category updated.' : 'Category created.',
            );
            if (saved) setEditing(null);
          }}
        />
      )}

      {editing?.kind === 'article' && (
        <ArticleModal
          article={editing.value}
          categories={categories}
          saving={saveArticle.isPending}
          error={banner?.tone === 'error' ? banner.text : null}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            const saved = await run(
              () => saveArticle.mutateAsync({ id: editing.value?.id, payload }),
              editing.value ? 'Article updated.' : 'Article created.',
            );
            if (saved) setEditing(null);
          }}
        />
      )}
    </div>
  );
};

// ── Modals ─────────────────────────────────────────────────────────────────

function useEditorKeyboard(onClose: () => void, saving: boolean) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onClose, saving });
  useEffect(() => { handlers.current = { onClose, saving }; }, [onClose, saving]);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (!dialog?.contains(document.activeElement)) dialog?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (!dialog || document.querySelector('[role="alertdialog"], [role="listbox"]')) return;
      if (event.key === 'Escape' && !handlers.current.saving) { event.preventDefault(); handlers.current.onClose(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('*')).filter((node) => node.matches('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') && !node.closest('[hidden]'));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return dialogRef;
}

const CategoryModal: React.FC<{
  category: any | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: HelpCategoryPayload) => void;
}> = ({ category, saving, error, onClose, onSave }) => {
  const dialogRef = useEditorKeyboard(onClose, saving);
  const [form, setForm] = useState({
    title: category?.title ?? '',
    slug: category?.slug ?? '',
    description: category?.description ?? '',
    icon: category?.icon ?? '',
  });

  return (
    <div className="modal-backdrop support-help-dialog">
      <div ref={dialogRef} className="modal-content dialog-form admin-dialog-layout" role="dialog" aria-modal="true" aria-labelledby="help-category-title">
        <div className="dialog-header"><h3 id="help-category-title">{category ? 'Edit category' : 'New category'}</h3><button type="button" className="dialog-close" aria-label="Close category editor" onClick={onClose} disabled={saving}>×</button></div>
        <div className="admin-dialog-body">
          {error && <p className="support-editor-error" role="alert">{error}</p>}
          <Field label="Title">
            <input
              className="input-control"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>

          <Field label="URL slug" hint={category ? 'Changing this breaks existing links to the category.' : 'Left blank, one is generated from the title.'}>
            <input
              className="input-control"
              value={form.slug}
              placeholder="account-login"
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </Field>

          <Field label="Description">
            <textarea
              className="input-control"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>

          <Field label="Icon" hint="One of: KeyRound, UserCog, MessageCircle, Users, FileText, CalendarDays, Bell, ShieldCheck, Wrench.">
            <input
              className="input-control"
              value={form.icon}
              placeholder="ShieldCheck"
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
            />
          </Field>
        </div>
        <div style={modalActions} className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!form.title.trim() || saving}
            onClick={() =>
              onSave({
                title: form.title.trim(),
                slug: form.slug.trim() || undefined,
                description: form.description.trim(),
                icon: form.icon.trim(),
              })
            }
          >
            {saving && <Loader2 size={14} className="spin" />}
            <span>{saving ? 'Saving…' : 'Save'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const ArticleModal: React.FC<{
  article: any | null;
  categories: any[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: HelpArticlePayload) => void;
}> = ({ article, categories, saving, error, onClose, onSave }) => {
  const dialogRef = useEditorKeyboard(onClose, saving);
  const [form, setForm] = useState({
    categoryId: article?.categoryId ?? categories[0]?.id ?? '',
    question: article?.question ?? '',
    slug: article?.slug ?? '',
    summary: article?.summary ?? '',
    body: article?.body ?? '',
    keywords: (article?.keywords ?? []).join(', '),
    isFeatured: article?.isFeatured ?? false,
  });
  const [preview, setPreview] = useState<{ html: string; wasModified: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const runPreview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await helpApi.previewArticle(form.body);
      setPreview({ html: result.html, wasModified: result.wasModified });
    } catch (error: any) {
      setPreview(null);
      setPreviewError(error?.message || 'The preview could not be loaded. Try again.');
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="modal-backdrop support-help-dialog">
      <div ref={dialogRef} className="modal-content dialog-form admin-dialog-layout" role="dialog" aria-modal="true" aria-labelledby="help-article-title" >
        <div className="dialog-header"><h3 id="help-article-title">{article ? 'Edit article' : 'New article'}</h3><button type="button" className="dialog-close" aria-label="Close article editor" onClick={onClose} disabled={saving}>×</button></div>
        <div className="admin-dialog-body">
          {error && <p className="support-editor-error" role="alert">{error}</p>}
          <Field label="Category" htmlFor="help-article-category">
            <Dropdown
              id="help-article-category"
              className="input-control"
              aria-label="Article category"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              {categories.map((category: any) => (
                <option key={category.id} value={category.id}>
                  {category.title}
                </option>
              ))}
            </Dropdown>
          </Field>

          <Field label="Question">
            <input
              className="input-control"
              value={form.question}
              placeholder="How do I reset my password?"
              onChange={(e) => setForm({ ...form, question: e.target.value })}
            />
          </Field>

          <Field label="URL slug" hint={article ? 'Changing this breaks existing links to the article.' : 'Left blank, one is generated from the question.'}>
            <input
              className="input-control"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </Field>

          <Field label="Summary" hint="Shown in search results in place of an extract.">
            <input
              className="input-control"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
          </Field>

          <Field label="Answer" hint="Basic HTML is allowed - p, ul, ol, li, strong, em, a, h2-h4. Anything else is stripped on save.">
            <textarea
              className="input-control"
              rows={9}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </Field>

          <Field
            label="Search keywords"
            hint="Comma-separated. Words users would type that the answer itself does not contain."
          >
            <input
              className="input-control"
              value={form.keywords}
              placeholder="cant login, locked out, password"
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
            />
          </Field>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', margin: '0.5rem 0' }}>
            <input
              type="checkbox"
              checked={form.isFeatured}
              onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
            />
            Feature in the FAQ list at the top of the public page
          </label>

          {previewError && <p className="support-editor-error" role="alert">{previewError}</p>}
          {preview && (
            <div style={{ ...previewBox, marginBottom: '0.75rem' }}>
              <div style={previewHeader}>Preview - exactly what will be published</div>
              {preview.wasModified && (
                <div style={{ ...bannerStyle('warn'), marginBottom: '0.5rem' }}>
                  <AlertTriangle size={13} />
                  <span>Some markup was removed. The version below is what will be saved.</span>
                </div>
              )}
              {/* Server-sanitized output rendered back - not the raw textarea. */}
              <div style={previewBody} dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          )}
        </div>
        <div style={modalActions} className="modal-actions">
          <button className="btn-secondary" onClick={runPreview} disabled={!form.body.trim() || previewing}>
            {previewing ? <Loader2 size={13} className="spin" /> : <Eye size={13} />}
            <span>Preview</span>
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!form.question.trim() || !form.body.trim() || !form.categoryId || saving}
            onClick={() =>
              onSave({
                categoryId: form.categoryId,
                question: form.question.trim(),
                slug: form.slug.trim() || undefined,
                summary: form.summary.trim(),
                body: form.body,
                keywords: form.keywords
                  .split(',')
                  .map((k: string) => k.trim())
                  .filter(Boolean),
                isFeatured: form.isFeatured,
              })
            }
          >
            {saving && <Loader2 size={14} className="spin" />}
            <span>{saving ? 'Saving…' : 'Save'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; hint?: string; htmlFor?: string; children: React.ReactNode }> = ({ label, hint, htmlFor, children }) => {
  const Wrapper = htmlFor ? 'div' : 'label';
  const labelStyle = { fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-main)' };
  return (
    <Wrapper style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.75rem' }}>
      {htmlFor ? <label htmlFor={htmlFor} style={labelStyle}>{label}</label> : <span style={labelStyle}>{label}</span>}
      {children}
      {hint && <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>{hint}</span>}
    </Wrapper>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────

const searchIcon: React.CSSProperties = {
  position: 'absolute',
  left: '0.6rem',
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--color-text-dim)',
  pointerEvents: 'none',
};


const modalActions: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.5rem',
};

const previewBox: React.CSSProperties = {
  padding: '0.75rem 0.9rem',
  background: 'var(--color-bg-soft)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
};

const previewHeader: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--color-text-light)',
  marginBottom: '0.5rem',
};

const previewBody: React.CSSProperties = { fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--color-text-main)' };

function bannerStyle(tone: 'error' | 'ok' | 'warn'): React.CSSProperties {
  const palette = {
    error: { color: 'var(--color-danger)', background: 'var(--color-danger-tint, rgba(220,38,38,0.06))' },
    ok: { color: 'var(--color-success)', background: 'var(--color-success-tint, rgba(22,163,74,0.06))' },
    warn: { color: 'var(--color-warning, #b45309)', background: 'var(--color-warning-tint, rgba(245,158,11,0.08))' },
  }[tone];

  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.6rem 0.85rem',
    fontSize: '0.8rem',
    borderRadius: 'var(--radius-sm)',
    ...palette,
  };
}
