'use client'

import styles from './personal-library.module.css'
import { PersonalLibraryBrowseView } from './PersonalLibraryBrowseView'
import { PersonalLibraryManagementView } from './PersonalLibraryManagementView'
import type { PersonalLibraryWorkflow } from './personal-library-workflow'
import type { PlaceMapRenderer } from '@/platform/maps/place-map-interface'

export function PersonalLibraryView({
  mapRenderer,
  workflow,
}: Readonly<{ workflow: PersonalLibraryWorkflow; mapRenderer: PlaceMapRenderer }>) {
  const {
    mode,
    authenticationRequired,
    management,
    showBrowse,
    showManagement,
  } = workflow

  if (authenticationRequired) {
    return (
      <section aria-labelledby="personal-library-title" className={styles.gate}>
        <p>개인 라이브러리</p>
        <h1 id="personal-library-title">내 장소를 보려면 로그인이 필요합니다.</h1>
        <span>저장한 장소, 태그와 컬렉션은 브라우저에 토큰을 노출하지 않고 불러옵니다.</span>
        <a href="/api/auth/oidc/start">로그인하고 계속</a>
      </section>
    )
  }

  return (
    <section aria-labelledby="personal-library-title" className={styles.library}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Personal Library</p>
          <h1 id="personal-library-title">내 장소</h1>
        </div>
        <div className={styles.libraryMode}>
          <p>{mode === 'browse'
            ? '저장한 장소를 목록과 지도에서 찾고, 상세 패널에서 바로 기록합니다.'
            : '내 컬렉션과 태그, 컬렉션 안 장소 순서를 관리합니다.'}</p>
          <div aria-label="라이브러리 보기 방식">
            <button aria-pressed={mode === 'browse'} onClick={showBrowse} type="button">장소 보기</button>
            <button aria-pressed={mode === 'manage'} onClick={showManagement} type="button">목록·태그 관리</button>
          </div>
        </div>
      </header>

      {mode === 'manage'
        ? <PersonalLibraryManagementView management={management} />
        : <PersonalLibraryBrowseView mapRenderer={mapRenderer} workflow={workflow} />}
    </section>
  )
}
