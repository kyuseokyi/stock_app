// 백그라운드 알림 태스크의 data 는 FCM·APNs 원본 payload 라 모양이 문서에 없다(Expo 문서 2026-10-21 확인).
// 알려진 후보를 차례로 본다: 객체 data / JSON 문자열 body / Android dataString / 최상위 type.
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

function typeIn(v: unknown): string | null {
  if (isObj(v) && typeof v.type === "string") return v.type;
  if (typeof v === "string") {
    try {
      return typeIn(JSON.parse(v));
    } catch {
      return null;
    }
  }
  return null;
}

const get = (v: unknown, ...path: string[]): unknown => {
  let cur: unknown = v;
  for (const k of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
};

export function pushTypeOf(payload: unknown): string | null {
  if (!isObj(payload)) return null;
  const candidates: unknown[] = [
    payload,
    payload.data,
    get(payload, "data", "data"), // 객체 또는 JSON 문자열
    get(payload, "data", "body"),
    get(payload, "data", "dataString"),
    get(payload, "data", "notification", "data"),
    get(payload, "notification", "request", "content", "data"),
    payload.body,
    payload.dataString,
  ];
  for (const c of candidates) {
    const t = typeIn(c);
    if (t) return t;
  }
  return null;
}
