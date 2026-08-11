import MessagesLayout from '../components/layout/MessagesLayout';
import { useKeyboardInset } from '@shared/hooks/useKeyboardInset';

export default function MessagesRoute() {
  // Keep the chat input above the soft keyboard on mobile (see hook docs).
  useKeyboardInset();

  return (
    <main className="centre centre-wide centre--messages animate-in">
      <MessagesLayout />
    </main>
  );
}
