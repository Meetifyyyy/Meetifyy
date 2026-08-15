export function drawDebugDot(x, y) {
  let dot = document.getElementById('debug-dot');
  if (!dot) {
    dot = document.createElement('div');
    dot.id = 'debug-dot';
    dot.style.position = 'fixed';
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.backgroundColor = 'red';
    dot.style.borderRadius = '50%';
    dot.style.zIndex = '100000';
    dot.style.transform = 'translate(-50%, -50%)';
    dot.style.pointerEvents = 'none';
    document.body.appendChild(dot);
  }
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  console.log('DEBUG DOT DRAWN AT', x, y);
}
