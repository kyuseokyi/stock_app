"""봉 수·베이스 길이 계산(참고 utils 그대로)."""


def get_bar_count(start_idx: int, end_idx: int) -> int:
    return end_idx - start_idx + 1


def base_len(rim_idx: int, end_idx: int) -> int:
    """림→끝 원시 폭(양 끝 제외). 내부 거친 사전 필터 전용 — 실제 길이 판정·표시는 ms_base_length."""
    return end_idx - rim_idx


def ms_base_length(rim_idx: int, right_idx: int) -> int:
    """MarketSurge 베이스 길이: 림..마지막 베이스 봉(돌파 전날, 형성 중이면 마지막 봉) 포함.
    돌파봉 자체는 세지 않는다(AEP 림 2025-11-18 → 돌파 2026-02-12 = 58)."""
    return right_idx - rim_idx + 1
