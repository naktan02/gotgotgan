# Browser Auth

`@place/browser-auth`는 곳곳간 사용자 Web과 관리자 Web이 함께 사용하는 confidential OIDC
Browser-BFF Module이다. 이 패키지는 인증 거래와 세션의 암호화된 PostgreSQL 저장, Authorization
Code + PKCE Provider Adapter, secret-file 기반 runtime 설정, process lifecycle과 검토된 HTTP 응답을
하나의 프레임워크 중립 Interface 뒤에 둔다. React와 Next.js를 import하지 않는다.

앱은 먼저 고유한 `BrowserAuthApplicationConfig`를 정의해야 한다. `storageNamespace`는 저장 payload의
AES-GCM AAD에 결합되고, `environmentPrefix`는 secret-file 환경변수 이름을 결정한다. 두 `__Host-`
cookie 이름과 `lifecycleKey`도 앱마다 달라야 한다. 따라서 같은 `localhost`에서 사용자 Web과 관리자
Web을 함께 실행해도 cookie와 process singleton이 충돌하지 않으며 한 앱의 암호화된 세션을 다른 앱이
해석할 수 없다.

```ts
import {
  createBrowserAuthApplication,
  defineBrowserAuthApplication,
} from '@place/browser-auth'

const config = defineBrowserAuthApplication({
  storageNamespace: 'place.admin-browser-auth.v1',
  environmentPrefix: 'PLACE_ADMIN',
  transactionCookieName: '__Host-place_admin_oidc_tx',
  sessionCookieName: '__Host-place_admin_session',
  lifecycleKey: 'place.admin-web.oidc.lifecycle',
})

export const browserAuth = createBrowserAuthApplication(config)
```

Next.js `instrumentation.ts`의 Node runtime 분기에서 `browserAuth.install(process.env)`을 await하고,
얇은 Route Handler는 `browserAuth.http.start()`, `callback(request)`, `logout(request)`만 호출한다.
Next 공식 lifecycle에 따라 `register`가 끝나기 전에는 서버가 요청을 받지 않는다. access token과
refresh token은 PostgreSQL의 인증된 암호문에만 저장되며 browser에는 opaque session ID만 전달한다.

환경변수 이름은 `<environmentPrefix>_...`로 만들어진다. 사용자 Web의 기존 `PLACE_*` 이름을
보존하려면 prefix로 `PLACE`를 사용한다. 활성화, secret-file, TTL, pool, retry, cleanup 설정의 suffix는
기존 `PLACE_OIDC_*` 및 `PLACE_DATABASE_URL_FILE`과 동일하다. HTTP issuer/callback 예외는 명시적으로
활성화된 loopback 주소에만 허용한다.

```powershell
npm run check --workspace @place/browser-auth
```
