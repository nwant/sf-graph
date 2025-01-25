/**
 * Hook for fetching graph neighborhood data
 */

import { useState, useEffect, useCallback } from 'react';
import type { CytoscapeElements } from '../types/graph';
import { fetchNeighborhood } from '../services/api';

interface UseGraphDataState {
  data: CytoscapeElements | null;
  loading: boolean;
  error: Error | null;
}

export function useGraphData(objectName: string | null, depth = 2) {
  const [state, setState] = useState<UseGraphDataState>({
    data: null,
    loading: false,
    error: null,
  });

  const fetchData = useCallback(async () => {
    if (!objectName) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetchNeighborhood(objectName, depth);
      if (response.success) {
        setState({ data: response.elements, loading: false, error: null });
      } else {
        setState({
          data: null,
          loading: false,
          error: new Error(response.error || 'Unknown error'),
        });
      }
    } catch (err) {
      setState({
        data: null,
        loading: false,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }, [objectName, depth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const retry = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return { ...state, retry };
}
