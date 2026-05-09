'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function FetchInterceptor() {
  const router = useRouter();

  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      
      const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');

      // Check if the response is a 401 Unauthorized
      // Ignore login endpoint to prevent infinite loop or issues if it returns 401 on wrong password
      if (response.status === 401 && !url.includes('/api/auth/login')) {
        router.push('/login');
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [router]);

  return null;
}
