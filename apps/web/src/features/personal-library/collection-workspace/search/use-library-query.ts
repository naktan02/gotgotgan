import { useMemo, useState } from 'react'
import { interpretLibraryQuery, type LibraryQueryCondition, type LibraryQueryFilters } from './library-query'

export function useLibraryQuery(initialQuery: string, vocabulary: readonly LibraryQueryCondition[], manual: LibraryQueryFilters) {
  const [query, setQuery] = useState(initialQuery)
  const [mode, setMode] = useState<'auto' | 'name'>('auto')
  const signature = JSON.stringify({ vocabulary, manual })
  const interpretation = useMemo(() => {
    const stable = JSON.parse(signature) as { vocabulary: LibraryQueryCondition[]; manual: LibraryQueryFilters }
    return mode === 'name'
      ? { text: query.trim(), conditions: [], filters: stable.manual }
      : interpretLibraryQuery(query, stable.vocabulary, stable.manual)
  }, [query, mode, signature])
  return {
    query, mode, ...interpretation,
    submit: (value: string) => { setQuery(value); setMode('auto') },
    searchAsText: () => setMode('name'),
    searchAsConditions: () => setMode('auto'),
    removeCondition: (condition: LibraryQueryCondition) => setQuery(interpretLibraryQuery(query, [condition], { areaKeys: [], taxonomyKeys: [], tagIds: [] }).text),
    clearConditions: () => { setQuery(interpretation.text); setMode('auto') },
  }
}
