import Avatar from '@shared/components/avatar/Avatar';

export default function ShareModalAvatar({ conv, size = '48px' }) {
  if (!conv) return null;

  const isGroup = !!(
    conv.isGroup ||
    conv.type === 'GROUP' ||
    (typeof conv.id === 'string' && conv.id.startsWith('c_')) ||
    conv.isCampusGroup
  );

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
    </div>
  );
}
