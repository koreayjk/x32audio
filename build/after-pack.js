'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

/**
 * electron-builder afterPack 훅.
 *
 * 서명 인증서(Apple Developer ID)가 없으면 electron-builder 는 서명을 통째로
 * 건너뛴다. 그런데 앱 이름/아이콘을 바꾸면서 원래 Electron 의 서명이 깨지기
 * 때문에, Apple Silicon(맥) 에서는 "서명이 유효하지 않은 앱"으로 간주돼
 * 실행 즉시 EXC_BREAKPOINT(SIGTRAP) 로 죽는다.
 *
 * 해결: dmg 로 포장하기 전에 앱을 "애드혹(ad-hoc) 서명"(--sign -)으로 다시
 * 서명한다. 인증서 없이도 로컬/교회 배포용으로 정상 실행된다.
 * (다른 맥으로 옮길 때는 격리 속성 제거가 필요할 수 있음: xattr -cr <앱>)
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return; // 맥에서만 필요

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`  • ad-hoc 서명 (인증서 없이 실행 가능하게): ${appPath}`);
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    console.log('  • ad-hoc 서명 완료');
  } catch (err) {
    console.warn('  • ad-hoc 서명 실패(무시하고 계속):', err && err.message ? err.message : err);
  }
};
