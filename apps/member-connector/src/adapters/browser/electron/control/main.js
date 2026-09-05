const status = document.getElementById('status')
let sequence = 0
let collecting = false
for (const action of ['collect', 'cancel']) {
  document.getElementById(action).addEventListener('click', async () => {
    if (action === 'collect' && collecting) return
    if (action === 'collect') {
      collecting = true
      document.getElementById('collect').disabled = true
    }
    const request = ++sequence
    status.textContent = action === 'collect' ? '로그인 상태를 확인하고 기본 정보를 수집합니다. 로그인 창이 열리면 직접 인증해 주세요. 인증 확인 후 자동으로 계속합니다.' : '취소 중입니다.'
    try {
      const result = await window.gotgotganDesktop[action]()
      if (request !== sequence) return
      status.textContent = result.state === 'collected'
        ? `${result.summary.listCount}개 목록 · ${result.summary.itemCount}개 장소 항목 · 식별자 미확인 ${result.summary.missingIdentityCount}개. 로컬 수집 확인 완료 — 서버에는 저장하지 않았습니다.`
        : result.message
    } catch {
      if (request === sequence) status.textContent = '작업을 실행하지 못했습니다. 앱을 다시 열어 확인해 주세요.'
    } finally {
      if (action === 'collect') {
        collecting = false
        document.getElementById('collect').disabled = false
      }
    }
  })
}
