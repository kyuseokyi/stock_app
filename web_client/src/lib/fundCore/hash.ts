// 원본 HTML 이 바뀌었는지 판단용(보안 목적 아님). web_client/src/lib/fundCore 와 동일.
export function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
