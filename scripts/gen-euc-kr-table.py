"""앱(Hermes)용 EUC-KR(CP949) 해독 표 생성 — Hermes 의 TextDecoder 는 euc-kr 을 모른다.

선두 바이트 0x81~0xFE × 후속 바이트 0x41~0xFE 의 모든 조합을 CP949 로 풀어 한 문자열로 이어 붙인다
(확장 한글 '똟' 등 KS X 1001 밖 글자 포함). 풀리지 않는 조합은 U+FFFD.
브라우저의 'euc-kr' 디코더도 실제로는 CP949(WHATWG 인코딩 표준)라 웹과 결과가 같다.

    python3 scripts/gen-euc-kr-table.py   # → mobile/src/features/fund/euc-kr-table.ts
"""
import json
import pathlib

LEAD = range(0x81, 0xFF)
TRAIL = range(0x41, 0xFF)

chars = []
for lead in LEAD:
    for trail in TRAIL:
        try:
            ch = bytes([lead, trail]).decode("cp949")
            chars.append(ch if len(ch) == 1 else "�")
        except UnicodeDecodeError:
            chars.append("�")

out = pathlib.Path(__file__).resolve().parent.parent / "mobile/src/features/fund/euc-kr-table.ts"
out.write_text(
    "// 생성 파일 — 고치지 말고 scripts/gen-euc-kr-table.py 로 다시 만든다.\n"
    "// CP949 2바이트 표: index = (lead - 0x81) * 190 + (trail - 0x41)\n"
    f"export const CP949_TABLE = {json.dumps(''.join(chars), ensure_ascii=False)};\n",
    encoding="utf-8",
)
print(out, len(chars))
