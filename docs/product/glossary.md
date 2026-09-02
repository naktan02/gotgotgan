# 제품 용어

- **Place**: 현실의 장소나 목적지를 나타내는 provider 중립적인 canonical identity.
- **Source Observation**: 특정 시점의 Place를 설명하는 provider 또는 사용자 evidence.
- **Canonical Place Profile**: 검증된 assertion을 선택해 발행한 provider-neutral 현재 장소 정보의
  불변 revision. Search 문서나 Provider payload가 아니다.
- **Fact Assertion Batch**: 한 subject와 한 Source Observation에서 나온 typed fact assertion 묶음.
  관찰 시각과 권리 profile을 공유하고 field별 confidence와 provenance를 보존한다.
- **Place Operational Status**: 현실 장소의 영업 여부. Canonical identity의 redirect·retirement와
  독립적으로 변한다.
- **Personal Library**: 한 회원의 Collection과 ordered membership, Tag, Personal Rating,
  import·copy provenance.
- **Favorite / 즐겨찾기**: 회원 소유 Collection 하나 이상에 포함된 Place. 별도 `saved` 또는
  `wanted` boolean을 뜻하지 않는다.
- **Collection**: 회원이 직접 이름 붙이고 장소를 순서대로 분류하는 즐겨찾기 카테고리. 기본 공개
  범위는 private이며 한 Place를 여러 Collection에 넣을 수 있다.
- **Legacy Place Preferences**: 현재 source-only v1 계약의 `saved`, `wanted`, `personalRating` 묶음.
  `saved`와 `wanted`는 새 제품 Interface에서 퇴역하며 v2의 favorite 판단에 사용하지 않는다.
- **Personal Rating**: Collection membership과 독립된 회원의 현재 평점과 비공개 변경 이력.
- **Visit**: 회원이 Place에 방문한 반복 가능한 occurrence.
- **Note**: 짧은 글. **Entry**: 긴 글. visibility는 별도 콘텐츠 종류가 아니라 속성이다.
- **Unlisted Projection**: 불투명한 publication ID로 접근하지만 공개 검색 대상은 아닌 허용
  목록 기반 익명 projection.
- **Collection Copy**: 공개된 Collection에서 생성한 독립 private Collection. provenance는
  남기지만 원본 Rating, Tag, Visit, ownership은 복사하지 않는다.
- **Place Filing**: 한 Place를 하나 이상의 회원 Collection에 원자적으로 포함하거나 제외하는
  Collection-first 분류 동작.
- **Anchor Placement**: 정수 위치 대신 `first`, `last`, `before`, `after` 기준으로 Collection 내
  순서를 요청하는 방식.
- **Area Node**: 다국어 이름과 부모를 가진 provider-neutral 지역의 선형 version. 주소 문자열이나 지도
  viewport와 다르다.
- **Canonical Media Reference**: 일시적인 Provider URL 대신 Profile이 선택하는 stable media identity.
  공개에는 별도의 현재 권리, surface, 유효 기간과 출처 표기 검사가 필요하다.
- **Local Search Projection**: Canonical Place change feed로 만드는 재구축 가능한 내부 검색 문서.
  탐색을 최적화하지만 장소 사실의 권위 저장소가 아니다.
- **Provider Connection**: 외부 계정에 대한 Place 소유 metadata와 credential/profile reference.
- **Import Run**: preview, evidence, 검토 결과를 포함하는 지속 가능하고 재개 가능한 수집 시도.
- **Resolution**: observation과 Canonical Place 사이의 merge, split, link 결정.
- **Family Navigation**: workspace가 구성하고 versioned manifest로 전달하는 서비스 이동 목록.
