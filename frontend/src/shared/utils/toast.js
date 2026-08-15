let lastToastMessage = '';
let lastToastTime = 0;
let activeToastEl = null;

export function showToast(message, type = 'default', positionOrOptions = 'bottom') {
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

  const position = typeof positionOrOptions === 'string'
    ? positionOrOptions
    : (positionOrOptions?.position || 'bottom');

  const toast = document.createElement('div');
  toast.className = `custom-toast${type && type !== 'default' ? ` custom-toast-${type}` : ''} custom-toast-${position}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');

  const span = document.createElement('span');
  span.className = 'custom-toast-message';
  span.innerText = message;
  toast.appendChild(span);

  document.body.appendChild(toast);
  activeToastEl = toast;

  // Trigger animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
  });

  const duration = 2500;
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
