# 공식 장소 검색 조사 기록

조사일: 2026-08-26

이 문서는 Stage 6 공식 검색 어댑터의 근거와 구현 결정을 기록한다. 공급자 문서는 변경될 수
있으므로 live activation 전 다시 확인한다. 저장 목록 가져오기, 계정 연결, 브라우저 자동화는
이 조사 범위가 아니며 Stage 7 이후에 별도 근거를 남긴다.

## NAVER 지역 검색

[NAVER 지역 검색 공식 문서](https://developers.naver.com/docs/serviceapi/search/local/local.md)는
비로그인 오픈 API, 헤더의 Client ID/Secret, 일 25,000회 한도, HTTPS GET 요청을 명시한다.
현재 문서의 요청 표는 `display` 최대 5, `start` 최대 1로 설명한다. 응답은 이름, 상세 링크,
공급자 분류, 지번/도로명 주소와 WGS84 정수 좌표를 제공하지만 안정적인 장소 ID나 공식
상세·사진 API는 제시하지 않는다.

따라서 NAVER 결과는 문서에 없는 ID를 URL에서 추출하지 않는다. 결과 선택용 `resultId`는
응답 필드의 해시일 뿐 provider Place ID나 canonical Place ID가 아니다. bounds는 API 요청에
전달할 수 없어 반환 좌표로 후처리한다. 공식 검색의 문서상 페이지 제한도 UI에 숨기지 않는다.

## Kakao Local 키워드 검색

[Kakao Local 공식 문서](https://developers.kakao.com/docs/ko/local/dev-guide#키워드로-장소-검색)는
REST API 키 헤더를 사용하는 키워드 검색, 위치·반경·사각 영역, 정확도/거리 정렬, 페이지와
페이지 크기를 설명한다. 응답은 `id`, 장소명, 공급자 분류, 전화, 주소, 좌표, `place_url`과
`meta.pageable_count`, `meta.is_end`를 제공한다.

Kakao의 문서화된 `id`는 provider identity로 보존하고, `rect`와 페이지 cursor를 공식 요청에
사용한다. Local 문서에서 별도 장소 상세·사진 operation은 확인되지 않았으므로 검색 결과의
`place_url`만 외부 확인 링크로 제공한다. 이는 API 전체에 기능이 절대 없다는 주장이 아니라,
현재 선택한 공식 Local 계약에서 상세·사진 능력을 확인하지 못했다는 구현 판단이다.

## Google Places API (New)

[Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)는
`textQuery`, `X-Goog-Api-Key`, 필수 `X-Goog-FieldMask`, 최대 20개 `pageSize`,
`nextPageToken`/`pageToken`, 사각 `locationRestriction`을 제공한다. 필드 마스크는 불필요한
처리와 비용을 줄이므로 검색에서는 ID, 이름, 주소, 좌표, 대표 분류, Maps URI와 다음 token만
요청한다.

[Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details)는
Place ID 기반 지연 상세 조회에 사용한다. 평점과 평가 수, 영업 상태, 영업시간, 전화, 사진은
사용자가 결과를 선택했을 때만 요청한다.

[Place Photos (New)](https://developers.google.com/maps/documentation/places/web-service/place-photos)는
최근 Search/Details 응답의 photo resource name을 사용해야 하며 이름이 만료될 수 있고 캐시하면
안 된다고 설명한다. `skipHttpRedirect=true`로 bounded `photoUri`를 받고, 사진에
`authorAttributions`가 있으면 표시한다. [Places 정책과 출처 표시](https://developers.google.com/maps/documentation/places/web-service/policies)에
따라 Google Maps 및 작성자 출처를 브라우저 projection에 보존한다.

## 공통 구현 결정

- 공급자 endpoint와 credential은 배포 환경과 secret file이 소유한다. 브라우저나 source에
  credential과 내부 endpoint를 넣지 않는다.
- 공식 HTTP 실행기는 redirect 거부, 응답 크기 제한, timeout, 최대 2회 retry, bounded backoff,
  안전한 오류 코드만 공통 처리한다.
- 공급자 응답 parser와 필드 의미, 좌표, pagination, 누락 필드는 각 adapter가 소유한다.
- 외부 검색 결과는 `kind=provider`, 정규 장소는 `kind=canonical`이다. 검색 결과를 canonical
  Place로 가장하거나 검색만으로 자동 저장하지 않는다.
- 공급자 분류를 Place Taxonomy key로 즉석 변환하지 않는다. mapping이 생기기 전 taxonomy나
  개인 필터가 있는 공식 검색 요청은 `PLACE_PROVIDER_FILTER_UNSUPPORTED` partial outcome을 낸다.
- blocking test는 redacted deterministic fixture를 replay한다. live smoke는 명시적으로 켜고
  endpoint와 secret file, query를 주었을 때만 실행한다.
