export function libraryEvidenceLabel(
  status: 'verified' | 'unverified' | 'conflicted' | 'stale',
) {
  if (status === 'verified') return '검증됨'
  if (status === 'conflicted') return '정보 충돌'
  if (status === 'stale') return '갱신 필요'
  return '확인 필요'
}
