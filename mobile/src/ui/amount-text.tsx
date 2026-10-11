import { Text, type TextStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { formatPct, formatSignedWon, formatWon } from './format';

type Props = {
  value: number;
  kind: 'won' | 'pct'; // 원화 / 퍼센트
  signed?: boolean; // 부호+등락색 적용(won에서 의미, pct는 항상 부호)
  size?: number;
  weight?: TextStyle['fontWeight'];
};

/** 금액/수익률 텍스트. signed면 up(빨강)/down(파랑)으로 색을 입힌다. */
export function AmountText({ value, kind, signed = false, size = 16, weight = '700' }: Props) {
  const { theme } = useUnistyles();
  const colored = signed || kind === 'pct';
  const color = !colored
    ? theme.colors.text
    : value > 0
      ? theme.colors.up
      : value < 0
        ? theme.colors.down
        : theme.colors.textSecondary;
  const label =
    kind === 'pct' ? formatPct(value) : signed ? formatSignedWon(value) : formatWon(value);
  return <Text style={{ color, fontSize: size, fontWeight: weight }}>{label}</Text>;
}
