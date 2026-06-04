import { useState, useEffect, useRef } from 'react';

export default function WelcomeGreeting({ visible, username, onComplete }) {
  const [text, setText] = useState('');
  const idx = useRef(0);
  const fullText = `hey, ${username} 👋`;

  useEffect(() => {
    if (!visible) return;
    idx.current = 0;
    setText('');

    const startTimer = setTimeout(() => {
      const interval = setInterval(() => {
        if (idx.current < fullText.length) {
          setText(fullText.slice(0, idx.current + 1));
          idx.current++;
        } else {
          clearInterval(interval);
          setTimeout(onComplete, 1200);
        }
      }, 60);
      return () => clearInterval(interval);
    }, 400);

    return () => clearTimeout(startTimer);
  }, [visible, username]);

  return (
    <div className={`welcome-greeting${visible ? ' visible' : ''}`}>
      <div className="greeting-content">
        <h1>
          <span className="typewriter">{text}</span>
          <span className="cursor" />
        </h1>
      </div>
    </div>
  );
}
