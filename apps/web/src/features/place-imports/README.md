# 장소 가져오기 기능

## 제품 경로에서 제외된 진단 화면

아래 Connector·서버 연결 화면은 이전 계약 검증용 구현이다. 현재 `/imports`는 설정 가져오기로
이동하며 이 feature를 렌더링하지 않는다. 사용자 설치 없는 제품 가져오기는
`../data-transfer-settings`의 여러 공유 링크와 별도 활성화되는 원격 브라우저 beta가 소유한다.
이 문서의 현재 브라우저/확장 기록을 다음 제품 연결 단계로 해석하지 않는다.

이 기능은 두 개의 Provider-neutral 경로를 같은 검토 화면으로 연결한다.

- 서버 연결 경로: 연결 선택, ImportBatch 시작·재개·취소·재시도, preview/review를 수행한다.
- 현재 브라우저 경로: Place Connector를 확인하고 Provider 권한을 준비한 뒤 일회성 grant로 수집을
  시작하며, 진행 상황과 완성된 `importBatchId`를 받아 같은 batch 상세로 전환한다.

`connected-place-imports-workflow.ts`가 onboarding, Connector session, 서버 import, polling,
review command의 상태와 side effect를 소유한다. `ConnectedPlaceImportsView.tsx`는 이 controller가
제공한 상태와 동작만 표시하며 Backend 주소, OIDC token, browser API, Provider cookie·token·profile,
NAVER endpoint와 응답 schema를 import하지 않는다. `detail.batch`가 batch 상태의 단일 원본이므로
목록과 진행 상태가 서로 다른 batch를 표시할 수 없다. 따라서 sidebar·card·mobile 배치 같은 UI는
workflow와 서버 경계를 바꾸지 않고 교체할 수 있다.

desktop과 mobile은 같은 상태 모델을 사용한다. 결정적 E2E는 가짜 서버 연결 흐름과 가짜 확장
probe·permission·progress·completion을 검증하며 실제 계정 자료를 저장하지 않는다.
