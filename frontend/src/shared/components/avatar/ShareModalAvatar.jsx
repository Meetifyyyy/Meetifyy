import Avatar from '@shared/components/avatar/Avatar';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { CalendarDays } from 'lucide-react';
import styles from '@features/messages/shared/components/sidebar/ConversationList.module.css';

export default function ShareModalAvatar({ conv, size = '48px' }) {
  if (!conv) return null;

  const isGroup = !!(
    conv.isGroup ||
    conv.type === 'GROUP' ||
    conv.type === 'ACTIVITY' ||
    conv.isActivityChat ||
    (typeof conv.id === 'string' && (conv.id.startsWith('act_') || conv.id.startsWith('c_'))) ||
    conv.isCampusGroup
  );

  const isActivityChat = !!(
    conv.isActivityChat ||
    conv.activityId ||
    (typeof conv.id === 'string' && conv.id.startsWith('act_')) ||
    conv.type === 'ACTIVITY'
  );

  const actStatus = (conv.activity?.status || conv.status || '').toUpperCase();
  const isEnded = actStatus === 'ENDED' || actStatus === 'CLOSED' || actStatus === 'COMPLETED' || actStatus === 'CANCELLED';
  const actDate = conv.startDate || conv.date || conv.activity?.startDate || conv.activity?.date || conv.createdAt;
  const avatarSrc = conv.avatar || conv.icon || conv.coverImage || conv.avatarUrl;

  return (
    <div 
      style={{ 
        position: 'relative', 
        display: 'inline-flex', 
        flexShrink: 0,
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
        '--badge-border': 'var(--color-bg-white, #ffffff)'
      }}
    >
      <Avatar
        src={avatarSrc}
        name={conv.name || conv.title}
        size={size}
        isGroup={isGroup}
      />
      {isActivityChat && (
        isEnded ? (
          <span
            className={styles.activityCalendarBadge}
            title="Activity ended"
          >
            <CalendarDays size={16} strokeWidth={2.2} />
          </span>
        ) : (
          <div
            style={{
              position: 'absolute',
              bottom: '-6px',
              right: '-10px',
              zIndex: 4
            }}
            title="Activity date"
          >
            <CalendarIcon date={actDate} size="badge" />
          </div>
        )
      )}
    </div>
  );
}
