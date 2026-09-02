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
      <header><span>계정과 데이터</span><h1>설정</h1><p>외부 서비스 연결, 데이터 이동, 공개 프로필과 계정을 관리합니다.</p></header>
      <div className={styles.settingsGrid}>
        <Link href="/imports"><strong>데이터 가져오기</strong><span>NAVER·Google·Kakao 목록을 서비스별로 가져옵니다.</span></Link>
        <Link href="/profile"><strong>공개 프로필</strong><span>공개 정보와 관리 알림을 확인합니다.</span></Link>
        <div aria-disabled="true"><strong>데이터 내보내기</strong><span>Backend Interface 연결 전</span></div>
        <div aria-disabled="true"><strong>작업 내역</strong><span>Backend Interface 연결 전</span></div>
      </div>
    </section>
  )
}
