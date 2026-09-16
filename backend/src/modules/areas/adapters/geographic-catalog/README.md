# 지도 이동용 지리 참조 자료

장소·개인 카테고리와 별개인 지도 이동용 읽기 전용 참조다. 국가·주요 도시의 레거시 조회와
국내 지역을 포함하는 v2 조회를 구분한다. 모든 주소를 포괄하는 지오코더가 아니며, 이 자료로
개인 장소를 공개 카탈로그에 등록하거나 정식 지역 분류를 부여하지 않는다. 국가 이외의 위치는
대표점이며 지도 이동용 확대 범위를 행정 경계로 가장하지 않는다.

[Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)의 public-domain 원본을 사용한다.
갱신 시 `scripts/generate-geographic-catalog.mjs`의 고정 revision·체크섬을 함께 검토한다. 생성 결과는
앱과 함께 배포되므로 사용자 검색어를 외부 서비스에 전달하지 않는다. 작은 섬·도시 등 누락이 있는
축척 자료라는 한계와 원본의 국가·지역 표기는 그대로 보존한다.

## 국내 지역 보완 근거와 한계

2026-09-06 공개 [GeoNames KR dump](https://download.geonames.org/export/dump/readme.txt)를
검토했다. [CC BY 4.0 자료](https://www.geonames.org/about.html)이며 정부 자료 등을 종합하되
커뮤니티 수정도 허용하는 데이터다. 한국 정부의 최신 행정구역 원장으로 주장하지 않는다.
[feature code 정의](https://www.geonames.org/export/codes.html)에 따라 현재 ADM1–4와 한국어
이름이 동·읍·면으로 끝나는 PPL/PPLX 대표점을 선택하고 역사적 ADM 코드는 제외했다.
확인한 원본에는 ADM1 17개, ADM2 229개가 있었으며 동네 전체의 완전성·명칭 최신성은 미확인이다.
별칭에는 과거 명칭이 섞일 수 있다. 동일 이름은 상위 지역 context로 구분한다.

재현·갱신은 `scripts/generate-korean-geographic-catalog.mjs`의 고정 URL/SHA256과
`korea-reference-data.generated.json` metadata를 함께 검토한다. 원본 archive는 체크인하지 않고
필요한 정규화 참조만 배포한다. upstream 내용이 바뀌면 체크섬 검증이 실패하므로 조용히 새로운
데이터로 교체하지 않는다. 검색어를 외부로 전송하거나 좌표로 주소를 확정하지 않는다.
Web의 지역 후보 안내에서 GeoNames 및 라이선스 링크를 유지한다. 경기도·양주시·동명 성수동,
전체 참조 계약/중복 ID 및 v1 범위 회귀는 `../../tests/geographic-catalog.test.ts`가 소유한다.
