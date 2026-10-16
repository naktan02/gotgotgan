# 곳곳간 Jenkins 검사

고정 소스를 검사하고, 같은 소스에서 만든 산출물을 인수한 뒤 Controller에 등록한다.

```text
고정 소스 ─┬─ Linux 전체 검사 → 두 웹 앱·Backend·Connector·브라우저 회귀
           └─ Windows 검사 → 계약·배포 선언·Connector 진단과 확장 빌드
고정 소스 ─── 세 운영 이미지 → source-only 실행·Worker → 시험 DB·복원 → 같은 이미지 ID 보관
                                  ↓
                    산출물·복원 검증 → Controller 인수 → 전환
```

검사 범위와 도구 버전은 [실행 선언](execution.json), 준비 방법은
[도구 이미지](Dockerfile)와 [검사 진입점](check.py)에서 확인한다.
[도구 선언](tools.json)의 registry digest를 Agent 호스트에 내려받고 Windows profile의 설치
경로를 연결해 커밋을 등록한다. heavy Agent의 실제 자원 한도는 호스트 관리자가 배정한다.
Linux 기본 검사는 네트워크 없는 컨테이너에서 기존 루트 `npm run check`를 실행한다.
Windows 검사는 진단 Connector의 해당 OS 동작을 확인하며, 일반 사용자용 설치 제품이나
실제 NAVER 로그인·수집 완료를 뜻하지 않는다. 제품 상태는
[Connector 안내](../apps/member-connector/README.md)가 소유한다.

[산출물 선언](release.json)과 [이미지 검사](build-images.py)는 제품의 기존 세 이미지 대상을
그대로 사용한다. source-only 상태 확인은 실제 Identity 로그인을 증명하지 않는다.
DB 검사는 기존 migration·권한·암호화 세션·덤프 복원 경계를 시험 데이터로 확인한다.
같은 호스트 복원이며 독립 백업 저장소나 운영 데이터로 실행하지 않는다.

기존 Actions는 실제 Jenkins 검사·상태 보고·산출물 다운로드·실패 복구를 인수할 때까지 유지한다.
이 후보는 원본 작업 트리의 진행 중인 데이터 수집 변경과 별도로 검증하며, 통합은 별도 확인 대상이다.
운영 Identity·Gateway 연결과 게시·활성화 조건은 [배포 선언 안내](../deploy/README.md)를 따른다.

## 환경 실패를 구분할 때

2026-10-17 Linux CI에서 두 Next standalone 출력을 같은 작업 영역에 유지하자
Admin 빌드가 `ENOSPC`로 실패했다. 준비된 의존성은 약 665 MB이며 기존 작업 영역은 1 GiB다.
빌드 출력을 임시 경로로 옮기면 Next의 외부 모듈 해석이 깨져 그 우회를 제거했다.
[실행 선언](execution.json)의 heavy Agent에 관리자가 충분한 작업 공간과 메모리를 배정한다.
원래 경로에서 같은 루트 전체 검사를 실행하는 것이 재발 확인 경로다.

브라우저 실행에서는 PID 한도 256에서 실제 프로세스 생성 거부가 발생했다. 관리자의 한도를
512로 배정하면 거부는 사라졌지만, CPU 2개를 나눠 쓰는 기본 병렬 검사에서 최초 페이지 컴파일이
겹쳐 두 검사가 시간 초과 후 재시도했다. [브라우저 설정](../playwright.config.ts)은 CI에서 한 Worker로
실행한다. 같은 제한에서 전체 검사를 재시도 없이 통과하는 것이 확인 조건이다.
[Playwright CI 안내](https://playwright.dev/docs/ci#workers)도 이 실행 방식을 권한다.

같은 실행의 공유 링크 화면은 12픽셀 차이로 실패했다. 실제·기대·차이 이미지를 비교하니
textarea URL 글자 가장자리만 기존 RGB 서브픽셀에서 회색조로 달랐고 위치·내용·배치는 같았다.
고정된 Debian CI 이미지에서 반복된 실제 캡처를 검토해 해당 화면의 기본·좁은 너비 Linux 기준 이미지 두 개만 갱신했다.
허용 오차를 늘리지 않았으며 [전체 브라우저 검사](../playwright.config.ts)로 다시 비교한다.

같은 날 깨끗한 소스에서 DB 검사만 실행하면 Web OIDC 경계가 사용하는 browser-auth 패키지의
빌드가 없어 실패했다. [루트 DB 검사](../package.json)가 직접 의존성을 준비하도록 수정했다.
이전 웹 빌드 결과가 없는 고정 소스에서 DB 검사를 실행하는 것이 재발 확인 경로다.

[DB 시험 자원 표시](database-resources.mjs)는 Delivery가 생성한 식별자만 허용한다.
일반 로컬 시험에는 적용하지 않으며, CI에서는 실행기가 중단된 뒤에도 해당 실행의 시험 DB만
찾아 정리할 수 있게 한다. 운영 DB와 사용자의 비밀값을 이 검사에 연결하지 않는다.
