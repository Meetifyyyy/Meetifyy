import { useEffect } from 'react';
import { resolveAmbientRgb } from '../utils/ambientColor';

/**
 * Hook to dynamically manage the `--extracted-rgb` CSS custom property on a container element.
 * Safe from CORS network failures and instant for preset media.
 *
 * @param {import('react').RefObject<HTMLElement>} containerRef
 * @param {Object} options
 * @param {string} [options.coverImage]
 * @param {string} [options.coverColor]
 * @param {string} [options.coverMode]
 */
export function useAmbientTint(containerRef, { coverImage, coverColor, coverMode } = {}) {
  useEffect(() => {
    let active = true;

    resolveAmbientRgb({ coverImage, coverColor, coverMode })
      .then((rgb) => {
        if (!active || !containerRef.current) return;
        containerRef.current.style.setProperty('--extracted-rgb', rgb);
      })
      .catch(() => {
        if (!active || !containerRef.current) return;
        containerRef.current.style.setProperty('--extracted-rgb', '37, 99, 235');
      });

    return () => {
      active = false;
    };
  }, [containerRef, coverImage, coverColor, coverMode]);
}

export default useAmbientTint;
