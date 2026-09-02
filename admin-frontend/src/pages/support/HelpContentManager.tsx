import React, { useState } from 'react';
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
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [banner, setBanner] = useState<{ tone: 'error' | 'ok' | 'warn'; text: string } | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['adminHelpCategories'],
    queryFn: () => helpApi.listCategories(),
  });

  const articlesQuery = useQuery({
    queryKey: ['adminHelpArticles', { search, statusFilter, categoryFilter }],
    queryFn: () => helpApi.listArticles({ search, status: statusFilter, categoryId: categoryFilter }),
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
        ),
    });

  const run = async (fn: () => Promise<any>, okText: string) => {
    setBanner(null);
    try {
      const result = await fn();
      refresh();
      // Some endpoints answer with an advisory rather than a plain success -
      // publishing an article whose category is still a draft, for instance.
      setBanner(result?.warning ? { tone: 'warn', text: result.warning } : { tone: 'ok', text: okText });
    } catch (e: any) {
      setBanner({ tone: 'error', text: e?.message || 'That change could not be saved.' });
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {banner && (
        <div style={bannerStyle(banner.tone)} role="status">
          {banner.tone === 'error' ? <AlertTriangle size={15} /> : banner.tone === 'warn' ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
          <span style={{ flex: 1 }}>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} style={iconButton} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Categories ───────────────────────────────────────────────────── */}
      <section className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={sectionHeader}>
          <div>
            <h3 style={sectionTitle}>Help categories</h3>
            <p style={sectionSubtitle}>Order here is the order on the public page.</p>
          </div>
          <button className="btn-primary" onClick={() => setEditing({ kind: 'category', value: null })}>
            <Plus size={14} />
            <span>New category</span>
          </button>
        </div>

        {categoriesQuery.isLoading ? (
          <div style={centered}>
            <Loader2 size={16} className="spin" />
            <span>Loading categories…</span>
          </div>
        ) : categoriesQuery.isError ? (
          <div style={centered}>
            <AlertTriangle size={18} color="var(--color-danger)" />
            <span>Categories could not be loaded.</span>
            <button className="btn-secondary" onClick={() => categoriesQuery.refetch()}>
              <RefreshCw size={13} />
              <span>Try again</span>
            </button>
          </div>
        ) : categories.length === 0 ? (
          <div style={centered}>
            <FileText size={18} />
            <span>No categories yet. Create one to start building the help centre.</span>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: '4.5rem' }}>Order</th>
                  <th>Category</th>
                  <th>Articles</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category: any, index: number) => (
                  <tr key={category.id}>
                    <td>
                      <div style={{ display: 'flex', gap: '0.15rem' }}>
                        <button
                          style={iconButton}
                          disabled={index === 0}
                          onClick={() => move(categories, index, -1, 'category')}
                          aria-label={`Move ${category.title} up`}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          style={iconButton}
                          disabled={index === categories.length - 1}
                          onClick={() => move(categories, index, 1, 'category')}
                          aria-label={`Move ${category.title} down`}
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{category.title}</div>
                      <div style={mutedSmall}>/{category.slug}</div>
                    </td>
                    <td style={mutedSmall}>
                      {category.publishedArticleCount} published
                      {category.articleCount !== category.publishedArticleCount
                        ? ` · ${category.articleCount - category.publishedArticleCount} draft/archived`
                        : ''}
                    </td>
                    <td>
                      <span className={`badge ${HELP_STATUS_BADGE[category.status]}`}>
                        {HELP_STATUS_LABELS[category.status]}
                      </span>
                    </td>
                    <td>
                      <div style={actionCell}>
                        <button
                          className="btn-secondary"
                          style={smallButton}
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
                          className="btn-secondary"
                          style={smallButton}
                          onClick={() => setEditing({ kind: 'category', value: category })}
                        >
                          Edit
                        </button>
                        {category.status !== 'ARCHIVED' && (
                          <button
                            className="btn-secondary"
                            style={smallButton}
                            onClick={() =>
                              run(() => helpApi.archiveCategory(category.id), 'Category and its articles archived.')
                            }
                            title="Archive this category and everything in it"
                          >
                            <Archive size={12} />
                          </button>
                        )}
                        <button
                          className="btn-danger"
                          style={smallButton}
                          onClick={() =>
                            confirmDeletion('category', category.id, category.title)
                          }
                          aria-label={`Delete ${category.title}`}
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
      <section className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={sectionHeader}>
          <div>
            <h3 style={sectionTitle}>Help articles</h3>
            <p style={sectionSubtitle}>Featured articles appear in the FAQ list at the top of the public page.</p>
          </div>
          <button
            className="btn-primary"
            disabled={categories.length === 0}
            title={categories.length === 0 ? 'Create a category first' : undefined}
            onClick={() => setEditing({ kind: 'article', value: null })}
          >
            <Plus size={14} />
            <span>New article</span>
          </button>
        </div>

        <div style={filterBar}>
          <div style={{ position: 'relative', flex: '1 1 12rem' }}>
            <Search size={14} style={searchIcon} />
            <input
              className="input-control"
              style={{ paddingLeft: '2rem', fontSize: '0.78rem', width: '100%' }}
              placeholder="Search questions, answers and keywords…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search help articles"
            />
          </div>
          <select
            className="input-control"
            style={filterSelect}
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
          </select>
          <select
            className="input-control"
            style={filterSelect}
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
          </select>
        </div>

        {articlesQuery.isLoading ? (
          <div style={centered}>
            <Loader2 size={16} className="spin" />
            <span>Loading articles…</span>
          </div>
        ) : articlesQuery.isError ? (
          <div style={centered}>
            <AlertTriangle size={18} color="var(--color-danger)" />
            <span>Articles could not be loaded.</span>
            <button className="btn-secondary" onClick={() => articlesQuery.refetch()}>
              <RefreshCw size={13} />
              <span>Try again</span>
            </button>
          </div>
        ) : articles.length === 0 ? (
          <div style={centered}>
            <FileText size={18} />
            <span>{search || statusFilter || categoryFilter ? 'No articles match these filters.' : 'No articles yet.'}</span>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: '4.5rem' }}>Order</th>
                  <th>Question</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((article: any, index: number) => (
                  <tr key={article.id}>
                    <td>
                      <div style={{ display: 'flex', gap: '0.15rem' }}>
                        <button
                          style={iconButton}
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
                          style={iconButton}
                          disabled={!categoryFilter || index === articles.length - 1}
                          title={!categoryFilter ? 'Filter to one category to reorder' : undefined}
                          onClick={() => move(articles, index, 1, 'article')}
                          aria-label={`Move ${article.question} down`}
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}>
                        {article.isFeatured && <Star size={12} fill="currentColor" color="var(--color-warning, #f59e0b)" />}
                        {article.question}
                      </div>
                      <div style={mutedSmall}>/{article.slug}</div>
                    </td>
                    <td style={mutedSmall}>{article.category?.title ?? '-'}</td>
                    <td>
                      <span className={`badge ${HELP_STATUS_BADGE[article.status]}`}>
                        {HELP_STATUS_LABELS[article.status]}
                      </span>
                    </td>
                    <td style={mutedSmall}>{formatDateTime(article.updatedAt)}</td>
                    <td>
                      <div style={actionCell}>
                        <button
                          className="btn-secondary"
                          style={smallButton}
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
                          className="btn-secondary"
                          style={smallButton}
                          onClick={() =>
                            run(
                              () => helpApi.updateArticle(article.id, { isFeatured: !article.isFeatured }),
                              article.isFeatured ? 'Removed from the FAQ list.' : 'Added to the FAQ list.',
                            )
                          }
                          title={article.isFeatured ? 'Remove from FAQ list' : 'Feature in FAQ list'}
                        >
                          <Star size={12} fill={article.isFeatured ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          className="btn-secondary"
                          style={smallButton}
                          onClick={() => setEditing({ kind: 'article', value: article })}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-danger"
                          style={smallButton}
                          onClick={() => confirmDeletion('article', article.id, article.question)}
                          aria-label={`Delete ${article.question}`}
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
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            await run(
              () => saveCategory.mutateAsync({ id: editing.value?.id, payload }),
              editing.value ? 'Category updated.' : 'Category created.',
            );
            setEditing(null);
          }}
        />
      )}

      {editing?.kind === 'article' && (
        <ArticleModal
          article={editing.value}
          categories={categories}
          saving={saveArticle.isPending}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            await run(
              () => saveArticle.mutateAsync({ id: editing.value?.id, payload }),
              editing.value ? 'Article updated.' : 'Article created.',
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
};

// ── Modals ─────────────────────────────────────────────────────────────────

const CategoryModal: React.FC<{
  category: any | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: HelpCategoryPayload) => void;
}> = ({ category, saving, onClose, onSave }) => {
  const [form, setForm] = useState({
    title: category?.title ?? '',
    slug: category?.slug ?? '',
    description: category?.description ?? '',
    icon: category?.icon ?? '',
  });

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={category ? 'Edit category' : 'New category'}>
      <div className="modal-content" style={{ padding: '1.5rem' }}>
        <h3 style={modalTitle}>{category ? 'Edit category' : 'New category'}</h3>

        <Field label="Title">
          <input
            className="input-control"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            autoFocus
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

        <div style={modalActions}>
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
  onClose: () => void;
  onSave: (payload: HelpArticlePayload) => void;
}> = ({ article, categories, saving, onClose, onSave }) => {
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

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const result = await helpApi.previewArticle(form.body);
      setPreview({ html: result.html, wasModified: result.wasModified });
    } catch {
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={article ? 'Edit article' : 'New article'}>
      <div className="modal-content" style={{ padding: '1.5rem', maxWidth: '640px' }}>
        <h3 style={modalTitle}>{article ? 'Edit article' : 'New article'}</h3>

        <Field label="Category">
          <select
            className="input-control"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            {categories.map((category: any) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </select>
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
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.78rem' }}
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

        <div style={modalActions}>
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

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.75rem' }}>
    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-main)' }}>{label}</span>
    {children}
    {hint && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>{hint}</span>}
  </label>
);

// ── Styles ─────────────────────────────────────────────────────────────────

const sectionHeader: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  padding: '0.85rem 1rem',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg-alt)',
};

const sectionTitle: React.CSSProperties = { margin: 0, fontSize: '0.92rem', fontWeight: 700 };
const sectionSubtitle: React.CSSProperties = {
  margin: '0.15rem 0 0',
  fontSize: '0.75rem',
  color: 'var(--color-text-light)',
};

const filterBar: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.4rem',
  padding: '0.6rem 1rem',
  borderBottom: '1px solid var(--color-border)',
};

const filterSelect: React.CSSProperties = { padding: '0.3rem 0.45rem', fontSize: '0.74rem', flex: '0 1 10rem' };

const searchIcon: React.CSSProperties = {
  position: 'absolute',
  left: '0.6rem',
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--color-text-dim)',
  pointerEvents: 'none',
};

const centered: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '2.25rem 1.25rem',
  textAlign: 'center',
  color: 'var(--color-text-dim)',
  fontSize: '0.8rem',
};

const mutedSmall: React.CSSProperties = { fontSize: '0.72rem', color: 'var(--color-text-light)' };

const actionCell: React.CSSProperties = {
  display: 'flex',
  gap: '0.25rem',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
};

const smallButton: React.CSSProperties = { padding: '0.25rem 0.5rem', fontSize: '0.7rem' };

const iconButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.5rem',
  height: '1.5rem',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-bg-white)',
  color: 'var(--color-text-main)',
  cursor: 'pointer',
};

const modalTitle: React.CSSProperties = { margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700 };

const modalActions: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginTop: '1rem',
  paddingTop: '0.85rem',
  borderTop: '1px solid var(--color-border)',
};

const previewBox: React.CSSProperties = {
  padding: '0.75rem 0.9rem',
  background: 'var(--color-bg-soft)',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-sm)',
};

const previewHeader: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
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
