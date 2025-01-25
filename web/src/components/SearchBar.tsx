/**
 * SearchBar Component
 * Object search with debounced autocomplete
 */

import { useState, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Input,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Button,
  Text,
  Spinner,
} from '@fluentui/react-components';
import { Search24Regular } from '@fluentui/react-icons';
import { useDebouncedSearch } from '../hooks/useDebouncedSearch';
import type { GraphObject } from '../types/graph';

const useStyles = makeStyles({
  container: {
    position: 'relative',
    width: '300px',
  },
  resultsList: {
    maxHeight: '300px',
    overflowY: 'auto',
  },
  resultItem: {
    padding: tokens.spacingVerticalS,
    cursor: 'pointer',
    borderRadius: tokens.borderRadiusMedium,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  resultLabel: {
    fontWeight: tokens.fontWeightSemibold,
  },
  resultCategory: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  noResults: {
    padding: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground3,
    textAlign: 'center' as const,
  },
});

interface SearchBarProps {
  onSelect: (objectName: string) => void;
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { results, loading } = useDebouncedSearch(query);

  const handleSelect = useCallback(
    (obj: GraphObject) => {
      onSelect(obj.apiName);
      setQuery('');
      setOpen(false);
    },
    [onSelect]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      if (e.target.value.length >= 2) {
        setOpen(true);
      } else {
        setOpen(false);
      }
    },
    []
  );

  return (
    <div className={styles.container}>
      <Popover open={open && (results.length > 0 || loading)} onOpenChange={(_, data) => setOpen(data.open)}>
        <PopoverTrigger>
          <Input
            placeholder="Search objects..."
            value={query}
            onChange={handleInputChange}
            contentBefore={<Search24Regular />}
            appearance="filled-darker"
          />
        </PopoverTrigger>
        <PopoverSurface>
          <div className={styles.resultsList}>
            {loading && <Spinner size="tiny" label="Searching..." />}
            {!loading && results.length === 0 && query.length >= 2 && (
              <div className={styles.noResults}>No results found</div>
            )}
            {results.map((obj) => (
              <Button
                key={obj.apiName}
                appearance="subtle"
                className={styles.resultItem}
                onClick={() => handleSelect(obj)}
                style={{ display: 'block', width: '100%', textAlign: 'left' }}
              >
                <Text className={styles.resultLabel}>{obj.label}</Text>
                <br />
                <Text className={styles.resultCategory}>
                  {obj.apiName} • {obj.category}
                </Text>
              </Button>
            ))}
          </div>
        </PopoverSurface>
      </Popover>
    </div>
  );
}
