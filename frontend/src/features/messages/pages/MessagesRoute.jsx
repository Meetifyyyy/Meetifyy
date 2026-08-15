import { useParams } from 'react-router-dom';
import MessagesLayout from '../components/layout/MessagesLayout';
import { useKeyboardInset } from '@shared/hooks/useKeyboardInset';

export default function MessagesRoute() {
  // Keep the chat input above the soft keyboard on mobile (see hook docs).
  useKeyboardInset();
  const { param1, param2 } = useParams();
  const isChatOpen = !!(param1 || param2);

  return (
    <main className={`centre centre-wide centre--messages animate-in ${isChatOpen ? 'chat-is-open' : ''}`}>
      <MessagesLayout />
    </main>
  );
}
