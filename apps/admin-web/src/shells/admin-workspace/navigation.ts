export type AdminNavigationItem = Readonly<{
  label: string
  enabled: boolean
  detail?: string
}>

export type AdminNavigationGroup = Readonly<{
  label: string
  items: readonly AdminNavigationItem[]
}>

const missing = 'Backend Interface 미구현'

export const adminNavigation: readonly AdminNavigationGroup[] = [
  { label: '운영 대시보드', items: [{ label: '접근 및 Capability', enabled: true }] },
  {
    label: '장소 관리',
    items: [
      { label: '장소 데이터', enabled: false, detail: missing },
      { label: '중복·병합/분리', enabled: false, detail: missing },
      { label: '분류 관리', enabled: false, detail: missing },
      { label: '휴·폐업 검수', enabled: false, detail: missing },
    ],
  },
  {
    label: '데이터 수집',
    items: [
      { label: '수집 작업', enabled: false, detail: missing },
      { label: '데이터 소스', enabled: false, detail: missing },
      { label: '스케줄', enabled: false, detail: missing },
      { label: '수집 로그', enabled: false, detail: missing },
    ],
  },
  {
    label: '사용자 관리',
    items: [
      { label: '사용자 계정', enabled: false, detail: missing },
      { label: '권한 관리', enabled: false, detail: missing },
      { label: '신고·이의', enabled: false, detail: missing },
    ],
  },
  {
    label: '시스템',
    items: [
      { label: '작업 내역', enabled: false, detail: missing },
      { label: '실패 작업', enabled: false, detail: missing },
      { label: '감사 로그', enabled: false, detail: missing },
      { label: '시스템 설정', enabled: false, detail: missing },
    ],
  },
]
