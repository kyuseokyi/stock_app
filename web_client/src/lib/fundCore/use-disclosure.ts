// 리포트 기준일과 같은 날의 펀드공시(당일 연환산·장중 거래내용). 실패·날짜 없음은 조용히 null — 리포트 화면에 영향 없음.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { useEffect, useState } from 'react';

import { findDisclosureDay, isoOfEvalDate, type DisclosureDay, type DisclosureSource } from './disclosure';
import { evalDateOf } from './display';
import type { FundReport } from './types';

export function useDisclosureDay(report: FundReport | null, source: DisclosureSource): DisclosureDay | null {
  const iso = report ? isoOfEvalDate(evalDateOf(report)) : '';
  const [found, setFound] = useState<DisclosureDay | null>(null);

  useEffect(() => {
    if (!iso) return;
    let alive = true;
    source
      .get()
      .then((html) => {
        if (alive) setFound(findDisclosureDay(html, iso));
      })
      .catch(() => {}); // 공시는 덧붙이는 정보 — 못 받으면 안 보일 뿐
    return () => {
      alive = false;
    };
  }, [iso, source]);

  return found && found.date === iso ? found : null; // 기준일이 바뀐 직후 옛 날짜 값은 쓰지 않는다
}
