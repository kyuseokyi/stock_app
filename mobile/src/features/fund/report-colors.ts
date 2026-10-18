import type { ReportColors } from './report-web/report-page';

type ThemeColors = {
  background: string;
  surface: string;
  fill: string;
  border: string;
  text: string;
  textSecondary: string;
  primary: string;
  primarySoft: string;
  up: string;
  upSoft: string;
  down: string;
};

/** Unistyles 테마(파스텔 C안) → 리포트 페이지 CSS 변수 */
export function reportColors(c: ThemeColors): ReportColors {
  return {
    bg: c.background,
    surface: c.surface,
    'surface-2': c.fill,
    line: c.border,
    text: c.text,
    'text-2': c.textSecondary,
    'text-3': c.textSecondary,
    accent: c.primary,
    'accent-soft': c.primarySoft,
    up: c.up,
    down: c.down,
    warn: c.up,
    'warn-soft': c.upSoft,
  };
}
