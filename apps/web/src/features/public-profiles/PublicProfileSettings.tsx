'use client'

import { usePublicProfileSettings, type PublicProfileSettingsWorkflow } from './public-profile-settings'
import styles from './public-profiles.module.css'

export function PublicProfileSettings() {
  const workflow = usePublicProfileSettings()
  return <PublicProfileSettingsView workflow={workflow} />
}

export function PublicProfileSettingsView({ workflow }: Readonly<{ workflow: PublicProfileSettingsWorkflow }>) {
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
      <p role="alert">프로필을 지금 불러올 수 없습니다. 프로필이 없다는 뜻은 아닙니다.</p>
      <button onClick={() => void workflow.reload()} type="button">다시 시도</button>
    </section>
  }
  if (workflow.loadState === 'forbidden') {
    return <section aria-labelledby="profile-settings-title" className={styles.settings}>
      <h1 id="profile-settings-title">공개 프로필</h1><p role="alert">현재 계정은 공개 프로필을 관리할 권한이 없습니다.</p>
    </section>
  }

  const handleValid = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(workflow.handle) &&
    workflow.handle.length >= 3 && workflow.handle.length <= 30
  const canSave = handleValid && workflow.displayName.trim().length > 0 &&
    workflow.displayName.length <= 50 && !workflow.saving

  return <section aria-labelledby="profile-settings-title" className={styles.settings}>
    <header>
      <h1 id="profile-settings-title">공개 프로필</h1>
      <span>공개 목록에 사용할 주소와 닉네임입니다. 로그인 정보와는 별개입니다.</span>
    </header>
    {workflow.profile === undefined && <p className={styles.empty} role="status">아직 공개 프로필이 없습니다. 아래에서 만들 수 있습니다.</p>}
    <form onSubmit={(event) => { event.preventDefault(); workflow.save() }}>
      <label htmlFor="public-handle">프로필 주소</label>
      <div className={styles.handleField}>
        <span>/people/</span>
        <input
          autoComplete="off"
          aria-describedby="public-handle-help"
          disabled={workflow.profile !== undefined}
          id="public-handle"
          maxLength={30}
          onChange={(event) => workflow.setHandle(event.target.value.toLowerCase())}
          pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])"
          required
          value={workflow.handle}
        />
      </div>
      <small id="public-handle-help">{workflow.profile === undefined
        ? '영문 소문자·숫자·하이픈 3~30자. 만든 뒤에는 주소를 바꿀 수 없습니다.'
        : '공유한 링크가 유지되도록 주소는 변경할 수 없습니다.'}</small>

      <label htmlFor="public-display-name">공개 닉네임</label>
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
      <strong>공개 범위를 확인해 주세요.</strong>
      <span>링크로만 공유한 목록과 비공개 목록은 프로필에 표시하지 않습니다. 검색엔진에는 색인하지 않도록 요청합니다.</span>
    </aside>
  </section>
}
