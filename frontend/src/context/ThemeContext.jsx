import { createContext, useContext, useState, useEffect, useRef } from 'react';

// cubic-bezier(0.25, 0, 0.15, 1) solver approximation for canvas animation easing
function easeInOutCubicBezier(t) {
  const getX = (t) => 3 * (1 - t) * (1 - t) * t * 0.25 + 3 * (1 - t) * t * t * 0.15 + t * t * t;
  const getY = (t) => 3 * (1 - t) * (1 - t) * t * 0 + 3 * (1 - t) * t * t * 1 + t * t * t;
  
  let low = 0, high = 1, mid;
  for (let i = 0; i < 8; i++) {
    mid = (low + high) / 2;
    const x = getX(mid);
    if (x < t) low = mid;
    else high = mid;
  }
  return getY(mid);
}

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      return savedTheme;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });

  const activeTransitionRef = useRef(null);
  const activeCanvasRef = useRef(null);
  const animationFrameIdRef = useRef(null);

  const cleanupActiveCanvas = () => {
    if (activeCanvasRef.current) {
      activeCanvasRef.current.remove();
      activeCanvasRef.current = null;
    }
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      cleanupActiveCanvas();
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      // Update theme on system change only if the user hasn't explicitly set a preference
      if (!localStorage.getItem('theme_preference_set')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      mediaQuery.addListener(handleChange); // Fallback for older browsers
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

  const toggleTheme = (e) => {
    localStorage.setItem('theme_preference_set', 'true');
    const newTheme = theme === 'light' ? 'dark' : 'light';

    // 1. Detect device & capability constraints
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isLowEnd =
      (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) ||
      (navigator.deviceMemory && navigator.deviceMemory <= 2);

    if (prefersReducedMotion || isLowEnd) {
      document.documentElement.setAttribute('data-theme', newTheme);
      setTheme(newTheme);
      return;
    }

    // 2. Resolve coords (x, y)
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;

    if (e) {
      if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        x = e.clientX;
        y = e.clientY;
      } else if (e.currentTarget && typeof e.currentTarget.getBoundingClientRect === 'function') {
        const rect = e.currentTarget.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      }
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    const radius = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));

    // 3. Primary Path (View Transitions API)
    if (document.startViewTransition) {
      // Cancel active transition if running
      if (activeTransitionRef.current && typeof activeTransitionRef.current.skipTransition === 'function') {
        try {
          activeTransitionRef.current.skipTransition();
        } catch (err) {
          // ignore
        }
      }

      cleanupActiveCanvas();

      const duration = w <= 768 ? 1000 : 1200;

      // Set custom properties
      document.documentElement.style.setProperty('--vt-x', `${x}px`);
      document.documentElement.style.setProperty('--vt-y', `${y}px`);
      document.documentElement.style.setProperty('--vt-r', `${radius}px`);
      document.documentElement.style.setProperty('--vt-duration', `${duration}ms`);

      document.documentElement.classList.add('theme-transitioning');

      const transition = document.startViewTransition(() => {
        document.documentElement.setAttribute('data-theme', newTheme);
        setTheme(newTheme);
      });

      activeTransitionRef.current = transition;

      transition.finished.finally(() => {
        if (activeTransitionRef.current === transition) {
          activeTransitionRef.current = null;
        }
        document.documentElement.classList.remove('theme-transitioning');
      });
      return;
    }

    // 4. Fallback Path (Canvas Snapshot)
    if (activeTransitionRef.current && typeof activeTransitionRef.current.skipTransition === 'function') {
      try {
        activeTransitionRef.current.skipTransition();
      } catch (err) {
        // ignore
      }
    }
    cleanupActiveCanvas();

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    let duration = w <= 768 ? 1000 : 1200;
    if (isIOS) {
      duration = 900;
    }

    // Load html2canvas dynamically
    import('html2canvas')
      .then(({ default: html2canvas }) => {
        html2canvas(document.body, {
          useCORS: true,
          allowTaint: true,
          scale: window.devicePixelRatio || 1,
          scrollX: 0,
          scrollY: 0,
          windowWidth: document.documentElement.clientWidth,
          windowHeight: document.documentElement.clientHeight,
          ignoreElements: (element) => {
            return element.classList.contains('theme-overlay') || element.tagName === 'CANVAS';
          }
        })
          .then((canvasSnapshot) => {
            // Check if user started a different transition since snapshot began
            if (activeTransitionRef.current || activeCanvasRef.current) {
              return;
            }

            const canvas = document.createElement('canvas');
            canvas.className = 'theme-overlay';
            
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            canvas.width = viewportWidth * (window.devicePixelRatio || 1);
            canvas.height = viewportHeight * (window.devicePixelRatio || 1);
            canvas.style.width = `${viewportWidth}px`;
            canvas.style.height = `${viewportHeight}px`;
            canvas.style.position = 'fixed';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.zIndex = '9999';
            canvas.style.pointerEvents = 'none';
            canvas.style.willChange = 'clip-path';
            canvas.style.transform = 'translateZ(0)';
            
            document.body.appendChild(canvas);
            activeCanvasRef.current = canvas;

            const ctx = canvas.getContext('2d');
            ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

            const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
            const scrollTop = window.scrollY || document.documentElement.scrollTop;

            document.documentElement.classList.add('theme-transitioning');
            document.documentElement.setAttribute('data-theme', newTheme);
            setTheme(newTheme);

            const startTime = performance.now();

            function animate(currentTime) {
              const elapsed = currentTime - startTime;
              const progress = Math.min(elapsed / duration, 1);
              const easedProgress = easeInOutCubicBezier(progress);
              const currentRadius = easedProgress * radius;

              ctx.clearRect(0, 0, viewportWidth, viewportHeight);

              ctx.save();
              ctx.drawImage(
                canvasSnapshot,
                scrollLeft * (window.devicePixelRatio || 1),
                scrollTop * (window.devicePixelRatio || 1),
                viewportWidth * (window.devicePixelRatio || 1),
                viewportHeight * (window.devicePixelRatio || 1),
                0,
                0,
                viewportWidth,
                viewportHeight
              );
              ctx.restore();

              ctx.save();
              ctx.globalCompositeOperation = 'destination-out';
              ctx.beginPath();
              ctx.arc(x, y, currentRadius, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();

              if (progress < 1) {
                animationFrameIdRef.current = requestAnimationFrame(animate);
              } else {
                cleanupActiveCanvas();
                document.documentElement.classList.remove('theme-transitioning');
              }
            }

            animationFrameIdRef.current = requestAnimationFrame(animate);
          })
          .catch((err) => {
            console.error('Canvas snapshot error:', err);
            document.documentElement.setAttribute('data-theme', newTheme);
            setTheme(newTheme);
          });
      })
      .catch((err) => {
        console.error('Failed to load html2canvas:', err);
        document.documentElement.setAttribute('data-theme', newTheme);
        setTheme(newTheme);
      });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
