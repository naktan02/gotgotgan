# 장소 가져오기 기능

이 기능은 두 개의 Provider-neutral 경로를 같은 검토 화면으로 연결한다.

- 서버 연결 경로: 연결 선택, ImportBatch 시작·재개·취소·재시도, preview/review를 수행한다.
- 현재 브라우저 경로: Place Connector를 확인하고 Provider 권한을 준비한 뒤 일회성 grant로 수집을
  시작하며, 진행 상황과 완성된 `importBatchId`를 받아 같은 batch 상세로 전환한다.

화면은 feature-local 상태와 `platform/imports`의 좁은 client interface만 사용한다. Backend 주소,
OIDC token, browser API, Provider cookie·token·profile, NAVER endpoint와 응답 schema를 import하지
않는다. 따라서 sidebar·card·mobile 배치 같은 UI는 workflow와 서버 경계를 바꾸지 않고 대대적으로
교체할 수 있다.

desktop과 mobile은 같은 상태 모델을 사용한다. 결정적 E2E는 가짜 서버 연결 흐름과 가짜 확장
probe·permission·progress·completion을 검증하며 실제 계정 자료를 저장하지 않는다.
