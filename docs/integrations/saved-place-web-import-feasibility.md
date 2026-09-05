# 저장 장소 웹 가져오기 가능성

조사일: 2026-09-05

상태: shared-link primary 제안, remote-browser beta `integration-gated`

이 문서는 설치 없는 웹서비스에서 NAVER·Google·Kakao 저장목록을 가져오고 내보낼 수 있는 범위를
정리한다. 로그인한 사용자 브라우저 화면에 데이터가 보인다는 사실과 곳곳간 서버가 그 데이터를 읽을
수 있다는 사실은 다르다. 동일 출처 정책 때문에 곳곳간 Web JavaScript는 Provider 응답이나 cookie를
직접 읽을 수 없고, 서버는 사용자 PC의 기존 browser session을 자동 재사용할 수 없다.

## 결론 요약

| Provider | 비공개 계정 전체 목록 | 공개·공유 목록 | 공식 권한 위임·파일 | 보존 가능한 정보 | 사용자 동작·위험 | Provider로 내보내기 |
| --- | --- | --- | --- | --- | --- | --- |
| NAVER | 공식 공개 API는 확인되지 않았다. 격리된 원격 브라우저에서 사용자가 다시 로그인하는 beta 후보만 있으며 live 미검증이다. | 일부 공개·전체 공개의 **특정 목록 한 개**를 링크로 읽는 경로를 실제 비로그인 서버 요청에서 관찰했다. 계정 전체가 아니다. 여러 링크 batch가 기본안이다. | NAVER Login scope와 공개 API 목록에서 저장목록 읽기·일괄 export를 찾지 못했다. | 목록 이름·순서, bookmark/place 식별자, 이름·주소·분류·좌표, item 메모·URL을 관찰했다. 현재 v1 normalizer는 메모·URL과 목록 메모를 버리므로 새 계약 전에는 보존을 약속하지 않는다. | 공유 링크 붙여넣기와 검토·승인. 내부 JSON은 비공개 계약이라 drift·rate-limit 위험이 높다. 비공개 전체는 beta 원격 창에서 재로그인이 필요하다. | 공식 Saved List write/export API는 미확인이다. 곳곳간 파일 다운로드만 별도 검토한다. |
| Google Maps | 일반 Maps Platform/OAuth로 Saved Lists 전체 읽기는 확인되지 않았다. | 공개·공유 목록 UI는 있으나 안정된 서버용 목록 계약은 이번 범위에서 확인하지 못했다. | Google Takeout이 Saved 데이터를 export한다. Data Portability의 `saved.collections` scope도 있지만 현재 지원 지역 목록에 대한민국이 없고 제한된 scope 보안 심사 등 적용 조건이 있다. | Data Portability schema는 collection title/description, saved item title·note·content URL·tags·comment를 문서화한다. Provider place ID·좌표와 Takeout 실제 필드는 fixture 전까지 미확인이다. | Takeout 파일 선택·업로드가 현실적인 첫 경로다. 사용자는 export 생성과 파일 전달을 해야 하며 개인정보·보존 고지가 필요하다. | Google My Maps의 CSV/KML/KMZ import/export는 Saved Lists와 다른 제품이다. Saved Lists write 지원으로 설명하지 않는다. |
| KakaoMap | Kakao Login과 Local API에서 개인 즐겨찾기 전체 읽기 scope를 찾지 못했다. | 공식 블로그에 폴더 공유 기능은 확인되지만 구조화된 server-side 수집은 미확인이다. 공개 UI 접근만으로 JSON 계약을 가정하지 않는다. | 공식 개인 즐겨찾기 export나 권한 위임은 확인되지 않았다. Local API는 장소 검색·보강용이지 회원 즐겨찾기 조회가 아니다. | 공유 UI의 목록명·장소 표시는 가능성이 있으나 안정된 ID·좌표·메모 보존은 실제 허용 검증 전까지 미확인이다. | 현재는 capability를 disabled로 둔다. 링크 parser나 파일 형식을 관찰·승인한 뒤 별도 Adapter를 만든다. | 공식 즐겨찾기 write/export는 미확인이다. |

## NAVER 확인 근거

NAVER 공식 도움말은 목록에 비공개·일부 공개·전체 공개가 있고 일부 공개 이상은 링크로 공유할 수
있다고 설명한다. [목록 공개 범위](https://help.naver.com/service/5637/contents/21478),
[리스트 공유·저장](https://help.naver.com/service/5637/contents/21479?lang=ko&osType=COMMONOS)

2026-09-05 허용된 비로그인 서버 probe에서 사용자가 제공한 `https://naver.me/F1a9Q07D`는 공유 폴더로
redirect됐고, 해당 공유 식별자의 bookmark endpoint는 HTTP 200 JSON과 마지막 page까지의 pagination을
반환했다. 같은 환경에서 비공개 account folder endpoint는 로그인 필요 응답이었다. 이는 **이 링크로
공개된 특정 목록**의 현재 실관찰 근거이지, 문서화된 외부 API·계정 전체 접근·지속 호환성의 증거가
아니다. URL 수신은 redirect 횟수, exact host/path, DNS 재확인, private·loopback·link-local·metadata
주소 차단, timeout, 응답 크기, content type, item/page 상한을 적용해야 한다.

NAVER Login은 프로필 회원정보 API이며 지도 저장목록 scope를 문서화하지 않는다.
[NAVER 로그인 API](https://developers.naver.com/docs/login/api/api.md),
[NAVER 공개 API 목록](https://developers.naver.com/docs/common/openapiguide/apilist.md)

## Google 확인 근거

Google Maps 도움말은 Saved places를 Google Takeout으로 내보내는 절차를 안내한다.
[Google Maps 데이터 다운로드](https://support.google.com/maps/answer/7280933?hl=en-AU)
Google Data Portability는 Saved collections scope와 export schema를 문서화하지만, 지역 가용성과
개발자 verification·restricted scope 심사를 통과해야 한다.
[Data Portability scopes](https://developers.google.com/data-portability/user-guide/scopes?hl=en),
[Saved schema](https://developers.google.com/data-portability/schema-reference/save),
[지역 가용성](https://support.google.com/accounts/answer/14452558?hl=en)

My Maps는 CSV·KML·KMZ의 import/export를 지원하지만 Google Maps Saved Lists와 다른 데이터 모델이다.
[My Maps 가져오기](https://support.google.com/mymaps/answer/3024836?co=GENIE.Platform%3DDesktop&hl=en-GB),
[My Maps 내보내기](https://support.google.com/mymaps/answer/3109452?co=GENIE.Platform%3DDesktop&hl=en)

## Kakao 확인 근거

Kakao의 공식 Kakao Login·Kakao Local 문서에서 개인 즐겨찾기 목록 scope는 확인되지 않았다.
[Kakao Login REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api),
[KakaoMap REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api)
KakaoMap 공식 블로그에는 폴더 공유 기능이 소개돼 있다.
[즐겨찾기 폴더 공유](https://kakaomap.tistory.com/171?category=197647),
[공유 기능 업데이트](https://kakaomap.tistory.com/320)

2026-09-05 공개 UI는 열렸지만 추정한 내부 JSON 요청은 거부됐다. 승인된 endpoint·schema·pagination을
실제로 확인하기 전까지 공유 링크 수집은 `unavailable`이다.

## 제품 및 데이터 경계

- 기본 UI는 NAVER 공유 링크를 여러 개 붙여넣고 링크별 발견 목록·항목 수와 실패 이유를 확인한 뒤
  가져올 항목을 검토·승인한다. 링크 소유자나 Provider 계정 소유를 인증했다고 표시하지 않는다.
- 공유 응답의 profile 설명과 목록·item 메모에는 개인정보가 있을 수 있다. raw response는 처리에 필요한
  짧은 기간만 암호화 보관하고, 로그·trace·오류에는 넣지 않는다. 계약에 allowlist되지 않은 필드는
  버린다.
- 파일 입력은 확장자보다 magic/content를 확인하고 압축폭탄·CSV formula·경로 traversal·대형 파일을
  거부한다. 원본 보존 기간과 삭제 시점, 파생 snapshot 보존을 업로드 전에 고지한다.
- Provider 메모는 별도 provenance 필드다. 개인 Note로 자동 변환하거나 장소 유형·세부 음식 분류·Tag와
  섞지 않는다.
- fixture·unit·synthetic 브라우저 테스트는 source-only 구현 성공이다. 실제 외부 성공은 승인된 live
  계정/공유본에서 인증, pagination, schema, drift, 제한, session 폐기까지 증거가 남았을 때만 보고한다.
