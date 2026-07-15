import { useState, useEffect, useRef } from 'react';

export function useMatchTimer(initialDuration, onExpire) {
  const [timeLeft, setTimeLeft] = useState(initialDuration);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    setTimeLeft(initialDuration);
  }, [initialDuration]);

  useEffect(() => {
    if (timeLeft <= 0) {
      if (onExpireRef.current) {
        onExpireRef.current();
      }
      return;
    }

    const timerId = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerId);
  }, [timeLeft]);

  return {
    timeLeft,
    progress: initialDuration > 0 ? (timeLeft / initialDuration) * 100 : 0
  };
}
