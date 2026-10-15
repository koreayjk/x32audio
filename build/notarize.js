'use strict';

const path = require('path');

/**
 * electron-builder afterSign 훅 — Developer ID 서명 후 Apple 공증(notarize).
 *
 * APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 환경변수가 "모두" 있을 때만
 * 공증을 수행하고, 하나라도 없으면 조용히 건너뛴다(자격증명 없는 빌드가 깨지지 않도록).
 *
 * 공증이 끝나면 macOS Gatekeeper 가 앱을 신뢰하므로, 받는 사람은 경고 없이
 * 그냥 더블클릭으로 실행할 수 있다.
 */
exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('  • Apple 공증 건너뜀 (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 미설정)');
    return;
  }

  let notarize;
  try {
    ({ notarize } = require('@electron/notarize'));
  } catch (_e) {
    console.warn('  • @electron/notarize 모듈을 찾을 수 없어 공증을 건너뜁니다.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`  • Apple 공증 중(notarize): ${appPath} — 보통 1~5분 걸려요`);
  await notarize({ appPath, appleId, appleIdPassword, teamId });
  console.log('  • 공증 완료 ✓ (이제 경고 없이 실행됩니다)');
};
