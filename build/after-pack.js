'use strict';

const path = require('path');
const { signApp } = require('../scripts/mac-sign');

/**
 * electron-builder afterPack 훅 — macOS 애드혹 서명(+JIT 권한).
 *
 * 인증서(Developer ID) 없이 빌드하면 서명이 빠지는데, Apple Silicon 에서는
 * 서명에 com.apple.security.cs.allow-jit 권한이 없으면 앱이 V8(자바스크립트)
 * 초기화 단계에서 EXC_BREAKPOINT(SIGTRAP) 로 즉시 종료된다.
 *
 * 그래서 dmg 로 포장하기 전에, 앱과 모든 내부 바이너리를 "애드혹 서명 +
 * 하드닝드 런타임 + JIT 권한"으로 다시 서명한다. (scripts/mac-sign.js 재사용)
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return; // 맥에서만

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const entitlements = path.join(__dirname, 'entitlements.mac.plist');

  console.log('  • macOS 애드혹 서명(+JIT 권한):', appPath);
  try {
    signApp(appPath, entitlements);
    console.log('  • 서명 완료');
  } catch (err) {
    console.warn('  • 서명 실패(무시하고 계속):', err && err.message ? err.message : err);
  }
};
