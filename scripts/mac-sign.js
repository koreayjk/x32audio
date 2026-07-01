'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * macOS 앱을 애드혹 서명(+JIT 권한)으로 다시 서명한다.
 * 인증서(Developer ID) 없이도 Apple Silicon 에서 정상 실행되게 한다.
 *
 * 내부 바이너리(프레임워크/헬퍼앱/dylib)를 깊은 경로부터 서명한 뒤
 * 마지막에 앱 번들을 서명해야 한다.
 *
 * @param {string} appPath        ".app" 경로
 * @param {string} entitlements   entitlements plist 경로 (allow-jit 등)
 */
function signApp(appPath, entitlements) {
  if (!fs.existsSync(appPath)) throw new Error(`앱을 찾을 수 없음: ${appPath}`);
  if (!fs.existsSync(entitlements)) throw new Error(`권한 파일을 찾을 수 없음: ${entitlements}`);

  const sign = (target) => {
    execFileSync('codesign', [
      '--force',
      '--sign', '-',                  // 애드혹(인증서 불필요)
      '--timestamp=none',
      '--options', 'runtime',          // 권한 적용을 위해 하드닝드 런타임
      '--entitlements', entitlements,  // JIT 등 권한
      target,
    ], { stdio: 'inherit' });
  };

  const targets = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return; }
    for (const name of entries) {
      const p = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(p); } catch (_) { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (name.endsWith('.app') || name.endsWith('.framework')) {
          walk(p);
          targets.push(p);
        } else {
          walk(p);
        }
      } else if (/\.(dylib|node)$/.test(name)) {
        targets.push(p);
      }
    }
  };
  walk(appPath);

  // 격리 표시 제거(방어적)
  try { execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' }); } catch (_) { /* 무시 */ }

  targets.sort((a, b) => b.length - a.length); // 깊은 경로부터
  for (const t of targets) {
    try { sign(t); } catch (err) {
      console.warn('  - 내부 서명 실패(계속):', path.basename(t), err && err.message ? err.message : err);
    }
  }
  sign(appPath); // 앱 번들은 마지막
}

module.exports = { signApp };

// CLI 로 직접 실행: node scripts/mac-sign.js "<App.app>" [entitlements.plist]
if (require.main === module) {
  const appPath = process.argv[2];
  const ent = process.argv[3] || path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
  if (!appPath) {
    console.error('사용법: node scripts/mac-sign.js "<App.app 경로>" [entitlements.plist]');
    process.exit(1);
  }
  try {
    signApp(appPath, ent);
    console.log('✅ 서명 완료:', appPath);
  } catch (err) {
    console.error('❌ 서명 실패:', err && err.message ? err.message : err);
    process.exit(1);
  }
}
