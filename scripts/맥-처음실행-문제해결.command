#!/bin/bash
# ============================================================
#  X32 교회 음향 · 맥 첫 실행 문제 해결
#
#  다운로드한 앱이 "손상되었기 때문에 열 수 없습니다" 라고 뜨면
#  이 파일을 더블클릭하세요. (터미널 명령 몰라도 됩니다.)
#
#  하는 일: 인터넷 다운로드 격리 표시 제거 (xattr) → 앱 실행.
#  ※ 앱이 손상된 게 아니라, 서명 안 된 앱을 macOS 가 막는 것뿐입니다.
# ============================================================

APP="/Applications/X32ChurchAudio.app"

echo ""
echo "  X32 교회 음향 · 첫 실행 문제 해결"
echo "  --------------------------------"

# 응용 프로그램에 없으면 같은 폴더나 다운로드에서 찾아본다
if [ ! -d "$APP" ]; then
  for CAND in "$(dirname "$0")/X32ChurchAudio.app" "$HOME/Downloads/X32ChurchAudio.app"; do
    if [ -d "$CAND" ]; then APP="$CAND"; break; fi
  done
fi

if [ ! -d "$APP" ]; then
  echo "  ⚠️  앱을 찾지 못했어요."
  echo "  먼저 dmg 를 열어 앱을 '응용 프로그램(Applications)' 폴더로"
  echo "  드래그해 설치한 뒤, 이 파일을 다시 더블클릭하세요."
  echo ""
  read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다..."
  exit 1
fi

echo "  격리 표시 제거 중...  ($APP)"
xattr -cr "$APP"

echo ""
echo "  ✅ 완료! 앱을 실행합니다."
echo ""
open "$APP"

read -n 1 -s -r -p "  아무 키나 누르면 이 창이 닫힙니다..."
echo ""
