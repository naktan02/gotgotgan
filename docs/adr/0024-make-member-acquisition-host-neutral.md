# 0024: 회원 저장목록 획득을 실행 호스트와 분리한다

- 상태: accepted
- 날짜: 2026-09-05
- 대체: ADR 0012의 “브라우저 확장이 주 회원 획득 경계” 결정

## 배경

회원은 NAVER·Kakao·Google에서 자신이 저장한 목록을 Provider별로 가져온다. 현재 NAVER는 로그인한
first-party 화면에서 관측된 내부 JSON 경로로 목록과 장소를 읽을 수 있지만, 이 경로는 공개 API 계약이
아니다. Provider나 계정에 따라 공식 API·내보내기, 화면 DOM, 사용자 동의 캡처와 OCR이 필요할 수도
있다. 어느 한 실행 기술을 전체 Provider의 필수 설치물로 정하면 수집 방식 변경이 application과
Backend까지 번진다.

기존 `SavedPlaceSource` 뒤의 불변 SourceSnapshot, 암호화 spool, 일회성 grant, TransferOperation,
ImportPlan과 Collection Materialization 경계는 획득 방식과 무관하며 그대로 재사용할 수 있다.

## 결정

1. `apps/member-connector`는 확장 프로그램 자체가 아니라 회원 기기에서 동작하는 host-neutral Connector
   경계다. 확장 프로그램은 가능한 실행 Adapter 중 하나일 뿐 필수 조건이 아니다.
2. Provider별 Adapter가 지원 근거에 따라 획득 순서를 소유한다. 현재 NAVER의 첫 전략은 로그인된
   first-party session에서 실행하는 관측된 내부 JSON API다. Kakao·Google은 각각 검증된 계약이 생기기
   전까지 같은 방식을 가정하지 않는다.
3. 내부 API로 얻을 수 없는 항목은 향후 보이는 화면의 구조화 DOM, 명시적인 사용자 캡처와 OCR 순으로
   추가할 수 있다. 이 전략 선택은 Provider Adapter 내부에 숨기고 공통 application은 기존
   `SavedPlaceSource` Interface만 사용한다.
4. 계약 drift나 해당 화면 부재처럼 전략이 적용될 수 없을 때만 다음 전략을 검토한다. 인증 만료, 권한
   거부, 사용자 취소, rate limit을 조용히 우회하지 않는다. 첫 chunk를 만든 뒤 전략을 바꾸거나 하나의
   snapshot에 서로 다른 전략 결과를 섞지 않는다.
5. DOM/OCR을 실제 도입하기 전 acquisition kind, 관측 신뢰도와 사용자 검토 필요 여부를 versioned
   snapshot 계약에 추가한다. 안정적인 source ID를 읽지 못한 값을 임의 ID로 가장하지 않는다.
6. 브라우저 profile, 로그인 창, 세션 지속성, 동시 실행과 종료는 실행 호스트 Adapter가 소유한다.
   Playwright CLI는 현재처럼 진단 도구로 둔다. 별도 desktop shell이나 개발 중인 browser-control
   프로젝트는 실제 채택·보안·live 검증 전에는 production capability로 조립하지 않는다.
7. Provider cookie, 비밀번호, MFA 값과 profile 경로는 서버에 보내지 않는다. 서버는 회원 기기의
   브라우저를 원격 조작하지 않고 Connector가 제출한 versioned snapshot만 처리한다.
8. Backend SourceSnapshot, 개인 Collection 반영, Provider 상세 후속 작업은 획득 호스트를 알지 못한다.
   새 실행 Adapter나 수집 전략 때문에 이 파이프라인을 복제하지 않는다.

## 결과

- NAVER 내부 API 변경은 NAVER API leaf와 fixture에 국한된다.
- 확장, desktop shell, 향후 browser-control 중 어떤 실행 호스트를 채택해도 Provider parser와 Backend는
  유지된다.
- 확장 미설치만으로 가져오기가 불가능하다고 표시하지 않는다. 다만 아직 검증된 production 실행
  Adapter가 없으므로 현재 capability는 계속 `source-only`/`integration-gated`다.
- DOM/OCR 폴더나 전역 전략 framework는 실제 두 번째 구현이 생길 때 만든다.
- provenance rollout은 migration과 이를 읽는 Backend를 먼저 배포한 뒤 Connector 기록을 활성화한다.
  기존 Connector manifest는 계속 수용하며, 공개 SourceSnapshot v2 응답 형태는 바꾸지 않는다.

## 재검토 조건

Provider가 공식 저장목록 API 또는 account export를 제공하거나, 실제 DOM/OCR 관측이 현재 snapshot
식별 계약으로 표현되지 않거나, 채택할 desktop/browser-control runtime의 보안 경계가 검증되면 Provider별
capability와 계약을 다시 결정한다.
