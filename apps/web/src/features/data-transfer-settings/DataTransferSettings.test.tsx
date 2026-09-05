import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DataTransferSettingsView } from './DataTransferSettings'
import type { DataTransferSettingsWorkflow } from './data-transfer-settings-workflow'

const noop = () => undefined
const asyncNoop = async () => undefined
const collectionId = '01992d20-0000-7000-8000-000000000001'
const connectionId = '01992d20-0000-7000-8000-000000000002'
const placeId = '01992d20-0000-7000-8000-000000000003'
const historyPanel = <section>서버 작업 내역</section>

function workflow(overrides: Partial<DataTransferSettingsWorkflow> = {}) {
  const capability = (providerKey: 'naver' | 'google' | 'kakao', connectionState: 'available' | 'integration-gated' | 'unavailable') => ({
    providerKey, label: providerKey === 'naver' ? 'NAVER' : providerKey === 'google' ? 'Google' : 'Kakao',
    connectionState, authMethods: ['oauth'] as const,
    import: connectionState === 'available'
      ? { state: 'available' as const, label: '사용 가능' }
      : { state: 'integration-gated' as const, label: '연동 준비 중', reason: '가져오기 어댑터 준비 중', alternative: '지원 파일 경로가 열리면 안내' },
    export: { state: 'unavailable' as const, label: '현재 미지원', reason: '내보내기 어댑터 준비 중', alternative: '공개 링크 공유 가능' },
  })
  const overview = {
    providers: [
      { capability: capability('naver', 'available'), connections: [{ connectionId, providerKey: 'naver' as const, authMethod: 'oauth' as const, accountLabel: '여행 계정', state: 'ready' as const, lastVerifiedAt: '2026-09-03T00:00:00.000Z', revision: 'r1' }] },
      { capability: capability('google', 'integration-gated'), connections: [] },
      { capability: capability('kakao', 'unavailable'), connections: [] },
    ],
    collections: [{ collectionId, name: '도쿄 여행', placeCount: 1, collectionRevision: 'c1', places: [{ placeId, name: '도쿄 국립박물관' }] }],
  }
  return {
    tab: 'connections', overview, loadState: 'ready', providerActions: {}, providerOperations: {},
    importProvider: 'naver', importConnectionId: connectionId,
    snapshot: undefined, mappings: [], importPreview: undefined,
    importState: { kind: 'idle' }, importApproval: { kind: 'idle' }, importDecisions: {},
    exportProvider: 'naver', exportConnectionId: connectionId, exportCollectionId: collectionId,
    exportCollectionState: 'ready', exportSelectionKind: 'all', exportPlaceIds: new Set<string>(),
    targetKind: 'new', targetListName: '도쿄 여행', targetListId: '',
    targetLists: { state: 'available', items: [{ targetListId: 'remote-1', name: '2026 여행', itemCount: 2 }] }, targetListState: 'ready',
    exportPreview: undefined, exportState: { kind: 'idle' }, exportApproval: { kind: 'idle' },
    selectedExportCollection: overview.collections[0],
    setTab: noop, retry: asyncNoop, connectionCommand: asyncNoop,
    changeImportProvider: noop, setImportConnectionId: noop, acquireSnapshot: asyncNoop,
    updateMapping: noop, previewImport: asyncNoop,
    decideImportItem: asyncNoop, approveImport: asyncNoop,
    changeExportProvider: noop, setExportConnectionId: noop, setExportCollectionId: noop,
    setExportSelectionKind: noop, toggleExportPlace: noop, setTargetKind: noop,
    setTargetListName: noop, setTargetListId: noop, previewExport: asyncNoop, approveExport: asyncNoop,
    ...overrides,
  } as unknown as DataTransferSettingsWorkflow
}

describe('Data transfer settings view', () => {
  it('keeps the six settings tabs and truthful independent provider capability cards', () => {
    const markup = renderToStaticMarkup(<DataTransferSettingsView historyPanel={historyPanel} workflow={workflow()} />)
    expect(markup).toContain('외부 서비스 연결')
    expect(markup).toContain('데이터 가져오기')
    expect(markup).toContain('데이터 내보내기')
    expect(markup).toContain('작업 내역')
    expect(markup).toContain('공개 프로필')
    expect(markup).toContain('여행 계정')
    expect(markup).toContain('계정 연결은 운영 연동이 활성화된 뒤 사용할 수 있습니다')
    expect(markup).toContain('공개 링크 공유 가능')
  })

  it('renders observed import evidence and blocks unsafe raw identity links', () => {
    const markup = renderToStaticMarkup(<DataTransferSettingsView historyPanel={historyPanel} workflow={workflow({
      tab: 'import',
      snapshot: {
        snapshotId: 's1', snapshotRevision: 'sr1', providerKey: 'naver', connectionId,
        capturedAt: '2026-09-03T00:00:00.000Z',
        lists: [{ sourceListId: 'source-list', name: '도쿄 여행', itemCount: 1, unresolvedItemCount: 1 }],
      },
      mappings: [{ sourceListId: 'source-list', selected: true, target: { kind: 'new', collectionId, name: '도쿄 여행' } }],
      importPreview: {
        planId: 'p1', planRevision: 'pr1', snapshotId: 's1', snapshotRevision: 'sr1',
        mappings: [], summary: { add: 0, alreadyPresent: 0, reviewRequired: 1, unsupported: 0 },
        providerDetails: { pending: 1, available: 0, unavailable: 0 },
        matches: [{ sourceListId: 'source-list', sourceItemId: 'source-item', sourceName: '센소지', sourceAddress: '도쿄도 다이토구', sourceListName: '도쿄 여행', status: 'review-required', providerDetailStatus: 'pending' }],
        approvalEligible: false, approvalReason: '매칭되지 않은 장소가 있어 승인할 수 없습니다.',
      },
    })} />)
    expect(markup).toContain('도쿄도 다이토구')
    expect(markup).toContain('건너뛰기')
    expect(markup).toContain('기본 장소 정보나 연결 상태를 확인해야 합니다')
    expect(markup).not.toContain('자동으로 갱신')
    expect(markup).not.toContain('곳곳간 장소 ID')
  })

  it('keeps a blocked export non-approvable and states private-data exclusions', () => {
    const markup = renderToStaticMarkup(<DataTransferSettingsView historyPanel={historyPanel} workflow={workflow({
      tab: 'export',
      exportPreview: {
        transferId: 't1', transferRevision: 'tr1', state: 'blocked', providerKey: 'naver', collectionId,
        targetList: { kind: 'new', name: '도쿄 여행' },
        summary: { add: null, alreadyPresent: null, unresolved: null, unsupported: null },
        items: [], blockedReason: '대상 서비스의 내보내기 어댑터가 준비되지 않았습니다.', approvalEligible: false,
      },
    })} />)
    expect(markup).toContain('대상 서비스의 내보내기 어댑터가 준비되지 않았습니다')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('개인 메모·방문 기록·개인 사진·개인 평점')
  })

  it.each(['pending', 'unavailable'] as const)('allows approval with %s detail and shows a separate paused enrichment notice', (providerDetailStatus) => {
    const markup = renderToStaticMarkup(<DataTransferSettingsView historyPanel={historyPanel} workflow={workflow({
      tab: 'import',
      importPreview: {
        planId: 'p1', planRevision: 'pr1', snapshotId: 's1', snapshotRevision: 'sr1',
        mappings: [], summary: { add: 1, alreadyPresent: 0, reviewRequired: 0, unsupported: 0 },
        providerDetails: { pending: Number(providerDetailStatus === 'pending'), available: 0, unavailable: Number(providerDetailStatus === 'unavailable') },
        matches: [{ sourceListId: 'source-list', sourceItemId: 'source-item', sourceName: '기본 정보 장소',
          sourceAddress: null, sourceListName: '도쿄 여행', status: 'add', providerDetailStatus }],
        approvalEligible: true,
      },
    })} />)
    expect(markup).toContain('상세정보 미보유 1개 항목')
    expect(markup).toContain('상세정보 보강은 현재 보류 중')
    expect(markup).toContain('가져오기 완료와 별개')
    expect(markup).not.toContain('건너뛰기')
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>이 범위로 가져오기 승인<\/button>/)
  })

  it('does not pretend a truncated large snapshot can be fully approved', () => {
    const markup = renderToStaticMarkup(<DataTransferSettingsView historyPanel={historyPanel} workflow={workflow({
      tab: 'import',
      snapshot: {
        snapshotId: 's-large', snapshotRevision: 'sr-large', providerKey: 'naver', connectionId,
        capturedAt: '2026-09-03T00:00:00.000Z', totalListCount: 72, totalItemCount: 12_300,
        hasUnloadedLists: true,
        lists: [{ sourceListId: 'source-list', name: '먼저 불러온 목록', itemCount: 500, unresolvedItemCount: 0 }],
      },
      mappings: [{ sourceListId: 'source-list', selected: true, target: { kind: 'new', collectionId, name: '먼저 불러온 목록' } }],
    })} />)
    expect(markup).toContain('1 / 72개 목록')
    expect(markup).toContain('일부 목록만으로 가져오기를 승인할 수 없습니다')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>매칭 미리보기<\/button>/)
  })
})
