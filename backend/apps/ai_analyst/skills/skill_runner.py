"""AI Lab B단계 추론기 — 스킬 루브릭 + 정량 팩트 JSON + DART 공시 목록으로 구조화 추론 1회, 응답 검증, 저장 값 조립.

입력은 A단계 정량 미리 보기(service.quant_preview 결과)와 DART 공시(제목·접수일·접수번호)뿐이다.
언론 기사 데이터는 받지도 넣지도 저장하지도 않는다(설계 0절).
숫자는 파이썬이 계산한다 — 기대수익률은 다시 계산하고, 손절·주식 수 등은 정량 팩트 값만 저장한다.
검증 규칙은 모두 순수 함수(DB·네트워크 없음). 클라이언트는 `.generate_json(prompt, schema, system=)` 와 `.model` 을 가진 객체.
설계: docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md 3절
"""
from __future__ import annotations

import copy
import json
import logging
import math
from dataclasses import dataclass
from datetime import date

from apps.ai_analyst.skills import skill_loader
from apps.ai_analyst.skills.schemas import (CONFIDENCES, IMPACT_GRADES, SIGNALS, VERDICTS, DartCatalyst,
                                            EvScenarios, SkillAnalysisResponse)

log = logging.getLogger(__name__)

DART_VIEW_URL = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"
PROB_TOLERANCE = 1.0  # 확률 합이 100±1 이면 그대로 둔다
MAX_CATALYSTS = 5
SUMMARY_LINES = 3
_SCENARIOS = ("bull", "base", "bear")
_CHAIN_NODES = ("trigger", "business", "earnings_flow", "price_momentum")

SYSTEM_PROMPT = """당신은 한국 주식 정량 분석 리포트를 해석하는 애널리스트입니다.
규칙:
1. 입력은 [스킬 루브릭], [정량 팩트 JSON], [DART 공시 목록] 세 가지뿐입니다. 그 밖의 정보(외부 기사, 커뮤니티, 기억 속 사실)는 쓰지 않습니다.
2. 숫자는 정량 팩트에 있는 값만 인용합니다. 팩트와 다른 숫자를 만들지 않습니다. 손절가·주식 수·리스크 비율은 계산하지 않습니다.
3. 시나리오 목표가는 정량 팩트의 종가(close)·손절(stop)·업종 비교(peer_valuation)에 근거해 정하고, bull·base·bear 확률 합은 100으로 맞춥니다.
4. dart_catalysts 의 rcept_no 는 [DART 공시 목록]에 있는 접수번호만 씁니다. 목록에 없는 공시를 만들지 않습니다. 공시 제목만으로 금액·규모를 추정하지 않습니다.
5. 각 스킬의 '출력 지침'은 참고만 하고, 최종 출력은 반드시 주어진 JSON 스키마의 필드에 맞춥니다.
6. 모든 문장은 한국어로, 짧고 구체적으로 씁니다. 투자 권유가 아닌 분석 의견입니다."""


# ---------------------------------------------------------------- 프롬프트

def dart_url(rcept_no: str) -> str:
    return DART_VIEW_URL.format(rcept_no=rcept_no)


def prompt_disclosures(preview: dict) -> list[dict]:
    """정량 미리 보기의 DART 분류 결과 → 프롬프트·검증용 공시 목록(제목·접수일·접수번호 + 파이썬 태그만)."""
    items = ((preview.get("dart") or {}).get("items")) or []
    out = []
    for it in items:
        rcept_no = str(it.get("rcept_no") or "").strip()
        if not rcept_no:
            continue
        out.append({"rcept_no": rcept_no, "rcept_dt": it.get("rcept_dt"), "title": it.get("title") or "",
                    "tag": it.get("tag"), "labels": list(it.get("labels") or [])})
    return out


def _facts_for_prompt(preview: dict) -> dict:
    """정량 팩트 JSON — 공시 항목은 [DART 공시 목록]으로 따로 넣으므로 요약(개수·오버행)만 남긴다."""
    facts = copy.deepcopy(preview)
    dart = facts.get("dart")
    if isinstance(dart, dict):
        dart.pop("items", None)
    return facts


def _dart_lines(disclosures: list[dict]) -> str:
    if not disclosures:
        return "최근 공시 없음(또는 공시 조회 불가)."
    lines = []
    for d in disclosures:
        tag = d.get("tag") or "태그 없음"
        labels = ",".join(d.get("labels") or [])
        lines.append(f"- rcept_no={d['rcept_no']} | 접수일={d.get('rcept_dt') or ''} | 제목={d['title']} | "
                     f"분류={tag}{f'({labels})' if labels else ''}")
    return "\n".join(lines)


def build_prompt(preview: dict, skill_ids: list[str] | None) -> tuple[str, str]:
    """(시스템 지시, 사용자 프롬프트). skill_ids=None 이면 설치된 스킬 전부."""
    rubric = skill_loader.build_combined_skill_prompt(skill_ids)
    facts = json.dumps(_facts_for_prompt(preview), ensure_ascii=False, default=str, indent=1)
    prompt = (
        f"# 분석 대상: {preview.get('name') or preview.get('ticker')} ({preview.get('ticker')}), "
        f"기준일 {preview.get('as_of')}, 종가 {preview.get('close')}\n\n"
        f"## [스킬 루브릭]\n\n{rubric}\n\n"
        f"## [정량 팩트 JSON] (파이썬 계산값 — 숫자는 여기서만 인용)\n\n```json\n{facts}\n```\n\n"
        f"## [DART 공시 목록] (최근 {(preview.get('dart') or {}).get('days', 90)}일, 제목·접수일·접수번호)\n\n"
        f"{_dart_lines(prompt_disclosures(preview))}\n"
    )
    return SYSTEM_PROMPT, prompt


# ---------------------------------------------------------------- 검증(순수 함수)

def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def validate_ev(ev: EvScenarios, close) -> tuple[dict | None, str | None]:
    """시나리오 검증·정규화·기대수익률 재계산. (결과, None) 또는 (None, 사유 코드).

    - 기준 종가가 없거나 0 이하 → CLOSE_INVALID
    - 목표가 0 이하(또는 숫자 아님) → EV_TARGET_INVALID
    - 확률 음수 또는 합 ≤ 0 → EV_PROB_INVALID, 합이 100±1 밖이면 비율대로 100 으로 정규화
    - weighted_ev_pct = Σ (목표가 / 종가 − 1) × 100 × 확률 / 100 — Gemini 값은 쓰지 않는다
    """
    base_close = _num(close)
    if base_close is None or base_close <= 0:
        return None, "CLOSE_INVALID"
    raw = {k: getattr(ev, k) for k in _SCENARIOS}
    targets = {k: _num(s.target_price) for k, s in raw.items()}
    if any(t is None or t <= 0 for t in targets.values()):
        return None, "EV_TARGET_INVALID"
    probs = {k: _num(s.probability_pct) for k, s in raw.items()}
    if any(p is None or p < 0 for p in probs.values()):
        return None, "EV_PROB_INVALID"
    total = sum(probs.values())
    if total <= 0:
        return None, "EV_PROB_INVALID"
    normalized = abs(total - 100.0) > PROB_TOLERANCE
    if normalized:
        probs = {k: p * 100.0 / total for k, p in probs.items()}
    scenarios = {}
    weighted = 0.0
    for k in _SCENARIOS:
        ret = (targets[k] / base_close - 1.0) * 100.0
        weighted += ret * probs[k] / 100.0
        conf = str(raw[k].confidence or "").strip().upper()
        scenarios[k] = {"target_price": targets[k], "probability_pct": round(probs[k], 2),
                        "expected_return_pct": round(ret, 2), "rationale": raw[k].rationale,
                        "confidence": conf if conf in CONFIDENCES else "LOW"}
    return {"base_close": base_close, "scenarios": scenarios, "weighted_ev_pct": round(weighted, 2),
            "prob_sum_raw": round(total, 2), "normalized": normalized}, None


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def filter_catalysts(items: list[DartCatalyst], disclosures: list[dict]) -> list[dict]:
    """입력 공시 목록에 있는 rcept_no 만 남기고(지어낸 공시 버림·중복은 첫 항목), 별점 1~5·감성 −1~1 로 자르고,
    제목·접수일·원문 링크는 파이썬이 붙인다. 임팩트 등급 순 → 별점 내림차순, 최대 5개."""
    known = {d["rcept_no"]: d for d in disclosures}
    out: list[dict] = []
    seen: set[str] = set()
    for c in items or []:
        rno = str(c.rcept_no or "").strip()
        if rno not in known or rno in seen:
            if rno not in known:
                log.info("AI Lab 촉매: 입력에 없는 접수번호 버림")
            continue
        seen.add(rno)
        grade = str(c.impact_grade or "").strip().lower()
        stars = _num(c.stars)
        sent = _num(c.sentiment)
        src = known[rno]
        out.append({
            "rcept_no": rno, "title": src["title"], "rcept_dt": src.get("rcept_dt"), "url": dart_url(rno),
            "impact_grade": grade if grade in IMPACT_GRADES else "general",
            "stars": int(_clamp(round(stars), 1, 5)) if stars is not None else 1,
            "sentiment": round(_clamp(sent, -1.0, 1.0), 2) if sent is not None else 0.0,
            "interpretation": c.interpretation,
        })
    out.sort(key=lambda x: (IMPACT_GRADES.index(x["impact_grade"]), -x["stars"]))
    return out[:MAX_CATALYSTS]


def validate_response(resp: SkillAnalysisResponse | None, preview: dict) -> tuple[dict | None, str | None]:
    """Gemini 응답 전체 검증 → (저장할 해석 묶음, None) 또는 (None, 사유 코드)."""
    if resp is None:
        return None, "NO_RESPONSE"
    verdict = str(resp.overall_verdict or "").strip().upper()
    if verdict not in VERDICTS:
        return None, "VERDICT_INVALID"
    signal = str(resp.thesis.signal or "").strip().upper()
    if signal not in SIGNALS:
        return None, "SIGNAL_INVALID"
    summary = [s.strip() for s in (resp.executive_summary or []) if s and s.strip()][:SUMMARY_LINES]
    if not summary:
        return None, "SUMMARY_EMPTY"
    ev, reason = validate_ev(resp.ev_scenarios, preview.get("close"))
    if ev is None:
        return None, reason
    return {
        "logic_chain": {k: getattr(resp.logic_chain, k).model_dump() for k in _CHAIN_NODES},
        "thesis": {"signal": signal, "hypothesis": resp.thesis.hypothesis,
                   "kill_switch": [s.strip() for s in resp.thesis.kill_switch or [] if s and s.strip()]},
        "ev": ev,
        "dart_catalysts": filter_catalysts(resp.dart_catalysts, prompt_disclosures(preview)),
        "sepa_comment": resp.sepa_comment, "exposure_comment": resp.exposure_comment,
        "valuation_comment": resp.valuation_comment,
        "overall_verdict": verdict, "executive_summary": summary,
    }, None


def build_report_values(preview: dict, valid: dict, model_name: str) -> dict:
    """저장 컬럼 값 — 숫자 묶음은 정량 팩트(파이썬)에서, 문장은 검증된 해석에서."""
    return {
        "ticker": preview["ticker"],
        "stock_name": (preview.get("name") or preview["ticker"])[:100],
        "as_of_date": date.fromisoformat(str(preview["as_of"])),
        "quant_facts": preview,
        "sepa_analysis": {**(preview.get("sepa") or {}), "stop": preview.get("stop"),
                          "split_cut": preview.get("split_cut"), "comment": valid["sepa_comment"]},
        "vibe_backtest": preview.get("backtest") or {},
        "exposure_and_sizing": {"market_breadth": preview.get("market_breadth"), "stop": preview.get("stop"),
                                "position": preview.get("position"), "position_error": preview.get("position_error"),
                                "liquidity": preview.get("liquidity"), "comment": valid["exposure_comment"]},
        "logic_chain_and_thesis": {"logic_chain": valid["logic_chain"], "thesis": valid["thesis"]},
        "ev_scenarios": valid["ev"],
        "k_dart_and_valuation": {"dart": preview.get("dart"), "peer_valuation": preview.get("peer_valuation"),
                                 "earnings_trend": preview.get("earnings_trend"), "annual": preview.get("annual"),
                                 "comment": valid["valuation_comment"]},
        "dart_catalysts": valid["dart_catalysts"],
        "overall_verdict": valid["overall_verdict"],
        "executive_summary": "\n".join(valid["executive_summary"]),
        "model_name": str(model_name or "")[:50],
    }


# ---------------------------------------------------------------- 실행

@dataclass
class RunResult:
    ok: bool
    values: dict | None = None
    reason: str | None = None


def run(preview: dict, skill_ids: list[str] | None, client) -> RunResult:
    """구조화 추론 1회 → 검증 → 저장 값. 실패는 사유 코드와 함께(저장은 호출 쪽 몫)."""
    system, prompt = build_prompt(preview, skill_ids)
    resp = client.generate_json(prompt, SkillAnalysisResponse, system=system)
    valid, reason = validate_response(resp, preview)
    if valid is None:
        log.warning("AI Lab 응답 거부 %s (%s)", preview.get("ticker"), reason)
        return RunResult(ok=False, reason=reason)
    return RunResult(ok=True, values=build_report_values(preview, valid, getattr(client, "model", "")))
