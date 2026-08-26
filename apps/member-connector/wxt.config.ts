import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  entrypointsDir: 'entrypoints/extension',
  imports: false,
  manifestVersion: 3,
  manifest: ({ browser }) => {
    const placeOrigin = new URL(process.env.WXT_PLACE_CONNECTOR_PUBLIC_ORIGIN!).origin
    return {
    name: 'Place Connector',
    description: '현재 브라우저 세션으로 개인 장소 목록을 Place에 연결합니다.',
    permissions: ['storage'],
    host_permissions: [`${placeOrigin}/*`],
    optional_host_permissions: ['https://pages.map.naver.com/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: process.env.WXT_PLACE_CONNECTOR_FIREFOX_ID,
              data_collection_permissions: { required: ['websiteContent'] },
            },
          },
        }
      : {}),
    }
  },
})
