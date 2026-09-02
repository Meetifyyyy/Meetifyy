import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StaticDocLayout from '../pages/StaticDocLayout';
import styles from './HelpSupport.module.css';
import FaqAccordion from './FaqAccordion';
import SupportRequestForm from './SupportRequestForm';
import { supportApi } from '@shared/api/apiClient';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CalendarDays,
  FileText,
  Lock,
  MessageCircle,
  RefreshCw,
  Search,
  Settings,
  Shield,
  User,
  Users,
  X,
} from '@shared/components/icons';

/**
 * Category icons.
 *
 * The `icon` column holds a name, not markup, and this map is the allow-list
 * that turns it into a component. An unknown value falls back rather than
 * rendering anything the database happened to contain: help content is editable
 * by admins, so it must not be able to reach the render tree as anything but
 * text.
 */
const CATEGORY_ICONS = {
  KeyRound: Lock,
  UserCog: User,
  MessageCircle,
  Users,
  FileText,
  CalendarDays,
  Bell,
  ShieldCheck: Shield,
  Wrench: Settings,
};

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const QUICK_LINK_COUNT = 5;

export default function HelpSupportPage() {
  const [content, setContent] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ state: 'idle', results: [], query: '' });

  const [formOpen, setFormOpen] = useState(false);
  const [presetCategory, setPresetCategory] = useState(null);
  const [openArticleId, setOpenArticleId] = useState(null);

  const formSectionRef = useRef(null);
  const searchInputRef = useRef(null);
  // Only the newest load may write state, so a superseded request cannot land
  // after a newer one and overwrite it.
  const loadIdRef = useRef(0);

  // ── Page metadata ────────────────────────────────────────────────────────
  // Owned centrally by shared/seo/usePageMetadata, driven by the route table in
  // config/seo.js. This page used to set document.title and the description
  // itself, which became a race the moment metadata was centralised: two
  // effects wrote the same two nodes on every navigation and the winner was
  // whichever ran last. Worse, this one snapshotted the PREVIOUS title on mount
  // and restored it on unmount, so leaving the page could put the help title's
  // predecessor back over whatever the next route had just set.
  //
  // The prerendered /help-and-support.html document carries the same title and
  // description, so a crawler that never runs this component still gets them.

  // ── Initial load ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const id = ++loadIdRef.current;
    setLoadState('loading');

    try {
      // Both are public and independent; requesting them together avoids a
      // render pass where the form exists but has no categories to offer.
      const [helpCentre, formMeta] = await Promise.all([supportApi.getHelpCentre(), supportApi.getFormMeta()]);
      if (id !== loadIdRef.current) return;
      setContent(helpCentre);
      setMeta(formMeta);
      setLoadState('ready');
    } catch {
      // A superseded load is ignored, but the newest one always reaches a
      // terminal state. An earlier version returned early on an aborted
      // request without setting anything, which left the page showing its
      // loading skeleton indefinitely whenever that was the last attempt.
      if (id !== loadIdRef.current) return;
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Search ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSearch({ state: 'idle', results: [], query: '' });
      return undefined;
    }

    setSearch((prev) => ({ ...prev, state: 'searching' }));

    // Debounced and abortable: without the abort, a slow response for "acc"
    // can land after the response for "account" and replace newer results.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      supportApi
        .searchHelp(trimmed, { signal: controller.signal })
        .then((response) => setSearch({ state: 'done', results: response.results, query: response.query }))
        .catch((error) => {
          if (error.name === 'AbortError') return;
          setSearch({ state: 'error', results: [], query: trimmed });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const searching = search.state === 'searching';
  const isSearchActive = query.trim().length >= MIN_QUERY_LENGTH;

  const categories = content?.categories ?? [];
  const featured = content?.featured ?? [];

  /** The sentence read out by the live region below the field. */
  const searchAnnouncement = useMemo(() => {
    if (!isSearchActive) return '';
    if (searching) return 'Searching help articles';
    if (search.state === 'error') return 'Search is unavailable right now.';
    if (search.results.length === 0) return `No help articles match "${search.query}".`;
    // Verb agrees with the count: "1 help article matches", "3 help articles match".
    const one = search.results.length === 1;
    return `${search.results.length} help article${one ? '' : 's'} ${one ? 'matches' : 'match'} "${search.query}".`;
  }, [isSearchActive, searching, search]);

  /**
   * Maps a help category to the form category it corresponds to.
   *
   * Matched against the values the server actually offers rather than derived
   * by transforming a slug into an enum name: help categories are admin
   * editable and one can be added that has no form counterpart. With no match
   * the field is simply left for the user, which is the right outcome.
   */
  const formCategoryForSlug = useMemo(() => {
    const offered = new Set((meta?.categories ?? []).map((option) => option.value));
    const map = {};
    for (const category of categories) {
      const candidate = category.slug.toUpperCase().replace(/-/g, '_');
      if (offered.has(candidate)) map[category.slug] = candidate;
    }
    return map;
  }, [meta, categories]);

  const openForm = (categoryValue) => {
    if (categoryValue) setPresetCategory(categoryValue);
    setFormOpen(true);
    // Deferred a frame so the panel exists before it is scrolled to.
    requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const goToCategory = (category) => {
    // Pre-selecting the matching form category means a user who reads the
    // articles and still needs help does not restate the topic they chose.
    const formCategory = formCategoryForSlug[category.slug];
    if (formCategory) setPresetCategory(formCategory);
    document
      .getElementById(`help-category-${category.slug}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const goToArticle = (article) => {
    if (query) setQuery('');

    const formCategory = formCategoryForSlug[article.categorySlug];
    if (formCategory) setPresetCategory(formCategory);

    setOpenArticleId(article.id);

    requestAnimationFrame(() => {
      setTimeout(() => {
        const articleEl =
          document.getElementById(`help-article-${article.id}`) ||
          document.getElementById(`help-article-${article.slug}`);
        if (articleEl) {
          articleEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          const triggerBtn = articleEl.querySelector('button');
          triggerBtn?.focus({ preventScroll: true });
        } else if (article.categorySlug) {
          document
            .getElementById(`help-category-${article.categorySlug}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    });
  };

  const showBrowse = loadState === 'ready' && !isSearchActive;

  return (
    <StaticDocLayout
      badge="Help Centre"
      title="Help & Support"
      subtitle="Search our answers to the questions we get asked most, or send the team a message. You do not need an account to reach us."
      noHeroCard
      leftAlign
    >
      {/* ── Search ───────────────────────────────────────────────────────── */}
      <section className={styles.searchSection} aria-labelledby="help-search-label">
        <label className={styles.srOnly} htmlFor="help-search" id="help-search-label">
          Search for help
        </label>
        <div className={styles.searchWrap}>
          <Search size={18} aria-hidden="true" className={styles.searchIcon} />
          <input
            ref={searchInputRef}
            id="help-search"
            type="search"
            className={styles.searchInput}
            placeholder="Search for help..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            aria-describedby="help-search-status"
          />
          {query && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => {
                setQuery('');
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        {/*
          Polite rather than assertive: results update on every keystroke, and
          an assertive region would interrupt the user mid-word each time.
        */}
        <p className={styles.searchStatus} id="help-search-status" role="status" aria-live="polite">
          {searchAnnouncement}
        </p>
      </section>

      {/* ── Search results ───────────────────────────────────────────────── */}

      {isSearchActive && search.state === 'done' && search.results.length > 0 && (
        <section className={styles.section} aria-label="Search results">
          <FaqAccordion
            articles={search.results}
            headingLevel="h2"
            openArticleId={openArticleId}
            onToggleArticle={setOpenArticleId}
          />
        </section>
      )}

      {isSearchActive && search.state === 'done' && search.results.length === 0 && (
        <section className={styles.section}>
          <div className={styles.stateBox}>
            <Search size={22} aria-hidden="true" className={styles.stateIcon} />
            <p className={styles.stateTitle}>No results for "{search.query}"</p>
            <p className={styles.stateText}>
              Try a different word, browse the topics below, or send us a message and we will answer directly.
            </p>
            <button
              type="button"
              className={`${styles.primaryBtn} ${styles.stateAction}`}
              onClick={() => openForm(null)}
            >
              Create a support request
            </button>
          </div>
        </section>
      )}

      {isSearchActive && search.state === 'error' && (
        <section className={styles.section}>
          <div className={styles.stateBox}>
            <AlertCircle size={22} aria-hidden="true" className={styles.stateIcon} />
            <p className={styles.stateTitle}>Search is not working right now</p>
            <p className={styles.stateText}>You can still browse the topics below or send us a message.</p>
          </div>
        </section>
      )}

      {/* ── Loading and error ────────────────────────────────────────────── */}

      {loadState === 'loading' && (
        <section className={styles.section} aria-busy="true" aria-label="Loading help content">
          <div className={styles.faqList}>
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className={styles.skeleton} />
            ))}
          </div>
        </section>
      )}

      {loadState === 'error' && (
        <section className={styles.section}>
          <div className={styles.stateBox}>
            <AlertCircle size={22} aria-hidden="true" className={styles.stateIcon} />
            <p className={styles.stateTitle}>We could not load the help articles</p>
            <p className={styles.stateText}>
              This is usually a connection problem. You can still send us a message below, which works independently.
            </p>
            <button type="button" className={`${styles.ghostBtn} ${styles.stateAction}`} onClick={load}>
              <RefreshCw size={15} aria-hidden="true" />
              Try again
            </button>
          </div>
        </section>
      )}

      {/* ── Popular questions ────────────────────────────────────────────── */}

      {showBrowse && featured.length > 0 && (
        <section className={styles.section} aria-labelledby="help-popular-heading">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle} id="help-popular-heading">
              Popular questions
            </h2>
          </div>
          <div className={styles.quickLinks}>
            {featured.slice(0, QUICK_LINK_COUNT).map((article) => (
              <button
                key={article.id}
                type="button"
                className={styles.quickLink}
                onClick={() => goToArticle(article)}
              >
                <span>{article.question}</span>
                <ArrowRight size={13} aria-hidden="true" className={styles.quickLinkIcon} />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Categories ───────────────────────────────────────────────────── */}

      {showBrowse && categories.length > 0 && (
        <section className={styles.section} aria-labelledby="help-categories-heading">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle} id="help-categories-heading">
              Browse by topic
            </h2>
            <p className={styles.sectionIntro}>
              Pick the area your question is about. Choosing a topic also fills it in on the support form.
            </p>
          </div>

          <div className={styles.categoryGrid}>
            {categories.map((category) => {
              const Icon = CATEGORY_ICONS[category.icon] ?? FileText;
              return (
                <button
                  type="button"
                  key={category.id}
                  className={styles.categoryCard}
                  onClick={() => goToCategory(category)}
                >
                  <span className={styles.categoryIcon} aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <span className={styles.categoryText}>
                    <span className={styles.categoryTitle}>{category.title}</span>
                    <span className={styles.categoryCount}>
                      {category.articles.length} article{category.articles.length === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Articles by category ─────────────────────────────────────────── */}

      {showBrowse &&
        categories.map((category) => (
          <section
            key={category.id}
            id={`help-category-${category.slug}`}
            className={styles.section}
            aria-labelledby={`help-category-heading-${category.slug}`}
            style={{ scrollMarginTop: '6rem' }}
          >
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle} id={`help-category-heading-${category.slug}`}>
                {category.title}
              </h2>
              {category.description && <p className={styles.sectionIntro}>{category.description}</p>}
            </div>
            <FaqAccordion
              articles={category.articles}
              headingLevel="h3"
              openArticleId={openArticleId}
              onToggleArticle={setOpenArticleId}
            />
          </section>
        ))}

      {showBrowse && categories.length === 0 && (
        <section className={styles.section}>
          <div className={styles.stateBox}>
            <FileText size={22} aria-hidden="true" className={styles.stateIcon} />
            <p className={styles.stateTitle}>No help articles yet</p>
            <p className={styles.stateText}>
              We are still writing them. Send us a message in the meantime and we will answer you directly.
            </p>
          </div>
        </section>
      )}

      {/* ── Support request ──────────────────────────────────────────────── */}

      <section
        ref={formSectionRef}
        id="support-request"
        className={styles.section}
        aria-labelledby="help-contact-heading"
        style={{ scrollMarginTop: '6rem' }}
      >
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="help-contact-heading">
            Still need help?
          </h2>
        </div>

        {/*
          The form is revealed rather than always shown. Six fields plus a file
          upload sitting permanently under every article would bury the content
          people came for, and a modal would be cramped on a phone for a form
          this size. The CTA keeps the page a readable document and gives the
          form its own full-width space when it is actually wanted.
        */}
        {formOpen ? (
          <SupportRequestForm meta={meta} presetCategory={presetCategory} onClose={() => setFormOpen(false)} />
        ) : (
          <div className={styles.ctaCard}>
            <div>
              <p className={styles.ctaTitle}>Create a support request</p>
              <p className={styles.ctaText}>
                Tell us what is going on and we will reply by email. You will get a Request ID straight away, and you
                do not need to be signed in.
              </p>
            </div>
            <button type="button" className={styles.ctaButton} onClick={() => openForm(null)}>
              Contact support
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </section>
    </StaticDocLayout>
  );
}
