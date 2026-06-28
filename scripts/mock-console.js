'use strict';

/**
 * 가짜 X32 콘솔 (테스트용).
 *
 * 실제 X32 없이 앱 전체를 시험해 볼 수 있도록, OSC(UDP)로 응답하는 가짜 콘솔을
 * 띄운다. 앱에서 IP 를 127.0.0.1 로 입력해 연결하면 채널 읽기·Scene 적용·
 * 페이더 제어·피드백 표시까지 동작한다.
 *
 *   node scripts/mock-console.js          (포트 10023, X32 모드)
 *   PORT=10024 node scripts/mock-console.js   (X-Air 모드)
 *
 * 터미널에서 Enter 를 누르면 하울링(피드백) 신호를 켜고/끌 수 있다.
 */

const { MockX32 } = require('../test/mock-x32');

const NAMES = {
  1: '설교 마이크', 2: '사회자 마이크', 3: '보조 마이크', 4: '무선 핸드',
  5: '찬양 리드', 6: '찬양 보컬2', 7: '찬양 보컬3', 8: '찬양 보컬4',
  9: '어쿠스틱 기타', 10: '일렉 기타', 11: '베이스', 12: '키보드 L',
  13: '키보드 R', 14: '드럼', 15: '반주(MR)', 16: '노트북',
};

(async () => {
  const mock = new MockX32();

  // 보기 좋은 채널 이름 시드
  for (const [ch, name] of Object.entries(NAMES)) {
    mock.set(`/ch/${String(ch).padStart(2, '0')}/config/name`, [name]);
  }
  mock.set('/xinfo', ['127.0.0.1', 'MockX32', 'X32SIM', '4.06-sim']);

  // 미터/RTA 스펙트럼: 평소엔 잔잔, feedback 켜면 한 주파수에 강한 피크
  let feedback = false;
  mock.setSpectrumProvider(() => {
    const s = new Array(60).fill(0.06 + Math.random() * 0.03);
    if (feedback) s[34] = 0.97; // 약 2kHz 부근
    return s;
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 10023;
  await mock.start(port, '0.0.0.0');

  console.log('────────────────────────────────────────────');
  console.log(`  🎛️  가짜 X32 콘솔이 포트 ${port} 에서 대기 중`);
  console.log('  앱에서 IP를  127.0.0.1  로 입력해 연결하세요.');
  console.log('  (같은 PC가 아니면 이 컴퓨터의 LAN IP를 입력)');
  console.log('────────────────────────────────────────────');
  console.log('  ▶ Enter : 하울링(피드백) 신호 켜기/끄기');
  console.log('  ▶ Ctrl+C: 종료');
  console.log('────────────────────────────────────────────');

  process.stdin.resume();
  process.stdin.on('data', () => {
    feedback = !feedback;
    console.log(feedback ? '  >> 하울링 주입 ON (약 2kHz)' : '  >> 하울링 OFF');
  });
})();
