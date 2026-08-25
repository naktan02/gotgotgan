# Google adapter

Google Places API (New)의 Text Search와 선택 결과의 Details/Photo를 소유한다. 검색 field mask는
최소 필드만 요청하고 상세·사진은 선택 시점에만 조회한다. Photo resource name은 저장하지 않으며
작성자와 Google Maps attribution을 provider-neutral detail projection에 보존한다.
