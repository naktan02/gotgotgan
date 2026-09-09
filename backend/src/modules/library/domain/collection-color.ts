export const collectionColorTokens = [
  'fern', 'ocean', 'amber', 'coral', 'violet', 'cyan', 'magenta', 'slate',
] as const

export type CollectionColorToken = typeof collectionColorTokens[number]
