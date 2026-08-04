import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

import ShareModalAvatar from '@shared/components/avatar/ShareModalAvatar';
import styles from '@features/crew/components/modals/ShareActivityModal.module.css';
import { useData } from '@shared/hooks/useData';

export default function SharePostModal({ isOpen, onClose, post, author }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);
  const [sentTo, setSentTo] = useState(new Set());
  const [sendingTo, setSendingTo] = useState(new Set());
  
  const { conversations, sendDirectMessage } = useData();

  const handleCopyLink = () => {
    const link = `${window.location.origin}/post/${post?.id}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSend = async (convId) => {
    if (sendingTo.has(convId) || sentTo.has(convId)) return;
    setSendingTo(prev => new Set(prev).add(convId));

    try {
      // Extract media items array and primary image
      let mediaList = [];
      if (Array.isArray(post?.media) && post.media.length > 0) {
        mediaList = post.media.map(m => {
          if (typeof m === 'string') return { url: m, type: 'image' };
          const url = m.url || (m.objectKey ? `/api/media/${m.objectKey}` : null);
          return { ...m, url };
        }).filter(m => m.url);
      } else if (Array.isArray(post?.images) && post.images.length > 0) {
        mediaList = post.images.map(img => ({ url: typeof img === 'string' ? img : (img.url || (img.objectKey ? `/api/media/${img.objectKey}` : null)), type: 'image' })).filter(m => m.url);
      } else if (post?.mediaUrl) {
        mediaList = [{ url: post.mediaUrl, type: post.mediaType || 'image' }];
      } else if (post?.image) {
        mediaList = [{ url: typeof post.image === 'string' ? post.image : (post.image.url || (post.image.objectKey ? `/api/media/${post.image.objectKey}` : null)), type: 'image' }].filter(m => m.url);
      }

      const primaryImage = mediaList.length > 0 ? mediaList[0].url : null;

      // Extract poll data reliably
      let pollData = post?.poll || null;
      if (!pollData && Array.isArray(post?.pollOptions) && post.pollOptions.length > 0) {
        const getOptText = (o) => {
          if (!o) return '';
          if (typeof o === 'string') return o;
          if (typeof o === 'number') return String(o);
          if (typeof o === 'object') {
            if (typeof o.text === 'string') return o.text;
            if (typeof o.label === 'string') return o.label;
            if (typeof o.title === 'string') return o.title;
            if (typeof o.question === 'string') return o.question;
            if (o.text && typeof o.text === 'object') return getOptText(o.text);
            if (o.label && typeof o.label === 'object') return getOptText(o.label);
            if (o.title && typeof o.title === 'object') return getOptText(o.title);
          }
          return '';
        };
        const getOptVotes = (o) => {
          if (!o || typeof o !== 'object') return 0;
          const count = o.voteCount !== undefined ? o.voteCount : (o.votes !== undefined ? o.votes : (o._count?.votes || 0));
          return Number(count) || 0;
        };
        const options = post.pollOptions.map(opt => ({
          id: typeof opt === 'object' ? opt?.id : undefined,
          text: getOptText(opt),
          votes: getOptVotes(opt)
        }));
        pollData = {
          question: post?.text || 'Poll',
          options,
          totalVotes: options.reduce((acc, o) => acc + o.votes, 0)
        };
      }

      await sendDirectMessage(convId, { 
        text: '',
        inviteData: { 
          type: 'postShare', 
          post: { 
            id: post?.id, 
            text: post?.text || '', 
            authorName: author?.displayName || author?.username || post?.authorName || 'Someone',
            authorUsername: author?.username || post?.authorUsername || post?.username || null,
            authorAvatar: author?.avatar || post?.authorAvatar || null,
            time: post?.time || null,
            createdAt: post?.createdAt || null,
            media: mediaList,
            image: primaryImage,
            mediaUrl: primaryImage,
            poll: pollData ? {
              ...pollData,
              question: typeof pollData.question === 'string' ? pollData.question : (typeof pollData.question === 'object' ? getOptText(pollData.question) : String(pollData.question || 'Poll')),
              options: (pollData.options || []).map(opt => ({
                id: typeof opt === 'object' ? opt?.id : undefined,
                text: typeof opt === 'object' ? (typeof opt.text === 'string' ? opt.text : getOptText(opt)) : String(opt || ''),
                votes: typeof opt === 'object' ? (Number(opt.votes ?? opt.voteCount ?? 0) || 0) : 0,
              })),
            } : null,
            pollQuestion: typeof (pollData?.question || post?.pollQuestion) === 'string' ? (pollData?.question || post?.pollQuestion) : null,
            pollOptions: (pollData?.options || post?.pollOptions || []).map(opt => ({
              id: typeof opt === 'object' ? opt?.id : undefined,
              text: typeof opt === 'object' ? (typeof opt.text === 'string' ? opt.text : getOptText(opt)) : String(opt || ''),
              votes: typeof opt === 'object' ? (Number(opt.votes ?? opt.voteCount ?? 0) || 0) : 0,
            }))
          } 
        }
      });
      setSentTo(prev => new Set(prev).add(convId));
    } catch (err) {
      console.error('Failed to share post:', err);
    } finally {
      setSendingTo(prev => {
        const next = new Set(prev);
        next.delete(convId);
        return next;
      });
    }
  };

  // Filter conversations
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    
    const sorted = [...conversations].sort((a, b) => {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (!searchTerm.trim()) return sorted;
    
    const lowerSearch = searchTerm.toLowerCase();
    return sorted.filter(c => c.name?.toLowerCase().includes(lowerSearch));
  }, [conversations, searchTerm]);

  if (!isOpen) return null;

  return createPortal(
    <div className={styles.overlay} style={{ zIndex: 20000 }} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClose(); }}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Share Post</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className={styles.searchContainer}>
          <svg className={styles.searchIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            placeholder="Search connections or groups..."
            className={styles.searchInput}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className={styles.list}>
          {filteredConversations.length > 0 ? (
            filteredConversations.map(conv => {
              const isSent = sentTo.has(conv.id);
              const isSending = sendingTo.has(conv.id);
              return (
                <div key={conv.id} className={styles.listItem}>
                  <div className={styles.contactInfo}>
                    <ShareModalAvatar conv={conv} size="48px" />
                    <span className={styles.contactName}>{conv.name}</span>
                  </div>
                  <button 
                    className={styles.sendBtn}
                    onClick={() => handleSend(conv.id)}
                    disabled={isSent || isSending}
                  >
                    {isSent ? 'Sent' : (isSending ? 'Sending...' : 'Send')}
                  </button>
                </div>
              );
            })
          ) : (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-light)' }}>
              No chats found.
            </div>
          )}
        </div>

        <button className={styles.copyLinkBtn} onClick={handleCopyLink}>
          {copied ? (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              Copy Link
            </>
          )}
        </button>
      </div>
    </div>,
    document.body
  );
}
