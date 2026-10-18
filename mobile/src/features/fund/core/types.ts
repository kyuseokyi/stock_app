// 펀드 리포트 데이터 — fund_report/convert.py 의 JSON 출력과 같은 모양(교차 검증 대상).
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
export type Seg = [text: string, bold: boolean];
export type Link = [label: string, href: string];
export type Pair = [key: string, value: string];

export type Notice = {
  label: string;
  signalsLabel: string;
  signals: Pair[];
  message: string;
  servicesLabel: string;
  services: string[];
  links: Link[];
};

export type Account = {
  name: string;
  values: Pair[];
  remarks: Pair[];
  remarkText: { title: string; lines: string[] } | null;
};
export type NoteBlock = { title: string; items: Seg[][]; links: Link[] };
export type AccountsSection = {
  kind: 'accounts';
  title: string;
  evalDate: string;
  group: string;
  accounts: Account[];
  notes: NoteBlock[];
};

export type StepItem = [key: string, value: string, highlight: boolean];
export type Step = { no: string; name: string; items: StepItem[] };
export type StepsSection = { kind: 'steps'; title: string; steps: Step[]; links: Link[] };

export type CertSection = { kind: 'cert'; title: string; companyLabel: string; company: string[]; fields: Pair[] };

export type Section = AccountsSection | StepsSection | CertSection;

export type FundReport = {
  title: string;
  investorNo: string;
  investorName: string;
  notice: Notice | null;
  sections: Section[];
};

export type ParseResult = { report: FundReport; missing: string[] };

// 오류는 Error + fundCode (Babel 에서 Error 상속 클래스의 instanceof 가 깨질 수 있어 클래스 대신 코드)
export type FundErrorCode = 'format' | 'fetch' | 'input';
export type FundError = Error & { fundCode: FundErrorCode };

export function fundError(code: FundErrorCode, message: string): FundError {
  return Object.assign(new Error(message), { fundCode: code });
}

export function isFundError(e: unknown, code?: FundErrorCode): e is FundError {
  return e instanceof Error && 'fundCode' in e && (code === undefined || (e as FundError).fundCode === code);
}
