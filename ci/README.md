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
Admin 빌드가 `ENOSPC`로 실패했다. 준비된 의존성은 약 665 MB이며 작업 영역은 1 GiB다.
[검사 진입점](check.py)은 오프라인 설치 후 불필요해진 npm 캐시를 지우고, 그 임시 영역에
Admin 출력을 둔다. 같은 루트 전체 검사가 재발 확인 경로다.

[DB 시험 자원 표시](database-resources.mjs)는 Delivery가 생성한 식별자만 허용한다.
일반 로컬 시험에는 적용하지 않으며, CI에서는 실행기가 중단된 뒤에도 해당 실행의 시험 DB만
찾아 정리할 수 있게 한다. 운영 DB와 사용자의 비밀값을 이 검사에 연결하지 않는다.
