/**
 * Hook for graph navigation with URL persistence
 */

import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

const STORAGE_KEY = 'graph-viz-last-focus';
const DEFAULT_OBJECT = 'Account';

export function useGraphNavigation() {
  const [searchParams, setSearchParams] = useSearchParams();

  const focusedObject =
    searchParams.get('focus') ||
    localStorage.getItem(STORAGE_KEY) ||
    DEFAULT_OBJECT;

  const navigate = useCallback(
    (objectName: string) => {
      localStorage.setItem(STORAGE_KEY, objectName);
      setSearchParams({ focus: objectName });
    },
    [setSearchParams]
  );

  const depth = parseInt(searchParams.get('depth') || '2', 10);

  const setDepth = useCallback(
    (newDepth: number) => {
      setSearchParams((prev) => {
        prev.set('depth', String(newDepth));
        return prev;
      });
    },
    [setSearchParams]
  );

  return {
    focusedObject,
    navigate,
    depth,
    setDepth,
  };
}
