import { useState, useEffect, useRef } from 'react';

export default function WelcomeGreeting({ visible, username, onComplete }) {
  const [text, setText] = useState('');
  const [fadingOut, setFadingOut] = useState(false);
  const idx = useRef(0);
  const fullText = `hey, ${username} 👋`;

  useEffect(() => {
    if (!visible) {
      setFadingOut(false);
      return;
    }
    idx.current = 0;
    setText('');
    setFadingOut(false);

    const startTimer = setTimeout(() => {
      const interval = setInterval(() => {
        if (idx.current < fullText.length) {
          setText(fullText.slice(0, idx.current + 1));
          idx.current++;
        } else {
          clearInterval(interval);
          setTimeout(() => {
            setFadingOut(true);
            setTimeout(onComplete, 600);
          }, 1000);
        }
      }, 60);
      return () => clearInterval(interval);
    }, 400);

    return () => clearTimeout(startTimer);
  }, [visible, username, onComplete, fullText]);

  return (
    <div className={`welcome-greeting${visible ? ' visible' : ''}${fadingOut ? ' fading-out' : ''}`}>
      <div className="greeting-content">
        <h1>
          <span className="typewriter">{text}</span>
          <span className="cursor" />
        </h1>
      </div>
    </div>
  );
}
