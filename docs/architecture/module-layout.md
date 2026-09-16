# 모듈 배치 원칙

`module-boundaries.md`가 동작의 소유자를 정한다면 이 문서는 그 소유 경계 안의 배치를 정한다. 새
Provider, workflow, 화면을 추가할 때 수정 범위가 해당 모듈 안에 머무는 구조가 목표다.

## 같은 수준의 형제

소스 폴더의 직계 자식은 한눈에 이해되는 동급 집합이어야 한다. 같은 공개 Interface를 통해 함께
변경되는 작은 모듈의 비공개 구현 역할이거나, 서로 동급인 하위 모듈일 수 있다. 추상화 수준, 수명주기,
소유자, 변경 이유가 형제와 다른 항목은 응집된 기능 이름의 하위 폴더로 내린다. `utils`, `common`,
`misc` 같은 포괄 폴더는 만들지 않는다.

파일과 폴더가 섞여 있다는 사실만으로 위반은 아니다. 루트의 `public.ts`처럼 하위 모듈을 감추는 공개
진입점은 둘 수 있다. 반대로 완성된 화면 파일, HTTP Adapter, 도메인 규칙, 독립 workflow 폴더가 같은
직계 목록에 놓여 서로 다른 변경 이유를 가진다면 위반이다. 새 기능을 추가할 때 기존의 어긋난 형제를
발견하면 같은 변경 범위 안에서 소유 모듈로 옮기며, 옆에 새 파일을 하나 더 놓아 구조 부채를 늘리지
않는다.

예시는 다음과 같다.

- Provider Adapter는 `adapters/providers/<provider>` 아래의 형제다. 브라우저 수명주기 코드는 동급이
  아니므로 browser Adapter 아래에 둔다.
- Desktop 브라우저 호스트는 Provider 구현을 직접 import하지 않는다. 로그인 정책과 수집을
  application Interface로 주입하고 `entrypoints/desktop`에서 Provider 구현을 조립한다. 이 방향은
  Connector architecture 검사로 고정하며, 같은 Provider의 새 수집 방식도 공통 호스트 안에 분기하지 않는다.
- Import capture, outbound execution, reconciliation은 전송 영역의 동급 하위 모듈이다. SQL row 변환과
  transaction helper는 해당 Adapter의 비공개 구현이다.
- 작은 feature는 호출자가 하나의 공개 Interface만 사용하고 한 workflow로 함께 바뀐다면 `model`,
  `client`, `workflow`, `view`를 같은 폴더에 둘 수 있다. 독립 workflow가 둘 이상이면 평면 목록을
  늘리지 않고 workflow별 동급 하위 폴더를 만든다.

## 깊은 모듈

각 모듈은 호출자와 테스트에 작은 Interface 하나를 제공한다. 순서 제약, 재시도, transaction,
Provider 차이, 영속화 세부사항은 구현 안에 숨긴다. 운영 코드와 테스트가 같은 Interface를 사용하고,
실제로 구현이 교체되는 seam에만 Adapter를 주입한다. 구현 내부를 쉽게 테스트하려는 이유만으로 내부
파일을 공개하지 않는다.

새 모듈을 만들기 전에는 삭제 검사를 한다. 유용한 모듈을 삭제하면 숨겨졌던 복잡도가 여러 호출자로
다시 퍼져야 한다. 다른 호출의 이름만 바꾸는 통과 계층은 새 폴더나 Interface를 가질 이유가 없다.

## 배치 검토 기준

다음 중 하나에 해당하면 변경을 끝내기 전에 배치를 검토한다.

- 소스 파일이 대략 500줄을 넘는다.
- 폴더에 운영 소스 파일이 직계 자식으로 12개를 넘는다.

이 수치는 자동 분할 기준이 아니라 설계 검토를 시작하는 기준이다. 응집된 구조로 재배치하거나, 현재
구조를 한 모듈로 유지하는 편이 더 깊고 변경하기 쉽다는 근거를 가장 가까운 경계 README에 짧게
기록해야 완료할 수 있다. 생성 산출물, migration, fixture, test data는 단순 줄 수 대신 생성기와 소유
workflow를 기준으로 판단한다.

## 완료 조건

새 파일과 이동한 파일마다 소유자, 추상화 수준, 변경 이유, 공개 Interface, 허용 의존 방향을 확인한다.
형제 집합이 동급이고, 다른 모듈의 호출자가 공개 Interface만 import하며, architecture guard가 통과하고,
전체 diff에 새 포괄 폴더나 얕은 통과 계층이 없을 때 구조 변경이 완료된다.

Member Web와 Admin Web는 같은 500줄/직계 운영 소스 12개 검토 게이트를 실행한다. 이 자동 검사는
동급성 자체를 대신하지 않으므로, 수치 안에 있더라도 위 완료 조건을 코드 리뷰에서 확인한다.
