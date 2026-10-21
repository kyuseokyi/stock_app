from datetime import date

from shared.push_text import render_push_text


def test_date_placeholder_becomes_month_day():
    assert render_push_text("{date} 수익률 리포트가 올라왔어요", date(2026, 3, 5)) == "3월 5일 수익률 리포트가 올라왔어요"


def test_text_without_placeholder_unchanged():
    assert render_push_text("공지", date(2026, 10, 21)) == "공지"
