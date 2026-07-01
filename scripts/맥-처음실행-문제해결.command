#!/bin/bash
# ============================================================
#  X32 교회 음향 · 맥 첫 실행 문제 해결
#
#  앱이 켜자마자 꺼지거나 "손상됨/열 수 없음" 이 뜨면 이 파일을
#  더블클릭하세요. (터미널 명령 몰라도 됩니다.)
#
#  하는 일:
#   1) 격리 표시 제거 (xattr -cr)
#   2) 앱 + 내부 헬퍼/프레임워크를 JIT 권한 넣어 애드혹 재서명
#      (Apple Silicon 에서 JavaScript 엔진이 실행되려면 필수)
# ============================================================

APP="/Applications/X32 교회 음향.app"

echo ""
echo "  X32 교회 음향 · 첫 실행 문제 해결"
echo "  --------------------------------"

if [ ! -d "$APP" ]; then
  echo "  ⚠️  앱을 찾지 못했어요:"
  echo "      $APP"
  echo ""
  echo "  먼저 dmg 를 열어 앱을 '응용 프로그램(Applications)' 폴더로"
  echo "  드래그해 설치한 뒤, 이 파일을 다시 더블클릭하세요."
  echo ""
  read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다..."
  exit 1
fi

# JIT 권한 파일을 임시로 생성
ENT="$(mktemp -t x32ent).plist"
cat > "$ENT" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
</dict>
</plist>
PLIST

sign_one() {
  codesign --force --sign - --timestamp=none --options runtime --entitlements "$ENT" "$1" 2>/dev/null
}

echo "  1) 격리 표시 제거 중..."
xattr -cr "$APP"

echo "  2) 내부 헬퍼/프레임워크 서명 중..."
# 깊은 경로(내부)부터 서명: dylib/node, .framework, 헬퍼 .app
find "$APP/Contents/Frameworks" -depth \( -name "*.dylib" -o -name "*.node" -o -name "*.framework" -o -name "*.app" \) 2>/dev/null | while read -r item; do
  sign_one "$item"
done

echo "  3) 앱 서명 중..."
sign_one "$APP"

rm -f "$ENT"

echo ""
echo "  ✅ 완료! 앱을 실행합니다."
echo ""
open "$APP"

read -n 1 -s -r -p "  아무 키나 누르면 이 창이 닫힙니다..."
echo ""
