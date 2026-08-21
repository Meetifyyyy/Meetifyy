import { useEffect, useState } from 'react';
import { loadAcademicCatalog } from './academicCatalog';

/**
 * Loads the academic catalogue once per session and shares it across every form
 * that needs it (signup, settings, directory filters).
 *
 * @returns {{ courses: import('./academicCatalog').AcademicCourse[], loading: boolean, error: string|null }}
 */
export function useAcademicCatalog() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    loadAcademicCatalog()
      .then((list) => {
        if (!alive) return;
        setCourses(list);
        setError(list.length ? null : 'Could not load courses. Please try again.');
      })
      .catch(() => {
        if (!alive) return;
        setError('Could not load courses. Please try again.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { courses, loading, error };
}
