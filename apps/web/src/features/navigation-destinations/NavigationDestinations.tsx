import Link from 'next/link'

import styles from './navigation-destinations.module.css'

export function BrowseDestination() {
  return (
    <section className={styles.destination}>
      <header><span>공개 컬렉션</span><h1>둘러보기</h1><p>다른 사람이 공개한 장소 컬렉션을 지역과 주제로 탐색하는 공간입니다.</p></header>
      <div className={styles.notice} role="status">
        <strong>공개 컬렉션 Interface 연결 전</strong>
        <p>목록 카드나 장소 수를 임의로 표시하지 않습니다. Backend 응답이 연결되면 공개 범위가 확인된 컬렉션만 이 화면에 나타납니다.</p>
      </div>
      <Link className={styles.primaryLink} href="/">카탈로그 탐색으로 돌아가기</Link>
    </section>
  )
}

export function SettingsDestination() {
  return (
    <section className={styles.destination}>
      <header><span>계정과 데이터</span><h1>설정</h1><p>계정 연결과 일회성 데이터 이동, 공개 프로필을 관리합니다.</p></header>
      <div className={styles.settingsGrid}>
        <Link href="/settings?tab=connections"><strong>연결된 계정</strong><span>계정 연결 지원 여부와 검증 기록을 확인합니다.</span></Link>
        <Link href="/settings?tab=import"><strong>데이터 이동</strong><span>지원되는 가져오기·내보내기 방식과 작업 내역을 확인합니다.</span></Link>
        <Link href="/profile"><strong>공개 프로필</strong><span>공개 정보와 관리 알림을 확인합니다.</span></Link>
        <Link href="/settings?tab=account"><strong>계정</strong><span>로그인 계정과 공개 프로필의 차이를 확인합니다.</span></Link>
      </div>
    </section>
  )
}
