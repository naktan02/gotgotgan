# 0025: 웹 일회성 저장목록 가져오기를 제품 경계로 둔다

- 상태: accepted
- 날짜: 2026-09-05
- 대체: ADR 0012와 ADR 0024에서 회원 기기 Connector를 제품 가져오기 경계로 둔 부분

## 배경

곳곳간은 사용자가 별도 앱, 로컬 에이전트, 확장 프로그램을 설치하지 않는 웹서비스다. 로그인한 일반
브라우저가 가진 Provider cookie는 동일 출처 정책 때문에 곳곳간 JavaScript나 서버가 읽을 수 없다.
그러므로 회원 PC의 기존 로그인 session을 조용히 재사용하는 흐름을 제품 요구로 둘 수 없다.

반면 일부 Provider 목록은 공유 링크로 공개되며, 공급자가 제공하는 내보내기 파일이나 권한 위임도
Provider별로 사용할 수 있다. 비공개 전체 목록이 필요하면 사용자가 곳곳간 서버의 격리된 일회성
브라우저에 다시 로그인하는 선택지도 기술적으로 가능하다. 이 방식은 사용자의 로컬 session을 재사용하지
않고, 자격증명 입력과 원격 화면이 서비스 인프라를 통과하는 별도 보안 경계다.

기존 `transfers`의 SourceSnapshot 이후 선택·매칭 검토, 승인, 큐, 개인 Collection 반영은 획득 방식과
분리돼 있다. 다만 현재 snapshot과 v2 grant는 검증된 connection, account fingerprint, installation에
결속돼 있으므로 계정 소유를 확인하지 않은 일회성 입력에 그대로 사용할 수 없다.

## 결정

1. 회원 저장목록 가져오기는 설치 없는 웹 흐름만 제품 경로로 제공한다. `apps/member-connector`의
   Electron·Playwright·확장 코드는 parser와 수집 제약을 검증한 진단 자료로만 보존하며 배포 전제나 다음
   제품 단계가 아니다.
2. Provider와 획득 방법을 분리한다. 공통 application은 `Shared-link Import Batch`, `Export-file
   Import`, `Remote-browser Import Session` 같은 별도 versioned source 계약을 받고, Provider leaf가
   URL·redirect·응답 schema·파일 형식을 해석한다.
3. NAVER의 기본 경로는 여러 공유 링크를 한 번에 제출하는 `Shared-link Import Batch`다. 각 링크는
   링크로 공개된 특정 목록만 뜻하며 비공개 계정 전체 목록이나 계정 소유 증거가 아니다. 링크별 성공과
   실패를 독립적으로 표시하고, 모든 redirect와 outbound 요청에 SSRF·크기·시간·pagination 제한을
   적용한다.
4. 비공개 전체 목록용 원격 브라우저는 별도 선택형 beta다. 곳곳간이 만든 격리된 임시 서버 브라우저의
   화면·입력을 relay하고 사용자가 그 안에서 직접 로그인한다. 사용자 PC의 cookie나 profile을 읽거나
   복사하지 않으며, 자격증명·MFA·Provider cookie를 장기 저장하지 않는다. 검증된 live integration과
   운영 승인 전에는 capability를 `integration-gated`로 유지한다.
5. 공유 링크, 파일, 원격 browser session은 검증된 `Provider Connection`이 아니다. account fingerprint,
   installation, connection 행을 만들지 않고 기존 v2 capture 검사를 느슨하게 하지 않는다. 계정 미확인
   provenance를 보존하는 additive migration과 새 source scope 뒤에서만 SourceSnapshot으로 변환한다.
6. acquisition 이후에는 가능한 한 기존 SourceSnapshot → 선택·매칭 검토 → 승인 → durable queue →
   개인 Collection 저장을 재사용한다. 목록과 최소 장소 정보는 상세 보강을 기다리지 않는다. 상세 Worker와
   freshness scheduler는 계속 비활성이다.
7. Provider별 공식 내보내기 파일과 권한 위임은 독립 capability로 평가한다. 파일은 형식·용량·악성
   content·개인정보·보존 기간을 제한한다. 곳곳간에서 Provider로 쓰는 내보내기는 가져오기와 별도
   `SavedPlaceTarget` 계약이며, 공식 write 지원이 확인되지 않으면 활성화하지 않는다.
8. Provider 원문 메모는 개인 Note, Tag, Taxonomy가 아니다. source provenance에 보존할 필드와 개인
   Library로 복사할 필드를 별도 동의·계약으로 결정하기 전에는 자동으로 Note를 만들지 않는다.

## 결과

- 공유 링크 batch는 로그인·원격 화면 없이 가장 작은 제품 흐름으로 독립 출시할 수 있다.
- 사용자는 비공개 전체 목록이 필요할 때만 더 높은 보안 위험과 추가 로그인을 명시적으로 선택한다.
- URL fetch, 원격 session, 파일 parser의 보안·운영 위험을 서로 다른 Adapter와 activation gate에서
  검증할 수 있다.
- fixture와 synthetic relay 테스트 성공은 외부 Provider 연동 성공이 아니다. 실제 Provider 로그인,
  MFA/CAPTCHA, schema·pagination, 모바일 입력, session 폐기, data-center egress를 승인된 환경에서
  확인한 뒤에만 해당 capability를 활성화한다.
- 획득 출처가 달라도 승인 뒤 개인 Collection 저장의 재시도·멱등·감사 경계는 유지된다.

## 재검토 조건

Provider가 안정된 공식 저장목록 OAuth scope, 전체 계정 export/import API 또는 직접 write API를
제공하거나, live 검증에서 공유 링크 또는 원격 browser 방식이 약관·보안·운영 기준을 만족하지 못하면
해당 Provider의 acquisition 순서와 capability를 다시 결정한다.
