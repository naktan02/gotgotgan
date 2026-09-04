import type { TransferProviderKey } from './data-transfer-settings-model'
import styles from './data-transfer-settings.module.css'
import type { DataTransferSettingsWorkflow } from './data-transfer-settings-workflow'

export function formatDate(value: string | null): string {
  if (value === null) return '검증 기록 없음'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '검증 시각 확인 불가' : new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date)
}

export function summaryValue(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('ko-KR')
}

export function PrivacyNotice() {
  return <p className={styles.notice} role="note">
    장소와 컬렉션 구성만 이동합니다. 개인 메모·방문 기록·개인 사진·개인 평점은 가져오거나
    내보내지 않습니다. 실행 전 미리보기에서 처리 범위를 다시 확인하세요.
  </p>
}

export function SectionHeading({ title, description }: Readonly<{ title: string; description: string }>) {
  return <header className={styles.sectionHeading}>
    <div><h2>{title}</h2><p>{description}</p></div>
  </header>
}

export function ActionFeedback({ state }: Readonly<{
  state: Readonly<{ kind: 'idle' | 'working' | 'done' }> | Readonly<{ kind: 'error'; message: string }> | undefined
}>) {
  if (state?.kind === 'working') return <p className={styles.actionMessage} role="status">처리 중…</p>
  if (state?.kind === 'done') return <p className={styles.success} role="status">요청을 반영했습니다.</p>
  if (state?.kind === 'error') return <p className={styles.error} role="alert">{state.message}</p>
  return null
}

export function FlowRail({ current, labels }: Readonly<{ current: number; labels: readonly string[] }>) {
  return <aside className={styles.flowRail} aria-label="작업 단계">
    <h3>진행 순서</h3>
    <ol className={styles.steps}>{labels.map((label, index) => <li
      aria-current={index + 1 === current ? 'step' : undefined}
      className={index + 1 === current ? styles.currentStep : undefined}
      key={label}
    ><span>{index + 1}</span>{label}</li>)}</ol>
  </aside>
}

export function ProviderFields({
  providerKey,
  connectionId,
  workflow,
  onProvider,
  onConnection,
  operation,
}: Readonly<{
  providerKey: TransferProviderKey
  connectionId: string
  workflow: DataTransferSettingsWorkflow
  onProvider: (key: TransferProviderKey) => void
  onConnection: (value: string) => void
  operation: 'import' | 'export'
}>) {
  const provider = workflow.overview?.providers.find((item) => item.capability.providerKey === providerKey)
  const connections = provider?.connections.filter((item) => item.state === 'ready') ?? []
  const capability = operation === 'import' ? provider?.capability.import : provider?.capability.export
  return <>
    <label className={styles.field}>서비스
      <select value={providerKey} onChange={(event) => onProvider(event.target.value as TransferProviderKey)}>
        {workflow.overview?.providers.map((item) => <option key={item.capability.providerKey} value={item.capability.providerKey}>{item.capability.label}</option>)}
      </select>
    </label>
    <label className={styles.field}>연결 계정
      <select disabled={connections.length === 0} value={connectionId} onChange={(event) => onConnection(event.target.value)}>
        {connections.length === 0 && <option value="">사용 가능한 연결 없음</option>}
        {connections.map((connection) => <option key={connection.connectionId} value={connection.connectionId}>{connection.accountLabel ?? '이름 없는 계정'}</option>)}
      </select>
    </label>
    {capability?.state !== 'available' && <p className={styles.blocked} role="note">
      {capability?.label ?? '현재 이 작업을 사용할 수 없습니다.'}
      {capability?.reason && ` — ${capability.reason}`}
      {capability?.alternative && ` ${capability.alternative}`}
    </p>}
  </>
}
