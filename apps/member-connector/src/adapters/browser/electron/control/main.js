const status = document.getElementById('status')
let sequence = 0
for (const action of ['login', 'collect', 'cancel']) {
  document.getElementById(action).addEventListener('click', async () => {
    const request = ++sequence
    status.textContent = action === 'login' ? 'NAVER 창에서 직접 로그인한 뒤 그 창을 닫아 주세요.'
      : action === 'collect' ? '목록과 기본 장소 정보를 읽고 있습니다. 상세정보는 수집하지 않습니다.' : '취소 중입니다.'
    try {
      const result = await window.gotgotganDesktop[action]()
      if (request !== sequence) return
      status.textContent = result.state === 'collected'
        ? `${result.summary.listCount}개 목록 · ${result.summary.itemCount}개 장소 항목 · 식별자 미확인 ${result.summary.missingIdentityCount}개. 로컬 수집 확인 완료 — 서버에는 저장하지 않았습니다.`
        : result.message
    } catch {
      if (request === sequence) status.textContent = '작업을 실행하지 못했습니다. 앱을 다시 열어 확인해 주세요.'
    }
  })
}
