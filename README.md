# X32 교회 음향 (Phase 1)

Behringer **X32 / M32** 디지털 믹서를 위한 교회 음향 자동화 데스크탑 앱입니다.
OSC(UDP) 로 콘솔과 통신하며, 예배 진행에 맞춘 Scene 전환과 피드백(하울링) 경고를
한국어 UI 로 제공합니다.

> **기술 스택**: Electron + Node.js · **통신**: OSC over UDP (X32 기본 포트 `10023`) ·
> **OSC 라이브러리**: [`node-osc`](https://www.npmjs.com/package/node-osc) ·
> **배포**: Windows / macOS (electron-builder)

---

## Phase 1 기능

1. **연결** — X32 IP 입력 후 연결하고 콘솔 정보(모델·펌웨어)를 확인합니다.
2. **채널 상태 읽기** — 채널별 이름 / 레벨(dB) / 음소거 / EQ 상태를 읽어옵니다.
   ("EQ 보기" 로 4밴드 EQ(주파수·게인·Q) 상세도 확인.)
3. **피드백 감지** — RTA 스펙트럼을 모니터링해 지속되는 좁은 피크(하울링)를
   감지하고 추정 주파수와 함께 경고합니다.
4. **Scene 템플릿** — 교회용 기본 장면(설교 / 찬양팀 / 기도·묵상 / 광고 /
   전체 음소거 / 기본 셋업)을 한 번에 적용합니다.
5. **한국어 UI**.

---

## 설치 및 실행

```bash
npm install        # 의존성 설치 (electron, node-osc)
npm start          # 앱 실행
npm run dev        # 개발자 도구를 띄운 채 실행
```

### 테스트

OSC 통신·변환·피드백 감지·Scene 로직은 가짜 X32(`test/mock-x32.js`)를 이용해
실제 UDP 루프백으로 검증합니다. (Electron 불필요)

```bash
npm test
```

### 배포 패키지 빌드

```bash
npm run dist:win   # Windows (NSIS 설치 파일)
npm run dist:mac   # macOS (DMG)
```

> 아이콘을 넣으려면 `build/icon.ico`(Windows), `build/icon.icns`(macOS) 를 추가하세요.
> 없어도 기본 아이콘으로 빌드됩니다.

---

## 사용 방법

1. 음향 PC 와 X32 를 같은 네트워크(유선 권장)에 연결합니다.
2. 앱 상단에 X32 **IP 주소**를 입력하고 **연결**을 누릅니다.
   (X32 의 IP 는 콘솔 `Setup → Network` 에서 확인)
3. **상태 읽기** 로 현재 채널 상태를 불러옵니다.
4. 예배 순서에 맞춰 **Scene 템플릿**을 눌러 적용합니다.
5. **피드백 감지 시작** 으로 하울링 모니터링을 켭니다.

### 피드백 감지 정확도 높이기

피드백 감지는 X32 의 **RTA(`/meters/15`)** 데이터를 사용합니다.
콘솔에서 RTA 소스를 **메인 L/R(스피커로 나가는 신호)** 로 지정하면
실제 하울링을 가장 잘 잡아냅니다. 우측 **민감도** 슬라이더로 감도를 조절하세요.

> 감지된 주파수는 "추정값"입니다. 해당 주파수를 GEQ/PEQ 에서 살짝 감쇠하면
> 하울링을 줄일 수 있습니다. 긴급 시 **전체 음소거** Scene 을 사용하세요.

---

## 교회용 기본 채널 배치

`src/main/scenes.js` 의 `DEFAULT_CHANNEL_MAP` 에서 우리 교회 콘솔에 맞게
채널 번호·이름·역할(`speech`/`vocal`/`inst`/`playback`)을 수정하세요.
역할에 따라 Scene 동작과 로우컷(HPF) 적용이 달라집니다.

| 채널 | 이름 | 역할 |
|------|------|------|
| 1 | 설교 마이크 | speech |
| 2 | 사회자 마이크 | speech |
| 5–8 | 찬양 보컬 | vocal |
| 9–14 | 악기(기타/베이스/키보드/드럼) | inst |
| 15–16 | 반주(MR)/노트북 | playback |

---

## 구조

```
src/
  main/
    main.js        Electron 메인 · IPC · 윈도우
    osc-bus.js     단일 UDP 소켓 OSC 버스(node-osc Server 기반, 양방향)
    x32.js         X32 매니저(연결/채널 읽기/미터 구독/Scene 적용)
    x32-util.js    페이더·EQ 값 ↔ dB/Hz 변환 (순수 함수)
    feedback.js    피드백(하울링) 감지기
    scenes.js      교회용 Scene 템플릿 + 채널 맵
  preload/
    preload.js     contextBridge 안전 API
  renderer/
    index.html / styles.css / renderer.js   한국어 UI
test/
    mock-x32.js    가짜 X32(UDP) · unit/integration 테스트
```

### OSC 통신 메모

X32 는 요청을 보낸 **출발 포트로 응답**하므로 보내기/받기를 같은 소켓으로
처리해야 합니다. 이 앱은 `node-osc` 의 `Server` 가 자신의 바인딩 소켓으로
`send()` 할 수 있다는 점을 이용해 **소켓 하나로 양방향 통신**을 구현합니다
(`src/main/osc-bus.js`). 또한 페이더/EQ 같은 float 파라미터는 `node-osc` 가
`1.0` 을 정수로 인코딩하지 않도록 명시적 `{type:'f'}` 로 전송합니다.

---

## 로드맵 (이후 단계)

- 사용자 정의 Scene 저장/불러오기, 콘솔 Scene/Snapshot 연동
- 채널 실시간 미터·페이더 양방향 동기화
- 자동 피드백 억제(감지 주파수 자동 노치)
- 다국어 지원

## 라이선스

MIT
