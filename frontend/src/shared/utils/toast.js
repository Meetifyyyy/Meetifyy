let lastToastMessage = '';
let lastToastTime = 0;
let activeToastEl = null;

export function showToast(message, type = 'default') {
  if (!message || typeof message !== 'string') return;

  const now = Date.now();
  // Prevent duplicate toasts within 1500ms
  if (message === lastToastMessage && now - lastToastTime < 1500) {
    return;
  }
  lastToastMessage = message;
  lastToastTime = now;

  // Clean up any currently active toast immediately
  if (activeToastEl) {
    try { activeToastEl.remove(); } catch (_) {}
    activeToastEl = null;
  }

  const toast = document.createElement('div');
  toast.innerText = message;
  toast.className = `custom-toast${type && type !== 'default' ? ` custom-toast-${type}` : ''}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  document.body.appendChild(toast);
  activeToastEl = toast;

  // Trigger animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
  });

  const duration = type === 'error' ? 3500 : 2500;
  setTimeout(() => {
    toast.classList.remove('show');
    const removeHandler = () => {
      toast.removeEventListener('transitionend', removeHandler);
      try { toast.remove(); } catch (_) {}
      if (activeToastEl === toast) activeToastEl = null;
    };
    toast.addEventListener('transitionend', removeHandler);
    // Fallback cleanup if transitionend does not fire
    setTimeout(removeHandler, 400);
  }, duration);
}

