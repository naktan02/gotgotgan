# 회원 장소 가져오기 진단 도구

`member-connector`는 외부 장소 서비스의 저장 목록을
곳곳간으로 가져올 수 있는지 시험하는 도구다.

현재 기본 제품 흐름은 웹에서 링크를 넣어 가져오는 방식이다.
이 도구는 설치형 제품 기능이 아니라 parser와 로그인 제약을 확인하는 실험·진단용이다.

## 현재 가능한 것

- NAVER 저장 목록 응답 형식 확인
- 목록과 장소 수집 규칙 시험
- Chrome 계열 Extension 빌드 시험
- 전용 브라우저 프로필을 이용한 로그인·수집 시험
- 수집 결과를 일정한 snapshot 형식으로 만드는 코드
- 가져오기와 내보내기 흐름의 기본 코드

아직 실제 제품 기능으로 완료되지 않은 것:

- 신뢰할 수 있는 계정 식별
- 운영용 Connector 주소
- 외부 서비스에 실제로 다시 쓰는 기능
- 일반 사용자용 설치·업데이트 흐름

지원되지 않는 기능을 자동으로 다른 방식으로 우회하지 않는다.

## 폴더 구성

```text
src/
  application/   수집·snapshot·전달·내보내기 흐름
  adapters/      브라우저, NAVER, 곳곳간 연결 코드
  acquisition/   Playwright 기반 진단 수집
  observation/   값은 버리고 구조만 보는 진단
  entrypoints/   실행 명령과 조립 코드
```

외부 서비스별 URL, 응답 형식과 페이지 이동은
각 서비스 연결 코드 안에서만 관리한다.

## Desktop 진단

실제 로그인 상태를 확인할 때는 전용 Electron 창을 사용할 수 있다.
사용자의 평소 브라우저 프로필을 재사용하지 않는다.

```powershell
npm run desktop:naver --workspace @place/member-connector
```

로그인, 2차 인증, 보안 확인은 사용자가 직접 처리한다.
로그인 정보를 우회하거나 자동 입력하지 않는다.

현재 Desktop 흐름은 목록과 장소 수만 확인한다.
개인 장소 내용이나 로그인 정보는 화면과 일반 로그에 내보내지 않는다.

Desktop 코드 검사:

```powershell
npm run check:desktop --workspace @place/member-connector
```

## Extension 빌드

Chromium과 Firefox용 Extension을 만들 수 있다.
필요한 외부 주소는 빌드 설정으로 넣는다.

```powershell
npm run check:extension --workspace @place/member-connector
```

실제 Chrome, Edge, Whale, Firefox 설치와 로그인 상태는 별도 확인이 필요하다.

## Playwright 진단

Playwright 기반 로그인·관찰·수집 명령도 남아 있다.
이 경로는 제품 기본 흐름이 아니라 문제 확인과 회귀 시험용이다.

전용 프로필과 보고서 폴더는 저장소 밖에 둔다.
외부 서비스 주소도 로컬 설정으로 넣는다.

## 안전 규칙

- 평소 사용하는 Chrome 프로필을 자동화에 사용하지 않는다.
- 비밀번호, cookie, token과 원본 응답을 Git에 저장하지 않는다.
- 개인 데이터가 들어간 보고서는 저장소 밖에 둔다.
- 요청 시간, 응답 크기, 요청 수에는 상한을 둔다.
- 계정이 누구인지 확실하지 않으면 수집이나 전송을 진행하지 않는다.
- 외부 서비스에 값을 쓴 결과가 불확실하면 자동으로 다시 실행하지 않는다.
- 실제로 지원하지 않는 서비스를 다른 서비스처럼 처리하지 않는다.

## 검증

전체 Connector 검사는 다음 명령으로 실행한다.

```powershell
npm run check:member-connector
```

제품의 현재 가져오기 방향은
[웹 일회성 가져오기 결정](../../docs/adr/0025-web-one-shot-saved-place-imports.md)을 따른다.
