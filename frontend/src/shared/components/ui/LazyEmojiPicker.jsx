import { lazy, Suspense } from 'react';

const EmojiMartPicker = lazy(async () => {
  const [dataModule, pickerModule] = await Promise.all([
    import('@emoji-mart/data'),
    import('@emoji-mart/react')
  ]);
  const data = dataModule.default;
  const Picker = pickerModule.default;

  return {
    default: (props) => <Picker data={data} {...props} />
  };
});

export default function LazyEmojiPicker(props) {
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark';

  const mergedProps = {
    theme: props.theme || (isDark ? 'dark' : 'light'),
    previewPosition: 'none',
    skinTonePosition: 'search',
    navPosition: 'top',
    perLine: 9,
    maxFrequentRows: 2,
    ...props,
  };

  return (
    <Suspense
      fallback={
        <div
          style={{
            padding: '1.5rem',
            textAlign: 'center',
            fontSize: '0.85rem',
            color: 'var(--color-text-muted)',
            background: 'var(--color-bg-white)',
            borderRadius: 'var(--radius-lg, 14px)',
            border: '1px solid var(--color-border)',
            minWidth: '280px',
          }}
        >
          Loading emojis...
        </div>
      }
    >
      <EmojiMartPicker {...mergedProps} />
    </Suspense>
  );
}

