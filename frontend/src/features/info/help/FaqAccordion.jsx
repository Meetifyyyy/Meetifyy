import { useId, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from '@shared/components/icons';
import styles from './HelpSupport.module.css';

/**
 * One expandable help article.
 *
 * Smooth height and opacity animation powered by framer-motion AnimatePresence.
 * Accessible with real button heading triggers, aria-expanded, and aria-controls.
 */
function FaqItem({ article, isOpen, onToggle, headingLevel = 'h3' }) {
  const panelId = useId();
  const triggerId = useId();
  const Heading = headingLevel;

  return (
    <div className={`${styles.faqItem} ${isOpen ? styles.faqItemOpen : ''}`}>
      <Heading style={{ margin: 0 }}>
        <button
          type="button"
          id={triggerId}
          className={styles.faqTrigger}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span>{article.question}</span>
          <ChevronDown
            size={17}
            aria-hidden="true"
            className={`${styles.faqChevron} ${isOpen ? styles.faqChevronOpen : ''}`}
          />
        </button>
      </Heading>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={triggerId}
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: {
                height: { duration: 0.28, ease: [0.04, 0.62, 0.23, 0.98] },
                opacity: { duration: 0.2, delay: 0.05, ease: 'easeOut' },
              },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: {
                height: { duration: 0.24, ease: [0.04, 0.62, 0.23, 0.98] },
                opacity: { duration: 0.15, ease: 'easeIn' },
              },
            }}
            style={{ overflow: 'hidden' }}
          >
            <div>
              <div className={styles.faqBody}>
                {article.body ? (
                  <div dangerouslySetInnerHTML={{ __html: article.body }} />
                ) : (
                  <p>{article.excerpt}</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FaqAccordion({
  articles,
  headingLevel = 'h3',
  openArticleId,
  onToggleArticle,
}) {
  const [internalOpenId, setInternalOpenId] = useState(null);

  if (!articles?.length) return null;

  const isControlled = openArticleId !== undefined;
  const currentOpenId = isControlled ? openArticleId : internalOpenId;

  const handleToggle = (id) => {
    if (isControlled) {
      onToggleArticle?.(currentOpenId === id ? null : id);
    } else {
      setInternalOpenId((prev) => (prev === id ? null : id));
    }
  };

  return (
    <div className={styles.faqList}>
      {articles.map((article) => (
        <FaqItem
          key={article.id}
          article={article}
          headingLevel={headingLevel}
          isOpen={currentOpenId === article.id}
          onToggle={() => handleToggle(article.id)}
        />
      ))}
    </div>
  );
}
