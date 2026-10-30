import Svg, { Polyline } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';

import { sparkPoints, sparkTone } from '../format';

/** 지수 미니 추세선(가로 꽉 참, 기본 높이 32). 점 2개 미만이면 그리지 않는다 */
export function Sparkline({ values, height = 32 }: { values: number[]; height?: number }) {
  const { theme } = useUnistyles();
  const points = sparkPoints(values);
  if (!points) return null;
  const color = sparkTone(values) === 'up' ? theme.colors.up : theme.colors.down;
  return (
    <Svg width="100%" height={height} viewBox="0 0 100 30" preserveAspectRatio="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}
