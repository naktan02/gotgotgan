# Backend modules

Each direct child is a business-capability module. Initial owners are `access`, `places`, `taxonomy`, `library`,
`visits`, `writing`, `search`, `providers`, `ingestion`, `resolution`, `sync`, `sharing`, and `administration`.
Create a module directory only when its first behavior is implemented.

```text
<module>/
  README.md
  domain/          pure rules and models
  application/     use cases and consumer-owned ports
  adapters/        persistence or external implementations
  transport/       HTTP, jobs, events, or tools actually exposed
  tests/           tests through the module interface
```

Create only used leaves. Persistence adapters stay in their owning module; there is no global
repository folder. Add a port only when production and test adapters, or two real implementations,
make the seam concrete.

`ingestion` records immutable observations, candidates, and accepted resolution decisions.
`resolution` maintains replaceable comparison representations, immutable versioned pairwise Match
Assessments, and normalized immutable shadow Place Cluster Proposals. Its small public interface hides
the complete-pair merge policy and exposes no canonical mutation port. `places` applies canonical
create/link/merge/split/retire commands and preserves redirects and lineage. Composition translates
only an accepted ingestion decision into the places interface; none of these modules imports another's
source and neither a candidate nor a Match Assessment becomes canonical merely by being recorded.

`library`는 회원 preference, Collection, Tag, Personal Rating 이력, 복사 provenance를 소유한다.
`visits`는 변경 불가능하고 반복 가능한 Visit occurrence와 파생 summary를 소유한다.
`writing`은 versioned Note, Entry, Place link, 공개 projection을 소유한다. 어느 모듈도 다른
모듈을 import하거나 table을 조회하지 않는다. HTTP entrypoint composition이 각 public
interface와 공통 authorization 결과를 주입한다.

회원 콘텐츠 목록은 command Store의 무제한 메서드가 아니라 owner별 query Interface로 제공한다.
Library, Visits, Writing의 PostgreSQL query Adapter는 자기 schema만 읽고 bounded keyset cursor와
응답 projection을 감춘다. Writing list는 전체 본문을 읽기 계약으로 확산하지 않고 단건 detail과
분리한다. Library HTTP composition은 query Interface를 필수로 받아 목록 route의 존재와 의존성이
환경마다 달라지지 않게 한다.

`taxonomy`는 provider-neutral Node version을 소유하고 식당·카페·여행지 같은 예시를 고정
상위 enum으로 만들지 않는다. `search`는 텍스트·Taxonomy·공간·개인 filter용 Local Search
Projection과 source-neutral 결과 envelope을 소유한다. Search는 다른 owner table을 join하지
않고 versioned projection command만 받는다.

`access` owns membership and authorization rules. `administration` owns authorized management
workflows and review surfaces; it does not own or duplicate access policy.
