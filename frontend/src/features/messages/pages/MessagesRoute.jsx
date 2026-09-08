import { useParams } from 'react-router-dom';
import MessagesLayout from '../components/layout/MessagesLayout';

import VerificationGate from '@shared/components/VerificationGate/VerificationGate';

export default function MessagesRoute() {
  // The keyboard geometry this layout depends on (`--kb-inset`, used by
  // `.centre--messages` in global.css) is published once by
  // DashboardLayoutWrapper, which is also where the BottomNav that reads it
  // lives. It used to be mounted here, which meant every other screen — the
  // post composer most visibly — got no keyboard handling at all.
  const { param1, param2 } = useParams();
  const isChatOpen = !!(param1 || param2);

  return (
    <main className={`centre centre-wide centre--messages animate-in ${isChatOpen ? 'chat-is-open' : ''}`}>
      <VerificationGate message="Verify your student ID to send and receive messages." fullPage>
        <MessagesLayout />
      </VerificationGate>
    </main>
  );
}
