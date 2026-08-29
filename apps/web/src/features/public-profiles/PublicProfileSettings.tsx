'use client'

import { usePublicProfileSettings } from './public-profile-settings'
import styles from './public-profiles.module.css'

export function PublicProfileSettings() {
  const workflow = usePublicProfileSettings()

  if (workflow.loadState === 'loading') {
    return <section aria-label="공개 프로필 설정" className={styles.settings}><p role="status">프로필을 불러오는 중…</p></section>
  }
  if (workflow.loadState === 'authentication-required') {
    return <section aria-labelledby="profile-settings-title" className={styles.settings}>
      <h1 id="profile-settings-title">공개 프로필</h1>
      <p>프로필을 만들거나 숨기려면 로그인이 필요합니다.</p>
      <a className={styles.primaryLink} href="/api/auth/oidc/start">로그인하고 계속</a>
    </section>
  }
  if (workflow.loadState === 'unavailable') {
    return <section aria-labelledby="profile-settings-title" className={styles.settings}>
      <h1 id="profile-settings-title">공개 프로필</h1>
      <p role="alert">프로필을 지금 불러올 수 없습니다.</p>
      <button onClick={() => void workflow.reload()} type="button">다시 시도</button>
    </section>
  }

  const handleValid = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(workflow.handle) &&
    workflow.handle.length >= 3 && workflow.handle.length <= 30
  const canSave = handleValid && workflow.displayName.trim().length > 0 &&
    workflow.displayName.length <= 50 && !workflow.saving

  return <section aria-labelledby="profile-settings-title" className={styles.settings}>
    <header>
      <p>Public Profile</p>
      <h1 id="profile-settings-title">공개 프로필</h1>
      <span>실명이나 로그인 정보 대신 공개용 핸들과 표시 이름만 사용합니다.</span>
    </header>
    <form onSubmit={(event) => { event.preventDefault(); workflow.save() }}>
      <label htmlFor="public-handle">공개 핸들</label>
      <div className={styles.handleField}>
        <span>place/people/</span>
        <input
          autoComplete="off"
          disabled={workflow.profile !== undefined}
          id="public-handle"
          maxLength={30}
          onChange={(event) => workflow.setHandle(event.target.value.toLowerCase())}
          pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])"
          required
          value={workflow.handle}
        />
      </div>
      <small>{workflow.profile === undefined
        ? '소문자 영문·숫자·하이픈 3~30자. 만든 뒤에는 공개 링크 보호를 위해 변경할 수 없습니다.'
        : '공개 핸들은 링크 안정성을 위해 고정됩니다.'}</small>

      <label htmlFor="public-display-name">표시 이름</label>
      <input
        id="public-display-name"
        maxLength={50}
        onChange={(event) => workflow.setDisplayName(event.target.value)}
        required
        value={workflow.displayName}
      />

      <fieldset>
        <legend>프로필 상태</legend>
        <label>
          <input
            checked={workflow.visibility === 'hidden'}
            name="profile-visibility"
            onChange={() => workflow.setVisibility('hidden')}
            type="radio"
          />
          숨김 — 외부 프로필 주소에서 찾을 수 없음
        </label>
        <label>
          <input
            checked={workflow.visibility === 'public'}
            name="profile-visibility"
            onChange={() => workflow.setVisibility('public')}
            type="radio"
          />
          공개 — 전체 공개 컬렉션만 프로필에 표시
        </label>
      </fieldset>

      <div className={styles.actions}>
        <button disabled={!canSave} type="submit">{workflow.saving ? '저장 중…' : '프로필 저장'}</button>
        {workflow.profile?.visibility === 'public' && (
          <a href={`/people/${workflow.profile.handle}`}>내 공개 프로필 보기</a>
        )}
      </div>
    </form>
    {workflow.error !== undefined && <div className={styles.error} role="alert">
      <span>{workflow.error}</span>
      <button onClick={() => void workflow.retry()} type="button">다시 시도</button>
    </div>}
    <aside>
      <strong>외부 검색엔진에는 노출하지 않습니다.</strong>
      <span>공개 상태여도 직접 링크로 접근하며, `unlisted` 컬렉션은 이 프로필에 나타나지 않습니다.</span>
    </aside>
  </section>
}
