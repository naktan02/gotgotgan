# NAVER 저장 장소 가져오기 조사

조사일: 2026-08-26

이 문서는 Stage 7에서 NAVER 지도 저장 리스트를 Place로 가져오는 방법을 선택하기 위한 근거다.
공식 공개 문서와 비로그인 상태에서 확인 가능한 자료를 우선했고, 내부 HTTP에 관한 제3자 자료는
구현 후보를 찾는 보조 근거로만 사용했다. 개인 계정, 쿠키, 비밀번호, 실제 저장 장소, 비공개
리스트는 조사에 사용하지 않았다.

후속 실관찰에서 새 Playwright profile은 사용자가 평소 쓰는 browser의 로그인 상태를 재사용하지
못하는 것으로 확인됐다. 따라서 이 문서의 전용-profile 절차는 진단 방법으로만 남고, 제품 경계는
ADR 0012의 current-session Place Connector 확장으로 변경됐다.

## 결론

NAVER가 공개한 개발자 API와 지도 고객센터에는 저장 리스트를 CSV, Excel, JSON으로 일괄
내보내거나 파일로 가져오는 기능과 저장 목록 조회 API가 문서화되어 있지 않다. NAVER Login
OAuth도 지도 저장 목록 접근 권한을 제공하지 않는다. 따라서 Stage 7은 OAuth 토큰으로 목록을
조회하는 일반적인 connected-account 연동으로 만들 수 없다.

현재 가장 가능성이 높은 경로는 다음 순서다.

1. 사용자가 직접 만든 일부 공개·전체 공개 리스트의 공유 링크를 입력하는 무상태 가져오기를
   먼저 탐색한다.
2. 비공개 목록은 사용자가 현재 로그인한 browser profile에 설치한 Place Connector 확장에서
   first-party 구조화 응답을 읽는다. session 만료 때만 Provider 로그인 탭에서 사용자가 재인증한다.
3. 인증·페이지네이션·스키마가 fixture로 확인되면 확장의 NAVER `SavedPlaceSource` Adapter가 같은
   browser session 안에서 제한된 HTTP 수집을 수행하고 일회성 Place grant로 bounded batch를 제출한다.
4. 구조화 응답을 사용할 수 없거나 일부 필드가 빠질 때만 접근성 트리와 DOM 파서를 보조
   어댑터로 사용한다.
5. Playwright UI 조작은 진단, fixture/replay, 확장 E2E, opt-in live smoke와 최후 fallback을 담당한다.
   Crawlee는 이 추출 순서를 대신하지 않고 서버 소유 상세 보강의 queue·retry·concurrency를 제공하는
   worker 내부 실행 도구로만 사용한다.

이 순서는 `providers`의 NAVER 어댑터가 외부 형식을 소유하고, `ingestion`이 ImportBatch,
ImportItem, Observation, 정규화·중복 검토를 소유하며, worker가 브라우저·queue의 수명주기를
소유하는 현재 모듈 경계를 유지한다. interactive suggestion session이나 Search의 Discovery
Projection은 재사용하지 않는다.

## 공식 기능과 한계

### 저장 목록 자체

NAVER 지도는 로그인 상태에서 장소를 저장하고, 기본 `내 장소` 외에 리스트를 만들며, 장소별
별명·메모·관련 URL을 기록할 수 있다. 공식 한도는 전체 장소 5,000개, 리스트 400개, 리스트당
1,000개, 기본 리스트 2,000개이며 같은 장소는 최대 10개 리스트에 저장할 수 있다.
([저장 기능 이용방법](https://help.naver.com/service/5637/contents/692?lang=ko),
[저장 가능한 개수](https://help.naver.com/service/5637/contents/8264?lang=ko&osType=COMMONOS))

리스트 공개 범위는 비공개·일부 공개·전체 공개다. 일부 공개 이상은 링크로 공유할 수 있고,
받은 사람은 공유 리스트를 NAVER 지도에 저장할 수 있다. 다만 공식 문서는 이 저장이 원본을
계속 참조하는지, 당시 내용을 복사하는지, 외부 프로그램이 읽을 수 있는 데이터 형식을
제공하는지 설명하지 않는다.
([공개 범위](https://help.naver.com/service/5637/contents/21478?lang=ko&osType=COMMONOS),
[리스트 공유·저장](https://help.naver.com/service/5637/contents/21479?lang=ko&osType=COMMONOS))

저장 장소가 폐업하거나 이전한 경우 NAVER 지도는 삭제 또는 새 위치로 갱신하는 UI를 제공한다.
따라서 import 응답에 `available`, mismatch, 이전 후보와 비슷한 신호가 있더라도 Place가 이를
canonical truth로 덮어쓰지 않고 시점이 있는 observation으로 보관해야 한다.
([저장 장소 최신정보 관리](https://help.naver.com/service/5637/contents/24333?osType=MOBILE))

공식 지도 저장 도움말 전체와 공개 API 목록에서 다음 항목은 찾지 못했다.

- 저장 리스트의 CSV·Excel·JSON 일괄 다운로드
- 파일을 이용한 저장 리스트 일괄 업로드
- 로그인 사용자의 리스트·북마크 조회, 추가, 삭제 API
- NAVER Login으로 지도 저장 데이터에 접근하는 공개 scope

이는 “공식 공개 계약으로 확인되지 않았다”는 뜻이다. 비공개 제휴 API나 first-party 웹 내부
endpoint의 존재까지 부정하는 주장은 아니다.
([지도 저장 도움말 목록](https://help.naver.com/service/5637/category/3604?lang=ko),
[NAVER 공개 API 목록](https://developers.naver.com/docs/common/openapiguide/apilist.md))

### NAVER Login OAuth

NAVER Login 공개 명세는 인증, 접근 토큰 발급·갱신·폐기와 회원 프로필 조회를 제공한다. 문서의
로그인 오픈 API 목록은 프로필, 카페, 캘린더이며, 인증 요청의 `scope`도 외부 서비스가 지도
권한을 요청하는 값이 아니라 전송할 필요가 없는 내부 구분값으로 설명되어 있다. 지도 저장
목록 endpoint는 없다.
([NAVER Login API 명세](https://developers.naver.com/docs/login/api/api.md),
[회원 프로필 조회](https://developers.naver.com/docs/login/profile/profile.md))

그러므로 Place의 공통 OIDC 로그인과 NAVER 지도 브라우저 세션은 다른 연결이다. NAVER Login
access token을 지도 쿠키처럼 사용하거나, 공통 Identity에 NAVER 비밀번호·쿠키·프로필을
저장해서는 안 된다.

### 공식 Local Search의 보조 역할

신규 Search API 신청은 2026-07-31부터 NAVER API HUB를 사용한다. 기존 NAVER Developers
신청자는 2027-06-30까지 유예되지만 endpoint와 인증 헤더가 바뀌므로 Stage 7이 공식 검색을
보조 검증에 사용한다면 HUB 구성을 기준으로 해야 한다.
([이관 공지](https://developers.naver.com/notice/article/32530),
[이관 가이드](https://guide.ncloud-docs.com/docs/apihub-migration))

현재 Local Search 문서는 한 요청에 1~5개, `start=1`, 이름·상세 URL·분류·설명·주소·WGS84
좌표를 제공하며, 전화번호는 하위 호환용 빈 필드라고 명시한다. 안정적인 NAVER place ID,
영업시간, 사진, 평점, 메뉴는 문서화하지 않는다. 따라서 이 API는 import된 이름·주소·좌표를
보조 확인하는 데 사용할 수 있지만 저장 항목의 동일성이나 저장 리스트를 복원할 수 없다.
([NAVER API HUB 지역 검색](https://api.ncloud-docs.com/docs/naver-api-hub-search-local))

문서 사이 호출 한도 표현에는 차이가 있다. 지역 검색 API 페이지는 일 25,000회를 말하지만,
HUB 개요 FAQ는 NAVER 검색 통합 월 775,000회와 API key당 50 RPS를 말한다. 활성화 전 콘솔의
실제 상품 한도와 응답 헤더를 다시 확인하고, 코드에 수치를 상수로 고정하지 않는다.
([HUB 개요 FAQ](https://guide.ncloud-docs.com/docs/apihub-overview))

## 수집 경로 비교

| 경로 | 현재 근거 | 얻을 수 있는 범위 | 주요 한계 | 권장 위치 |
|---|---|---|---|---|
| 공식 export/upload | 공식 문서에서 확인되지 않음 | 없음 | 기능·포맷·지원 계약 없음 | 지원하지 않되 capability를 `unavailable`로 명시 |
| 공유 링크 | NAVER가 일부 공개·전체 공개 리스트의 링크 공유와 저장을 공식 지원 | 공개된 리스트 메타데이터와 장소 후보 | 비공개 목록 불가, 응답 스키마·snapshot/reference 의미 미확인 | 가장 먼저 탐색할 무상태 NAVER adapter |
| 관찰한 구조화 HTTP | 2025년 제3자 재현 자료에 folder와 bookmark JSON 형태의 first-party 경로가 제시됨 | 리스트, 장소명, 좌표, 주소, 메모, 분류, 시각, 상태로 보이는 필드 | 비공개·비문서 endpoint, 인증·CSRF·페이지네이션·ID 안정성·rate limit 미보장 | 로그인 브라우저에서 먼저 관찰하고 fixture로 승인된 뒤 사용 |
| 직접 HTTP 재생 | 위 구조화 응답이 현재 계정·화면에서 확인된 뒤에만 가능 | DOM보다 완전하고 안정적인 후보 데이터 | 웹 계약 변경, 세션 만료, 헤더·쿠키 종속성 | 브라우저 context의 인증을 쓰는 bounded leaf adapter |
| 접근성 트리·DOM | Playwright가 role locator와 ARIA snapshot을 공식 지원 | 화면에 실제 표시되는 리스트·항목·상태 | 가상 스크롤, 축약 텍스트, locale/layout 변경, 숨겨진 필드 누락 | 구조화 응답의 보조·fallback parser |
| Playwright UI | 로그인·MFA·동의와 실제 저장 UI를 다룰 수 있음 | 사용자와 같은 범위의 동작 | 가장 느리고 변동성이 크며 사람 개입이 필요 | profile lifecycle과 최후 fallback |
| Crawlee | RequestQueue, 제한된 재시도·동시성, PlaywrightCrawler 제공 | 다수 목록·페이지의 작업 배분과 재개 | NAVER 스키마를 알아내거나 MFA를 해결하지 않음 | worker orchestration; extractor나 인증 소유자 아님 |

구조화 HTTP의 근거는 공식 계약이 아니라 2025년 제3자 글이다. 이 글은 로그인 후
`pages.map.naver.com`의 `maps-bookmark/v3` 계열 folder와 bookmark JSON을 조회하고, 응답에
`shareID`, `bookmarkId`, `sid`, 이름, 좌표, 주소, 메모, 분류, 시각, 사용 가능 상태로 보이는
필드가 있었다고 기록한다. 이 조사는 endpoint를 개인 계정으로 재호출하지 않았으므로 현재
동작, 인증 범위, 필드 의미는 모두 미검증이다.
([2차 자료: 2025년 저장 목록 JSON 추출 사례](https://kimhongsi.tistory.com/entry/%EB%84%A4%EC%9D%B4%EB%B2%84%EC%A7%80%EB%8F%84-%EC%A6%90%EA%B2%A8%EC%B0%BE%EA%B8%B0-%EB%A6%AC%EC%8A%A4%ED%8A%B8-%EB%82%B4%EB%B3%B4%EB%82%B4%EA%B8%B0%ED%95%B4%EC%84%9C-%EC%97%91%EC%85%80%EB%A1%9C-%EC%A0%80%EC%9E%A5%ED%95%98%EA%B8%B0QGIS%EB%A1%9C-%EB%82%98%EB%A7%8C%EC%9D%98-%EC%A7%80%EB%8F%84-%EB%A7%8C%EB%93%A4%EA%B8%B0))

Playwright는 request·response event와 `waitForResponse`로 화면 동작에 대응하는 구조화 응답을
관찰할 수 있고, role locator와 ARIA snapshot으로 접근성 구조를 추출할 수 있다.
([Playwright network](https://playwright.dev/docs/network),
[locators](https://playwright.dev/docs/locators),
[ARIA snapshots](https://playwright.dev/docs/aria-snapshots))

Crawlee RequestQueue는 request의 `uniqueKey` 중복을 막고 처리 성공·reclaim 상태를 다룰 수 있으며,
PlaywrightCrawler는 최대 요청 수·분당 요청 수·동시성·재시도를 제한할 수 있다. 그러나 Stage 7의
ImportBatch/ImportItem이 사용자에게 보이는 durable truth여야 한다. Crawlee의 로컬 queue나
SessionPool을 그 대신 사용하지 않는다. 특히 한 사용자 계정의 프로필을 임의 세션 rotation이나
proxy rotation 대상으로 만들면 안 된다.
([Crawlee RequestQueue](https://crawlee.dev/js/api/3.15/core/class/RequestProvider),
[PlaywrightCrawler options](https://crawlee.dev/js/api/3.15/playwright-crawler/interface/AdaptivePlaywrightCrawlerOptions),
[SessionPool](https://crawlee.dev/js/api/3.15/core/class/SessionPool))

## 로그인·프로필 수명주기

NAVER 공식 도움말에 따르면 로그인 상태 유지는 쿠키 삭제·로그아웃 전까지 계속될 수 있지만,
같은 PC에서 2주 동안 NAVER를 사용하지 않으면 해제될 수 있다. 2단계 인증은 등록된 스마트
기기의 NAVER 앱 승인을 요구하며, 신뢰 브라우저 설정도 쿠키 삭제나 등록 기기 변경 시 풀린다.
([로그인 상태 유지](https://help.naver.com/service/5640/contents/19013?lang=ko&osType=COMMONOS),
[2단계 인증](https://help.naver.com/service/5640/contents/19238?lang=ko&osType=MOBILE),
[신뢰 브라우저](https://help.naver.com/service/5640/contents/9236?lang=ko&osType=COMMONOS))

타지역·해외 IP 차단은 휴대전화나 이메일 추가 확인을 요구할 수 있고, 비정상 로그인 탐지는
계정 보호와 본인 인증으로 이어질 수 있다. 반복적인 검색 패턴은 CAPTCHA가 필요한 검색 제한을
일으킬 수 있다. worker는 이를 일반 network retry로 처리하지 않고 사람 개입 상태로 분류한다.
([로그인 지역 차단](https://help.naver.com/service/5640/contents/1848?lang=ko&osType=COMMONOS),
[계정 보호조치](https://help.naver.com/service/5640/contents/1117?osType=COMMONOS),
[검색 제한](https://help.naver.com/service/5626/contents/992?lang=ko&osType=COMMONOS),
[로그인 CAPTCHA](https://help.naver.com/service/5640/contents/21449?lang=ko&osType=COMMONOS))

후속 ADR 0012가 정한 회원 Connector의 권장 상태는 다음과 같다.

```text
disconnected
  -> active
  -> reauth_required
  -> active

active import
  -> authentication_required
  -> mfa_required
  -> captcha_required
  -> consent_required
  -> account_protected
  -> rate_limited
  -> parser_drift
  -> cancelled
```

- 사용자는 현재 브라우저의 실제 NAVER 탭에서 직접 로그인한다. Place는 NAVER 비밀번호나 MFA 값을
  받지 않는다.
- Place connection은 무작위·회전 가능한 Connector 설치 참조와 안전한 상태만 소유하고 실제
  profile·storage state를 복사하거나 저장하지 않는다.
- Import lease/fencing은 서버의 ImportBatch와 upload grant에 적용한다. 브라우저 profile을 서버
  worker lease 대상으로 만들지 않는다.
- 사람 개입 상태에서는 확장 수집을 중지하고 사용자가 같은 브라우저에서 해결한 후 새 operation
  grant로 재개한다. CAPTCHA·MFA·보호조치를 자동 우회하지 않는다.
- 연결 해제는 새 Place 작업과 grant를 막고 활성 Import를 취소하지만 NAVER profile과 cookie는
  삭제하지 않는다.

Playwright도 authentication state 파일이 cookie와 header를 포함해 계정 사칭에 사용될 수 있으므로
저장소에 commit하지 말라고 경고한다. fixture에는 실제 storage state를 넣지 않는다.
([Playwright authentication](https://playwright.dev/docs/auth),
[BrowserContext storage state](https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state))

## 식별자와 멱등성

공식 문서는 NAVER 저장 리스트·북마크의 안정 ID를 정의하지 않는다. 2차 자료의 `shareID`,
`bookmarkId`, `sid`는 유용한 관찰값이지만 다음처럼 취급한다.

- `shareID`: 공개 링크 또는 관찰한 리스트의 provider collection key 후보. 공개 범위 변경이나
  재공유 뒤에도 유지된다고 가정하지 않는다.
- `bookmarkId`: 한 저장 행의 provider item key 후보. 같은 장소를 여러 리스트에 저장했을 때
  전역 장소 ID라고 가정하지 않는다.
- `sid`: NAVER 장소 identity 후보. 형식·재사용·이전·폐업 시 의미가 공식 보장되지 않으므로
  canonical Place ID로 사용하지 않는다.
- 공식 Local Search 결과: 문서화된 place ID가 없으므로 title·주소·좌표·link를 조합한 결과
  fingerprint만 만들고 provider identity를 발명하지 않는다.

ImportItem의 멱등 key는 가능한 경우 `connection + source collection key + provider item key`를
사용하고, ID가 없을 때는 parser version과 정규화 전 source tuple의 deterministic fingerprint를
사용한다. 같은 provider key가 다른 payload로 다시 오면 성공 재생으로 덮지 않고 새 Observation
또는 conflict/review 상태로 남긴다. canonical 연결은 기존 Ingestion resolution을 통해서만 한다.

## 권장 어댑터 순서

### 1. 공유 링크 탐색

작은 synthetic 리스트를 일부 공개로 만들고, 로그아웃 브라우저에서 링크 접근 가능 여부,
목록 페이지네이션, 공개 필드, 원본 변경 전파 여부를 확인한다. 성공하면 별도 프로필 없이 쓸 수
있는 `shared-list` capability로 둔다. 공유 링크는 bearer-like secret일 수 있으므로 원문 URL을
로그에 남기지 않고 정규화·해시된 reference만 보존한다.

### 2. 로그인 브라우저의 구조화 응답 관찰

진단 단계에서는 사용자가 직접 로그인한 전용 profile에서, 제품 단계에서는 현재-session 확장의
NAVER Adapter에서 저장 탭과 리스트 하나를 열고 response의 host, path
shape, method, status, content type, pagination, schema만 기록한다. request cookie, 인증 header,
사용자 ID, 실제 URL token은 수집 전에 redaction한다. 하나의 화면 동작과 하나의 response를
연결해 parser fixture를 만든다.

### 3. bounded HTTP adapter

구조화 response가 반복 확인되면 NAVER adapter 내부에서만 endpoint template과 parser를 둔다.
endpoint를 일반 HTTP runner의 임의 URL 입력으로 노출하지 않는다. allowlisted HTTPS host,
응답 크기, 페이지 수, 전체 item 수, timeout, 최소 delay, backoff, cancel을 강제한다. 401·403,
로그인 HTML, CAPTCHA 문구, 예상하지 못한 content type은 각각 분류하고 자동 재시도하지 않는다.

### 4. 접근성·DOM fallback

구조화 필드가 없을 때만 role·accessible name을 우선하고 CSS selector는 가장 좁은 NAVER leaf에
둔다. 리스트 header, item row, 다음 page 또는 scroll sentinel의 ARIA snapshot을 fixture로
고정한다. 표시된 이름·주소가 축약되면 완전한 값으로 추정하지 않고 incomplete observation으로
보낸다.

### 5. Playwright/Crawlee 실행

Playwright는 진단, NAVER UI/network 관찰, fixture/replay, 확장 E2E와 통제된 DOM fallback을 담당한다.
Crawlee는 서버 소유 상세 보강에서 여러 요청을 처리할 필요가 실제로 확인된 뒤 RequestQueue와 제한된
retry만 추가한다. 회원 browser session의 folder pagination은 확장의 Provider Adapter가 담당하고
Crawlee SessionPool로 계정을 회전하지 않는다.

## Fixture capture 지침

live capture는 기본 테스트가 아니라 명시적으로 켜는 opt-in 작업이어야 한다. 전용 테스트 계정과
민감하지 않은 synthetic 데이터만 사용한다.

최소 fixture matrix:

- 비공개, 일부 공개, 전체 공개 리스트 각 1개
- 빈 리스트와 2페이지 이상이 필요한 리스트
- 동일 장소를 두 리스트에 저장한 경우
- synthetic 별명·메모·관련 URL이 있는 항목과 없는 항목
- 좌표·주소가 있는 place와 지원되는 다른 저장 type
- NAVER가 폐업 또는 이전으로 표시하는 공개 테스트 장소가 있을 경우 그 상태
- 정상, 빈 목록, 부분 응답, 401/403, HTML login redirect, rate limit, parser drift

capture artifact에는 다음만 남긴다.

- capture 시각, provider, adapter/parser version, 화면 동작 이름
- 정규화한 method·host·path template·query key 목록, status, content type
- schema-aware redaction을 거친 response body
- original response의 checksum과 redacted artifact의 별도 checksum
- 선택한 response header와 pagination 정보
- parser outcome과 누락·미지원 필드 목록

반드시 제거하거나 synthetic 값으로 치환할 항목:

- Cookie, Authorization, CSRF, session, device, account, profile 식별값
- 개인 이름, 이메일, 전화번호, 사용자 ID와 profile image
- 실제 share/list/bookmark ID와 원문 공유 URL token
- 집·회사·생활 동선을 드러내는 장소, 좌표, 별명, 메모, 관련 URL
- screenshot과 HTML 속 계정 메뉴·알림·최근 검색·개인 리스트 이름

ID의 타입과 관계를 검증해야 할 때는 `list_test_001`, `bookmark_test_001`, `place_test_001`처럼
일관된 synthetic 값으로 바꿔 같은 ID가 여러 응답에서 반복되는 관계만 보존한다. raw 원본은
소스 저장소에 넣지 않으며, 꼭 필요한 짧은 조사 기간에만 암호화된 capture store에 보관하고
redaction 검토 뒤 삭제한다.

parser replay는 다음을 증명해야 한다.

1. 같은 fixture와 ImportBatch fingerprint를 재생하면 ImportItem과 Observation이 중복되지 않는다.
2. 한 item이 실패해도 이미 처리한 item은 유지되고 새 worker가 cursor부터 재개한다.
3. parser version이 바뀌면 같은 raw evidence를 새 parser로 재처리할 수 있다.
4. 필드 제거·타입 변경·HTML 응답은 `parser_drift` 또는 `authentication_required`로 분류되고
   빈 정상 결과로 저장되지 않는다.
5. fixture, log, external error, screenshot에 credential이나 실제 개인 데이터가 없다.

## 신뢰도와 남은 미확인 사항

| 판단 | 신뢰도 | 이유 |
|---|---|---|
| 공개 OAuth/API로 저장 목록을 읽을 수 없음 | 매우 높음 | NAVER Login 명세와 공개 API 목록에 지도 scope·endpoint가 없음 |
| 공식 bulk export/import가 문서화되지 않음 | 높음 | 지도 저장 도움말 전체가 UI 저장·공유·관리만 설명 |
| 공유 링크가 Stage 7의 무상태 입력 후보임 | 높음 | 일부 공개·전체 공개 링크 공유는 공식 지원; 외부 parser schema는 미확인 |
| `maps-bookmark/v3` 구조화 JSON 계열이 구현 후보임 | 중간 | 구체적인 2025년 재현 자료가 있으나 공식 계약과 이번 조사 live 검증이 없음 |
| `shareID`·`bookmarkId`·`sid`가 영구 안정 ID임 | 낮음 | 제3자 관찰 필드일 뿐 수명·scope·재사용 규칙이 문서화되지 않음 |
| DOM/accessibility만으로 모든 저장 필드를 복원 가능 | 낮음 | 현재 signed-in DOM, virtualization, 축약·숨김 필드를 확인하지 않음 |
| Crawlee가 초기 spike부터 필요함 | 낮음 | 추출 경로가 정해지기 전에는 queue가 불확실성을 줄이지 않음 |

구현 전에 반드시 답해야 할 미확인 사항:

- 공유 링크의 공개 응답에 list/item stable key와 pagination이 있는가
- 공유 리스트 저장이 snapshot, copy, live reference 중 무엇인가
- 로그인 목록 response의 현재 host/path, CSRF 요구, page size와 종료 조건은 무엇인가
- 같은 장소가 여러 리스트에 있을 때 `bookmarkId`와 `sid`의 반복 관계는 무엇인가
- 삭제, 폐업, 이전, unmatched, non-place item이 각각 어떻게 표현되는가
- 메모·별명·관련 URL 중 공개 범위와 response별 노출 범위는 무엇인가
- session 만료·MFA·CAPTCHA·동의 화면을 body/status/redirect/DOM 중 무엇으로 구분할 수 있는가
- 정상 empty response와 auth/parser failure를 확실히 구분할 invariant는 무엇인가

첫 live spike의 성공 기준은 전체 계정을 대량 수집하는 것이 아니다. synthetic 리스트 하나에서
구조화 응답 1개를 안전하게 redaction한 fixture로 만들고, 동일 replay, session 만료 분류,
parser drift 실패를 증명하면 다음 adapter 구현으로 진행할 수 있다.
