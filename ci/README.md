# 곳곳간 Jenkins 검사

고정 소스를 검사하고, 같은 소스에서 만든 산출물을 인수한 뒤 Controller에 등록한다.

```text
고정 소스 ─┬─ Linux 전체 검사 → 두 웹 앱·Backend·Connector·브라우저 회귀
           └─ 기존 Windows Actions → 계약·배포 선언·Connector 진단과 확장 빌드
고정 소스 ─── 세 운영 이미지 → source-only 실행·Worker → 시험 DB·복원 → 같은 이미지 ID 보관
                                  ↓
                    산출물·복원 검증 → Controller 인수 → 전환
```

검사 범위와 도구 버전은 [실행 선언](execution.json), 준비 방법은
[도구 이미지](Dockerfile)와 [검사 진입점](check.py)에서 확인한다.
[도구 선언](tools.json)의 registry digest와 Linux `docker-builder` profile을 연결해 커밋을 등록한다.
Windows 검사는 기존 Actions에서 계속 실행한다. heavy Agent의 실제 자원 한도는 호스트 관리자가 배정한다.
Linux 기본 검사는 네트워크 없는 컨테이너에서 기존 루트 `npm run check`를 실행한다.
Windows 검사는 진단 Connector의 해당 OS 동작을 확인하며, 일반 사용자용 설치 제품이나
실제 NAVER 로그인·수집 완료를 뜻하지 않는다. 제품 상태는
[Connector 안내](../apps/member-connector/README.md)가 소유한다.

[산출물 선언](release.json)과 [이미지 검사](build-images.py)는 제품의 기존 세 이미지 대상을
그대로 사용한다. source-only 상태 확인은 실제 Identity 로그인을 증명하지 않는다.
DB 검사는 기존 migration·권한·암호화 세션·덤프 복원 경계를 시험 데이터로 확인한다.
같은 호스트 복원이며 독립 백업 저장소나 운영 데이터로 실행하지 않는다.
[Linux 이미지 진입점](build-images-linux.py)은 [전용 빌드 도구](Dockerfile.builder)의 고정 Python·Node·npm을
사용해 기존 검사를 호출한다. 이 도구 컨테이너만 별도 빌드 daemon의 소켓과 loopback을 사용하며,
중첩 fixture 경로를 동일하게 연결한다. 제품 검사 컨테이너의 네트워크·소켓 제한은 유지한다.

기존 Actions는 실제 Jenkins 검사·상태 보고·산출물 다운로드·실패 복구를 인수할 때까지 유지한다.
이 후보는 원본 작업 트리의 진행 중인 데이터 수집 변경과 별도로 검증하며, 통합은 별도 확인 대상이다.
운영 Identity·Gateway 연결과 게시·활성화 조건은 [배포 선언 안내](../deploy/README.md)를 따른다.

Actions의 전체 검사도 같은 [도구 이미지 정의](Dockerfile)를 로컬 빌드해 사용한다.
[Actions 진입점](actions-check.py)은 이미지에 포함된 소스를 격리된 작업 영역으로 복사하고
기존 Linux 검사를 실행한다. 실패 자료만 호스트로 내보내며 registry 게시나 비공개 이미지 읽기 권한은
필요하지 않다. 실제 Jenkins 상태 보고를 인수하기 전까지 Actions 검사 자체는 유지한다.

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

2026-10-18 같은 소스의 GitHub Ubuntu 24.04 검사에서는 설정 화면 네 개의 글꼴 가장자리와 굵기가
Debian 기준 이미지와 달랐다. 기능 검사 101개는 통과했으며 실제·기대·차이 이미지에서 내용과 배치는
같았다. Linux라는 이름만으로 렌더링 환경을 같게 취급할 수 없어 Actions도 위의 고정 환경을 사용한다.
기준 이미지와 허용 오차는 유지한다. 재발 확인은 기존 루트 전체 검사와 실패 시 보고서 보존이며,
GitHub 호스트에서의 최종 확인은 해당 PR 검사 결과로 판단한다.
[Playwright 화면 비교 안내](https://playwright.dev/docs/test-snapshots)도 기준 이미지와 같은 환경을 요구한다.

같은 날 고정 환경의 GitHub 검사에서는 데스크톱 기준 화면이 통과한 뒤 Web 서버 접속이 끊겨
나머지 검사들이 연결 거부로 실패했다. 같은 커밋을 4 GiB·swap 0 컨테이너에서 실행하자 이 현상이
재현됐고 cgroup의 `oom_kill`이 1 증가했다. 기존 로컬 성공은 swap을 명시하지 않은 조건이었다.
고정 Next 16.3 개발 CLI는 호스트 메모리의 절반으로 V8 힙 한도를 다시 설정한다. 실제 시험 서버는
컨테이너 한도와 무관하게 16 GiB 호스트에서 `7997 MiB`를 받았다. GC 전에 컨테이너가 종료될 수
있어 [E2E 실행기](../scripts/run-e2e.mjs)가 격리 CI의 Next 프로세스에만 힙 한도를 명시한다.
힙을 제한한 6 GiB 시험에서도 Next의 전체 RSS가 4 GiB 이상으로 늘어 부족 종료가 발생했다.
고정 Turbopack의 캐시 회수 정책도 같은 한도에서 부족 종료를 막지 못했다. 격리 E2E는 같은 Next
개발 서버의 공식 Webpack 모드로 실행한다. 일반 개발과 운영 빌드의 컴파일러는 유지한다.
Webpack의 2 GiB 힙 시험에서는 컨테이너 OOM 없이도 힙 사용률 80%에서 Next가 자동 재시작해
진행 중인 브라우저 요청이 끊겼다. 격리 CI의 힙 한도는 3 GiB로 정하고 전체 검사를 재확인한다.
RAM 작업 공간에 이미 검증한 두 운영 빌드도 남아 있어
사용이 끝난 `.next` 출력을 정리하고, [검사 진입점](check.py)은 설치가 끝난 패키지 캐시를 반납한다.
별도 [이미지 빌드](build-images.py)는 고정 소스에서 다시 빌드하므로 이 출력을 소비하지 않는다.
명시한 힙 한도에서도 전체 앱 검사는 4 GiB에서 부족 종료가 발생했다. heavy Agent의 검증 예산은
메모리 6 GiB와 RAM 작업 공간 3 GiB이며 Actions도 같은 한도를 사용한다.
[삭제 경계 회귀](../scripts/run-e2e.test.mjs)는
일반 개발 출력 보존과 작업 공간 내부·외부로 재지정된 디렉터리의 삭제 거부를 확인한다.
Web 서버 종료는 즉시 브라우저 검사 실패로 전파하며 [Actions 진입점](actions-check.py)이 메모리
한도·최대 사용량·부족 종료 카운터를 실패 보고서에 보존한다. 재발 확인은 swap 없는 6 GiB
조건에서 전체 검사 통과와 `oom_kill` 증가 없음이며, GitHub에서의 최종 확인은 새 PR 검사로 구분한다.

같은 날 깨끗한 소스에서 DB 검사만 실행하면 Web OIDC 경계가 사용하는 browser-auth 패키지의
빌드가 없어 실패했다. [루트 DB 검사](../package.json)가 직접 의존성을 준비하도록 수정했다.
이전 웹 빌드 결과가 없는 고정 소스에서 DB 검사를 실행하는 것이 재발 확인 경로다.

[DB 시험 자원 표시](database-resources.mjs)는 Delivery가 생성한 식별자만 허용한다.
일반 로컬 시험에는 적용하지 않으며, CI에서는 실행기가 중단된 뒤에도 해당 실행의 시험 DB만
찾아 정리할 수 있게 한다. 운영 DB와 사용자의 비밀값을 이 검사에 연결하지 않는다.
