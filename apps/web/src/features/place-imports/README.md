# Place imports feature

연결 계정 선택, batch 진행, 취소·재개와 예외 검토를 하나의 사용자 workflow로 제공한다. 화면은
동일 출처 Web BFF 계약만 사용하고 provider profile, cookie, token, raw capture를 알지 못한다.
응답을 확인하지 못한 검토 명령은 같은 command ID로 재시도한다.

desktop과 mobile은 같은 workflow 상태를 사용하되 좁은 화면에서는 shell sidebar가 hamburger로
접히고 진행·검토 card가 한 열로 바뀐다. 이 feature는 Backend client, 인증 token, profile lifecycle을
직접 import하지 않으므로 화면을 대대적으로 바꿔도 서버 경계는 유지된다.
