# 일회성 가져오기

서비스 선택은 계정 연동이 아니다. 지원하는 공유 링크의 목록만 가져오며 계정 전체 목록이나
소유 확인된 provider connection으로 표시하지 않는다. 원격 로그인은 별도 보안·운영 검증이 끝나기
전 준비 중으로 표시한다. 브라우저의 기존 로그인 상태를 재사용한다고 안내하지 않는다.

- `ImportAcquisition.tsx`에서 세 공급자의 입력 가능 여부·준비 사유와 검토 화면을 확인한다.
- `import-acquisition-workflow.ts`에서 공급자별 메모리 draft, capability 실패 시 차단,
  stable command 재시도와 owner-scoped 작업 복구를 확인한다. 링크·쿠키는 브라우저 storage에 저장하지 않는다.
- `import-acquisition-client.ts`는 v2 시작과 capability를 소비하고, 변하지 않은 v1 작업 상태·취소 및
  v3 one-shot snapshot을 재사용한다. BFF는 `platform/imports/transfers`가 소유한다.
- `tests/e2e/settings.spec.ts`는 다중 링크 검토·복구·취소와 미지원 공급자/원격의 요청 차단을 확인하는 위치다.

실제 지원 상태의 소유자는 Backend capability다. UI의 운영 flag는 추가 차단만 할 수 있으며
미지원 방식을 활성화할 수 없다. fixture 기반 화면 테스트는 실제 외부 서비스 수집 성공을 뜻하지 않는다.
