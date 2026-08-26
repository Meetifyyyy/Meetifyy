import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from '@shared/components/icons';
import styles from './HelpSupport.module.css';

/**
 * One expandable help article.
 *
 * The trigger is a real button inside a heading, which gives keyboard and
 * screen-reader users the expected behaviour for free: Enter or Space to
 * toggle, and the title announced as a heading when navigating by headings.
 * `aria-expanded` and `aria-controls` tie it to the panel.
 *
 * The open/closed animation runs on an explicit pixel height rather than the
 * `grid-template-rows: 0fr -> 1fr` trick. The grid version depends on an `fr`
 * track resolving to its content size in an auto-height container, which is a
 * subtler contract than it looks and gives no fallback if it ever fails to
 * hold: the panel reports itself expanded while the answer stays clipped to
 * nothing. A measured height is the plainer mechanism and degrades visibly
 * rather than silently.
 *
 * The height is measured from the content at the moment the panel opens, and a
 * ResizeObserver keeps it correct for as long as it stays open.
 */
function FaqItem({ article, headingLevel = 'h3' }) {
  const [open, setOpen] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const innerRef = useRef(null);
  const panelId = useId();
  const triggerId = useId();
  const Heading = headingLevel;

  // Measured at the moment of opening, which is the only point the value is
  // definitely needed and definitely correct.
  const toggle = () => {
    setContentHeight(innerRef.current?.scrollHeight ?? 0);
    setOpen((v) => !v);
  };

  // While a panel is open its content can still change height: a long answer
  // rewrapping on rotation, or a webfont finishing loading. Without this the
  // panel would keep the height it had at the moment it was opened and clip
  // the extra lines.
  useEffect(() => {
    const element = innerRef.current;
    if (!open || !element || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(([entry]) => setContentHeight(entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  return (
    <div className={`${styles.faqItem} ${open ? styles.faqItemOpen : ''}`}>
      <Heading style={{ margin: 0 }}>
        <button
          type="button"
          id={triggerId}
          className={styles.faqTrigger}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          <span>{article.question}</span>
          <ChevronDown
            size={17}
            aria-hidden="true"
            className={`${styles.faqChevron} ${open ? styles.faqChevronOpen : ''}`}
          />
        </button>
      </Heading>

      {/*
        The collapse is driven entirely from inline styles rather than from a
        state class. Height, overflow and visibility are the mechanism that
        makes the panel work at all, so they are kept next to the state that
        drives them instead of depending on which rule wins the cascade.
      */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        style={{
          height: open ? contentHeight : 0,
          overflow: 'hidden',
          // Collapsed content leaves the tab order and the accessibility tree
          // rather than merely being clipped, so Tab cannot land on a link
          // inside an answer nobody can see. The delay holds it visible until
          // the collapse finishes, so the text does not blink out early.
          visibility: open ? 'visible' : 'hidden',
          transition: `height 0.26s ease, visibility 0s linear ${open ? '0s' : '0.26s'}`,
        }}
      >
        <div ref={innerRef}>
          <div className={styles.faqBody}>
            {article.body ? (
              /*
                The body is rich text written by an admin and sanitized
                server-side on save (see sanitizeArticleHtml), so the stored
                value is already the clean one and there is no unsanitized copy
                for this render to expose.
              */
              <div dangerouslySetInnerHTML={{ __html: article.body }} />
            ) : (
              /*
                Search results carry a plain-text excerpt rather than the full
                body. Rendered as a text node, so it stays text whatever the
                extract happens to contain.
              */
              <p>{article.excerpt}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FaqAccordion({ articles, headingLevel }) {
  if (!articles?.length) return null;

  return (
    <div className={styles.faqList}>
      {articles.map((article) => (
        <FaqItem key={article.id} article={article} headingLevel={headingLevel} />
      ))}
    </div>
  );
}
