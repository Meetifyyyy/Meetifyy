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
  return (
    <Suspense fallback={<div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Loading emojis...</div>}>
      <EmojiMartPicker {...props} />
    </Suspense>
  );
}
