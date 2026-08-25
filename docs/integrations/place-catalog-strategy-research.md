# 장소 카탈로그 확보 전략 조사

조사일: 2026-08-26

## 결론

Place가 NAVER·Kakao·Google 등에 존재하는 음식점, 카페, 관광지 등을 처음부터 전부
자체 `Place`로 수집하는 방식은 권장하지 않는다. 검색 공백은 해결하지만 다음 문제가 더 크게
생긴다.

- 전 세계의 "전부"는 완료 조건을 정의하기 어렵고 개업·폐업·이전으로 즉시 낡는다.
- 같은 장소가 출처마다 다른 이름·주소·좌표·분류를 가지므로 대량 중복과 잘못된 병합이 발생한다.
- 공급자별 저장·표시·출처 표기 조건이 달라 수집한 필드를 하나의 영구 카탈로그처럼 다룰 수 없다.
- 사용자가 실제로 찾지 않는 장소까지 수집·상세화하면 요청 비용과 검증 작업이 폭증한다.

권장안은 **3계층 혼합 카탈로그**다.

1. 재배포와 파생 저장이 가능한 공개·계약 데이터로 선택한 지역의 얇은 기본 카탈로그를 만든다.
2. 검색 시 로컬 카탈로그와 공식 공급자 검색을 함께 조회해 아직 저장되지 않은 장소도 즉시 보여준다.
3. 사용자가 저장·메모·방문·공유한 장소만 관찰 자료를 남기고 식별·중복 해소를 거쳐 canonical
   `Place`로 승격한다. 상세 정보는 필드별 근거와 만료 시점을 기록하고 필요할 때 다시 조회한다.

따라서 검색 실패 뒤에 "등록 신청"만 보여주는 UX도, 모든 공급자 장소를 미리 복제하는 UX도
피한다. 공급자 검색 결과는 바로 선택할 수 있어야 하고, 등록 신청은 여러 출처에서도 찾지 못한
경우의 보완 경로여야 한다.

## 실제 서비스의 구성 방식

### Google Maps: 내부 코퍼스 + 기관·사업자·사용자 갱신

Google은 Place ID를 "Google Places 데이터베이스"의 장소 식별자로 설명하고, 검색으로 ID를
찾은 뒤 ID 기반으로 상세를 조회하는 흐름을 제공한다. 즉 검색할 때마다 웹에서 새로 장소를
발견하는 것이 아니라 이미 운영 중인 장소 코퍼스를 조회한다. 한편 Google은 수백 곳의 정부·기관
등 권위 있는 지리 데이터 파트너가 Maps에 데이터를 제공한다고 밝히며, 사용자는 누락 장소를
추가할 수 있고 사업자는 Business Profile을 인증해 영업시간·주소·사진을 관리할 수 있다.
([Place ID](https://developers.google.com/maps/documentation/places/web-service/place-id),
[Geo Data Partnerships](https://support.google.com/mapcontentpartners/answer/10187434?hl=en),
[누락 장소 추가](https://support.google.com/maps/answer/6320846?hl=en))

외부 개발자가 같은 코퍼스를 통째로 복제할 수 있다는 뜻은 아니다. Places API 정책은 일반
콘텐츠의 선조회·캐시·저장을 제한하고 Place ID를 예외로 둔다. Google은 오래된 ID를 다시
확인하도록 권장하며, 상세·사진·리뷰에는 출처 표시 의무도 둔다. 이는 외부 서비스에는
**영구 복제보다 ID 유지와 지연 상세 조회**가 기본임을 보여준다.
([Places API 정책](https://developers.google.com/maps/documentation/places/web-service/policies),
[Place ID 새로고침](https://developers.google.com/maps/documentation/places/web-service/place-id#save-id))

### Apple Maps: 다중 데이터 공급자 + 자체 현장 조사 + 제보·사업자 갱신

Apple Maps의 공식 출처 페이지는 OpenStreetMap과 다른 데이터 공급자의 사용을 표시한다.
Apple은 차량·도보 장비로 GPS 궤적, 이미지와 LiDAR 등을 반복 수집해 지도를 구축·갱신한다고
설명한다. 사용자는 누락된 주소·사업체·교통 지점 등을 제보할 수 있고, 사업자는 Apple Business
Connect를 통해 자신의 장소 정보를 관리한다.
([Apple Maps 데이터 출처](https://www.apple.com/legal/internet-services/maps/legal-en.html),
[Apple Maps 현장 수집](https://maps.apple.com/imagecollection/),
[누락 정보 제보](https://support.apple.com/en-gb/guide/iphone/iph2c075a8e8/ios))

반대로 Apple Maps 이용 약관은 무단 대량 다운로드, 스크래핑, Maps 콘텐츠로 데이터베이스를
만드는 행위와 무단 캐시를 명시적으로 제한한다. Apple 사례도 플랫폼 자신이 여러 입력을
통합하는 것과 외부 앱이 그 결과를 통째로 영구 저장하는 것은 전혀 다른 권리임을 보여준다.
([Apple Maps 이용 약관](https://www.apple.com/legal/internet-services/maps/terms-en.html))

### OpenStreetMap: 다운로드 가능한 전체 기반 자료 + 지속 증분 + 검토된 대량 반입

OpenStreetMap은 전체 현재 데이터의 Planet 덤프와 변경분을 제공한다. 소비자는 덤프로 로컬
데이터베이스를 만들고 분·시·일 단위 복제 변경분으로 갱신할 수 있다. 이는 허용된 라이선스 아래
**기본 카탈로그를 실제로 물리 저장**하는 대표 사례다.
([OSM 데이터베이스와 데이터 접근](https://wiki.openstreetmap.org/wiki/Databases),
[복제 변경분](https://wiki.openstreetmap.org/wiki/Planet.osm/diffs))

그러나 외부 데이터 대량 반입도 곧바로 허용되는 것은 아니다. OSM 반입 지침은 라이선스 호환성,
변환 규칙, 중복 결합(conflation), 품질 보증, 되돌리기 계획, 지역 커뮤니티 검토를 요구한다.
OSM 데이터 사용 자체에도 ODbL과 출처 표시 조건이 적용된다. 공개 데이터 기반이라도 정규화와
중복 해소 없는 단순 적재는 좋은 운영 모델이 아니다.
([OSM 반입 지침](https://wiki.openstreetmap.org/wiki/Import/Guidelines),
[OSM 저작권과 라이선스](https://www.openstreetmap.org/copyright))

### Foursquare: 여러 입력의 수집·해소·검증 + API 또는 데이터 파일 제공

Foursquare의 공식 기술 설명은 장소 카탈로그를 만드는 단계를 구체적으로 공개한다. 웹 수집,
목록 배포 사업자, 지역·분류 전문 파트너, 자사 앱 사용자의 입력을 먼저 모으고, 이후
`ingestion → resolution → summarization → calibration → filtration`을 거쳐 하나의 장소 표현을
만든다. 즉 수집 결과를 곧바로 정답 레코드로 쓰지 않는다.
([Foursquare Places 구축 과정](https://foursquare.com/resources/blog/developer/digitizing-real-world-pois-with-foursquare-places/))

Foursquare는 완성된 카탈로그를 검색 API뿐 아니라 지역·분류별 데이터 파일로도 제공하고,
Placemaker 도구로 수정·삭제·병합·상태 제안을 받는다. FSQ OS Places는 장소·분류 데이터와
`add`, `update`, `remove`, `merge` 변경분을 Apache 2.0으로 공개하고, 더 풍부한 속성은 별도
상품으로 구분한다. 카탈로그가 필요한 회사는 이처럼 저장이 허용된 장소 데이터로 기반 자료를
적재하거나 계약 API로 조회할 수 있다. 자체적으로 모든 웹사이트를 다시 수집하는 것만이
일반적인 선택지는 아니다.
([Foursquare Places](https://foursquare.com/products/places/),
[Places API와 Placemaker](https://foursquare.com/products/places-api/),
[FSQ OS Places와 변경분](https://docs.foursquare.com/data-products/docs/places-os-data-schema),
[FSQ OS Places 라이선스](https://docs.foursquare.com/data-products/docs/fsq-places-open-source),
[데이터 파일 제공 방식](https://docs.foursquare.com/data-products/docs/places-flat-file-overview))

### Yelp·Tripadvisor: 기존 카탈로그 검색 + 누락 제출·검증 + 제한된 외부 저장

Yelp Places API는 위치·검색어로 기존 사업체를 즉시 검색한다. Yelp는 누구나 누락 사업체를
제출할 수 있지만, 제출 정보는 여러 근거를 확인하는 운영자 검증을 거친 뒤 검색에 나타난다고
설명한다. 사업자와 목록 관리 파트너도 인증된 경로로 이름·주소·영업시간·폐업 상태 등을
갱신한다.
([Yelp 사업체 검색](https://docs.developer.yelp.com/reference/v3_business_search),
[사업체 추가와 검증](https://business.yelp.com/resources/articles/how-to-add-a-business-to-yelp/),
[Listing Management](https://business.yelp.com/data/listings/))

Yelp의 외부 API는 콘텐츠 캐시를 최대 24시간으로 제한하고 Business ID만 영구 저장하도록
허용한다. Tripadvisor도 사업자와 여행자가 장소를 제출할 수 있고 새 제출을 검증하지만,
Content API에서는 Location ID 외 콘텐츠의 캐시·저장·색인을 허용하지 않는다. 두 사례 모두
"검색 API가 있다"와 "응답 전체를 자체 장소 DB로 영구 보유할 수 있다"를 구분해야 한다는
근거다.
([Yelp Places FAQ](https://docs.developer.yelp.com/docs/places-faq),
[Tripadvisor 장소 등록·검증](https://www.tripadvisor.com/business/claim-restaurant-listing-free),
[Tripadvisor 캐시 정책](https://tripadvisor-content-api.readme.io/reference/caching-policy))

## 공통 패턴

| 패턴 | 실제 역할 | Place에 적용할 방식 |
|---|---|---|
| 전체 기반 코퍼스 | 검색의 첫 화면을 비우지 않음 | 저장이 허용된 공개·계약 자료만 지역 단위로 적재 |
| 공급자 연합 검색 | 로컬 DB에 없는 장소를 즉시 발견 | Stage 6 공식 검색 결과를 로컬 결과와 함께 노출 |
| 지연 상세화 | 비용·신선도·저장 제한 관리 | 선택 또는 저장 시에만 상세 조회, 필드별 만료 관리 |
| 사용자·사업자 기여 | 신규·변경·폐업의 긴 꼬리 보완 | 개인 초안과 공개 검증 대기 상태를 분리 |
| 해소·검증 파이프라인 | 출처 간 중복과 충돌 통제 | Observation → Candidate → Resolution → canonical Place 유지 |
| 증분 갱신 | 전체 재수집 없이 신선도 유지 | 공개 diff, 공급자 변경 신호, 사용자 새로고침 요청을 큐 처리 |

대형 플랫폼의 "검색하면 바로 나온다"는 경험은 단일 수집 기술의 결과가 아니다. 장기간 누적한
코퍼스, 공급자·기관 계약, 사업자 관리, 사용자 제보, 중복 해소와 신선도 운영이 합쳐진 결과다.
작은 서비스가 같은 체감을 얻으려면 같은 규모의 DB부터 만들기보다 **검색 결과의 출처를 합성**하는
것이 먼저다.

## Place 권장 검색·저장 흐름

```text
사용자 검색
  ├─ 로컬 canonical 검색
  ├─ 저장 가능한 기본 코퍼스 검색
  └─ NAVER / Kakao / Google 공식 검색
          ↓
출처와 신선도를 표시한 통합 결과
          ↓
사용자 선택
  ├─ 보기만 함: 공급자 결과를 영구 Place로 만들지 않음
  ├─ 상세 열기: 허용된 범위에서 지연 조회
  └─ 저장·메모·방문: Observation/Candidate 생성 → 중복 해소 → canonical 연결 또는 생성
```

구체적인 UX는 다음이 적합하다.

- 로컬 결과가 0건이어도 공급자 결과가 있으면 바로 카드와 지도 핀을 보여준다.
- 공급자 전용 결과에도 `저장`, `가본 곳`, `가고 싶은 곳`, `메모`를 바로 사용할 수 있게 한다.
  첫 행동이 canonical 생성·연결 과정을 시작하도록 한다.
- 여러 공급자에서 찾은 동일 장소는 즉시 자동 병합하지 않는다. 높은 신뢰도이면 자동 연결하고,
  애매하면 한 사용자에게만 보이는 후보 상태로 유지한다.
- 어느 출처에도 없으면 사용자가 최소 정보로 개인 장소를 즉시 만들 수 있게 한다. 공개 노출은
  별도의 검증 대기열을 통과시킨다.
- `최신화 요청`은 장소를 숨기거나 사용자를 기다리게 하지 않고 큐에 넣는다. 마지막 확인 시각과
  충돌 상태를 함께 보여준다.
- 검색 결과나 provider observation은 그 자체로 canonical 진실이 아니다. 사용자의 개인 분류와
  메모도 공급자 데이터와 분리해 Place가 소유한다.

## 초기 범위 제안

1. 현재 구현된 로컬 + 공식 공급자 통합 검색으로 빈 결과 UX를 먼저 없앤다.
2. 사용자가 공급자 결과를 저장하는 순간의 canonical 승격과 중복 해소를 완성한다.
3. 서울·수도권처럼 실제 이용 지역 하나를 정해 OSM, FSQ OS Places 또는 별도 공공·계약
   데이터의 품질과 라이선스를 검증한 뒤 얇은 기본 코퍼스를 시험한다.
4. 검색 로그가 아니라 실제 저장·조회 수요를 기준으로 지역·분류별 사전 적재 범위를 넓힌다.
5. 신규 장소, 폐업, 이전, 이름 차이와 공급자 충돌을 재현하는 검증 fixture를 축적한다.

이 순서라면 초기에는 공급자 검색이 즉시성을 담당하고, 이용 데이터가 쌓일수록 Place 자체
카탈로그가 자연스럽게 깊어진다. 이후 추천이나 범용 AI 조회는 출처마다 흩어진 임시 응답이 아니라
사용자가 실제로 선택하고 검증한 canonical Place와 개인 신호를 안정적으로 사용할 수 있다.

## 공개 근거의 한계

공식 공개 자료만으로는 각 회사의 내부 저장 구조, 공급자별 데이터 비중, 중복 해소 모델,
검색 순위 모델과 제보 처리 시간을 알 수 없다. 따라서 모든 입력이 물리적으로 한 데이터베이스에
저장된다고 단정하지 않는다. 확인 가능한 사실은 이들이 검색 가능한 기존 장소 식별 체계를
운영하면서 여러 외부·사업자·사용자 입력과 검증 경로를 함께 사용하고, 외부 개발자에게는 별도의
API·데이터 상품·저장 조건을 제공한다는 범위까지다.
