/**
 * Hook for debounced search with setTimeout
 */

import { useState, useEffect } from 'react';
import type { GraphObject } from '../types/graph';
import { searchObjects } from '../services/api';

export function useDebouncedSearch(query: string, delay = 300) {
  const [results, setResults] = useState<GraphObject[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await searchObjects(query, 10);
        if (response.success) {
          setResults(response.objects);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [query, delay]);

  return { results, loading };
}
