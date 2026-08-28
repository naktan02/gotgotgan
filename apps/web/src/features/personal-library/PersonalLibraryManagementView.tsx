'use client'

import { PersonalCollectionManager } from './PersonalCollectionManager'
import type { PersonalLibraryManagement } from './personal-library-management'
import styles from './personal-library.module.css'
import { PersonalTagManager } from './PersonalTagManager'

export function PersonalLibraryManagementView({
  management,
}: Readonly<{ management: PersonalLibraryManagement }>) {
  const canReloadCollection = management.collection.selectedCollectionId !== undefined &&
    management.collection.collection === undefined && !management.collection.collectionLoading

  return (
    <div className={styles.management}>
      <div className={styles.managementNotice}>
        <strong>Place 안의 정리만 변경합니다.</strong>
        <span>NAVER·Google·Kakao의 원본 저장 목록이나 즐겨찾기는 수정하거나 삭제하지 않습니다.</span>
      </div>
      {management.mutation.error !== undefined && (
        <div className={styles.error} role="alert">
          <span>{management.mutation.error}</span>
          {management.mutation.canRetry ? (
            <button onClick={() => void management.mutation.retry()} type="button">같은 요청 다시 시도</button>
          ) : canReloadCollection ? (
            <button onClick={() => void management.collection.retryCollection()} type="button">다시 불러오기</button>
          ) : null}
        </div>
      )}
      <div className={styles.managementGrid}>
        <PersonalCollectionManager
          management={management.collection}
          metadataLoading={management.metadataLoading}
          mutationKey={management.mutation.key}
        />
        <PersonalTagManager
          management={management.tag}
          metadataLoading={management.metadataLoading}
          mutationKey={management.mutation.key}
        />
      </div>
    </div>
  )
}
