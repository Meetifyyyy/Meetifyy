import { useState, useCallback } from 'react';

export function useGPSLocation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [location, setLocation] = useState(null);

  const requestGPS = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      return Promise.resolve(null);
    }

    setLoading(true);
    setError(null);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: new Date().toISOString(),
          };
          setLocation(coords);
          setLoading(false);
          resolve(coords);
        },
        (err) => {
          let errMsg = 'Unable to retrieve location';
          if (err.code === err.PERMISSION_DENIED) {
            errMsg = 'Permission denied';
          }
          setError(errMsg);
          setLocation(null);
          setLoading(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });
  }, []);

  const clearLocation = useCallback(() => {
    setLocation(null);
    setError(null);
  }, []);

  return {
    location,
    loading,
    error,
    requestGPS,
    clearLocation
  };
}
