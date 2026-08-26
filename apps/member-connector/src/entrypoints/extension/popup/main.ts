import { browser } from 'wxt/browser'

import {
  hasProviderOriginPermission,
  requestProviderOriginPermission,
} from '../../../adapters/browser/webextensions/provider-origin-permissions.js'

const buttonElement = document.querySelector<HTMLButtonElement>('#allow-naver')
const statusElement = document.querySelector<HTMLElement>('#naver-status')
if (buttonElement === null || statusElement === null) {
  throw new Error('NAVER permission controls are missing')
}
const button = buttonElement
const status = statusElement

async function renderPermission(): Promise<void> {
  const allowed = await hasProviderOriginPermission(browser.permissions, 'naver')
  button.disabled = allowed
  button.textContent = allowed ? 'NAVER 접근 허용됨' : 'NAVER 접근 허용'
  status.textContent = allowed
    ? 'Place로 돌아가 가져오기를 다시 실행하세요.'
    : '버튼을 누르면 Chrome의 NAVER 사이트 접근 권한 창이 열립니다.'
}

button.addEventListener('click', () => {
  button.disabled = true
  status.textContent = 'Chrome 권한 응답을 기다리는 중입니다.'
  void requestProviderOriginPermission(browser.permissions, 'naver')
    .then(async (allowed) => {
      if (allowed) {
        await renderPermission()
        return
      }
      button.disabled = false
      status.textContent = 'NAVER 사이트 접근 권한이 허용되지 않았습니다.'
    })
    .catch(() => {
      button.disabled = false
      status.textContent = '권한 요청을 열지 못했습니다. 다시 시도해 주세요.'
    })
})

void renderPermission()
