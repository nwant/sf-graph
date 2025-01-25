/**
 * Hook to fetch object fields on demand
 */

import { useState, useEffect } from 'react';

interface FieldInfo {
  apiName: string;
  label: string;
  type: string;
  description?: string;
  referenceTo?: string[] | null;
  relationshipName?: string | null;
}

export function useObjectFields(objectApiName: string | null) {
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!objectApiName) {
      setFields([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Use ?include=fields to get field details
    fetch(`/objects/${objectApiName}?include=fields`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success && data.fields) {
          setFields(data.fields);
        } else {
          setFields([]);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setFields([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [objectApiName]);

  return { fields, loading, error };
}
