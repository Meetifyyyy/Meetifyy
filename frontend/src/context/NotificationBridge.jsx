import { useEffect, useRef } from 'react';
import { useData } from './DataContext';
import { useNotifications } from './NotificationContext';

/**
 * Bridge component that connects DataContext's onNotify callback
 * to NotificationContext's addNotification. This avoids circular
 * dependencies between the two contexts.
 * 
 * Renders nothing — just wires the callback.
 */
export default function NotificationBridge({ children }) {
  const { setOnNotify } = useData();
  const { addNotification } = useNotifications();
  const addNotifRef = useRef(addNotification);

  useEffect(() => {
    addNotifRef.current = addNotification;
  }, [addNotification]);

  useEffect(() => {
    if (setOnNotify) {
      setOnNotify(() => (type, payload) => {
        addNotifRef.current(type, payload);
      });
    }
  }, [setOnNotify]);

  return children;
}
