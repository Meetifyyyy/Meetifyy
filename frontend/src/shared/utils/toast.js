let lastToastMessage = '';
let lastToastTime = 0;
let activeToastEl = null;
let toastTimeout = null;

export function dismissToast() {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  if (activeToastEl) {
    try { activeToastEl.remove(); } catch (_) {}
    activeToastEl = null;
  }
}

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
  dismissToast();

  const position = typeof positionOrOptions === 'string'
    ? positionOrOptions
    : (positionOrOptions?.position || 'bottom');

  const duration = typeof positionOrOptions === 'object' && positionOrOptions?.duration
    ? positionOrOptions.duration
    : 2500;

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

  toastTimeout = setTimeout(() => {
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

// Fluent helper methods for seamless showToast usage
showToast.success = (message, options) => showToast(message, 'success', options);
showToast.error = (message, options) => showToast(message, 'error', options);
showToast.warning = (message, options) => showToast(message, 'warning', options);
showToast.info = (message, options) => showToast(message, 'info', options);
showToast.dismiss = dismissToast;

showToast.promise = (promise, { loading, success, error } = {}) => {
  if (loading) {
    showToast(typeof loading === 'string' ? loading : 'Loading...', 'info');
  }
  return promise
    .then((result) => {
      if (success) {
        const msg = typeof success === 'function' ? success(result) : success;
        if (msg) showToast(msg, 'success');
      }
      return result;
    })
    .catch((err) => {
      if (error) {
        const msg = typeof error === 'function' ? error(err) : error;
        if (msg) showToast(msg, 'error');
      }
      throw err;
    });
};
