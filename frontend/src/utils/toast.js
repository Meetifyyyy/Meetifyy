export function showToast(message) {
  const toast = document.createElement('div');
  toast.innerText = message;
  toast.className = 'custom-toast';
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    // slight delay ensures transition applies
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
  });

  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  }, 2500);
}
