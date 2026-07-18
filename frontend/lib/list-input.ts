'use client';

import { useCallback, useState } from 'react';

const LIST_DELIMITER = '、';

export function parseDelimitedList(value: string) {
  return value
    .split(/[，,、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatDelimitedList(items: string[]) {
  return items.join(LIST_DELIMITER);
}

export function useDelimitedListInput(initialItems: string[]) {
  const [inputValue, setInputValue] = useState(() => formatDelimitedList(initialItems));

  const syncFromItems = useCallback((items: string[]) => {
    setInputValue(formatDelimitedList(items));
  }, []);

  const normalizeInput = useCallback((value: string) => {
    const parsed = parseDelimitedList(value);
    setInputValue(formatDelimitedList(parsed));
    return parsed;
  }, []);

  return {
    inputValue,
    setInputValue,
    syncFromItems,
    normalizeInput,
  };
}
