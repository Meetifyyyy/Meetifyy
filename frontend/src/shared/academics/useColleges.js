import { useState, useEffect } from 'react';
import { apiClient } from '@shared/api/apiClient';

export function useColleges() {
  const [colleges, setColleges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    apiClient
      .get('/api/academics/colleges')
      .then((res) => {
        if (isMounted) {
          const list = Array.isArray(res?.colleges) ? res.colleges : [];
          setColleges(list);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err?.message || 'Failed to load colleges');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return { colleges, loading, error };
}
