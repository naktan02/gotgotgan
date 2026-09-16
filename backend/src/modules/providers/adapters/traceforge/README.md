# TraceForge adapter

`TraceForgeRunnerClient`는 Runner SDK process와 client session별 익명 browser profile을 하나의 수명주기 뒤에
숨긴다. 동시에 하나의 `run`만 허용하며, 중단 시 SDK를 먼저 닫아 pending run을 정리한 후 profile을
삭제한다. 다음 `run`은 새 SDK와 새 profile로 시작한다. `close`는 같은 순서를 따르고 멱등이다.

Provider별 Pack output 해석은 이 폴더에 넣지 않는다. NAVER 해석은 `adapters/naver`, Google 공식
Details는 `adapters/google`이 각각 소유한다. 이 Adapter는 SDK process/profile 수명주기만 공유한다.
