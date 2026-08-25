# 공유와 추천

Sharing은 선택한 지도, Collection, Place, Writing에서 authorization을 통과한 projection만
공개한다. 다른 사용자의 지도를 보는 행위는 private field 접근 권한을 부여하지 않는다.
복사는 provenance를 가진 새로운 Library 관계를 만들며 mutable ownership을 공유하지 않는다.

public과 unlisted는 동일한 최소 projection 형식을 사용한다. public은 이후 단계에서 검색
대상이 될 수 있지만 unlisted는 불투명한 publication ID를 가진 사람만 접근할 수 있다.
private, 알 수 없는 ID, 잘못된 publication ID 모두 membership identity나 private field의
존재를 노출하지 않는다.

향후 추천 기능은 privacy 검토를 통과한 projection을 입력으로 받고 versioned interface로
설명 또는 후보를 반환한다. 추천 infrastructure는 충분한 데이터와 별도 단계가 준비되기
전까지 활성화하지 않는다.
