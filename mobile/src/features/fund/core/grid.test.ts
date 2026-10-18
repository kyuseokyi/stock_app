import { Grid, tokenize } from './grid';

const HTML = `<html><head><title>
 (7)테스트
</title><style>
.flx1 { color:#FF0000; }
.flx2 { background-color:red; }
</style></head><body><table>
<tr><td rowspan="2">A</td><td colspan="2">B&nbsp;&nbsp;b</td></tr>
<tr><td class="flx1">C</td><td class="flx2" style="font-weight: bold">D<br>E</td></tr>
<tr style="display: none"><td>숨김</td></tr>
<tr><td>F <a href="https://x.test/1">(링크)</a></td><td style="color:red">G</td><td><span style="font-weight:bold">굵게</span>보통</td></tr>
</table></body></html>`;

describe('tokenize', () => {
  const { title, css, rows } = tokenize(HTML);

  it('제목과 CSS 를 모은다', () => {
    expect(title.trim()).toBe('(7)테스트');
    expect(css).toContain('.flx1');
  });

  it('display:none 행은 건너뛴다', () => {
    expect(rows).toHaveLength(3);
    expect(rows.flat().some((c) => c.text === '숨김')).toBe(false);
  });

  it('nbsp·공백을 접고 <br> 은 줄바꿈으로 둔다', () => {
    expect(rows[0][1].text).toBe('B b');
    expect(rows[1][1].text).toBe('D\nE');
  });

  it('링크 라벨의 괄호를 벗기고 href 와 함께 모은다', () => {
    expect(rows[2][0].links).toEqual([['링크', 'https://x.test/1']]);
    expect(rows[2][0].text).toBe('F (링크)');
  });

  it('span 굵기를 조각별로 기록한다', () => {
    expect(rows[2][2].segs).toEqual([
      ['굵게', true],
      ['보통', false],
    ]);
    expect(rows[1][1].segs[0]).toEqual(['D', true]); // td 자체 style 굵게
  });
});

describe('Grid', () => {
  const { css, rows } = tokenize(HTML);
  const g = new Grid(rows, css);

  it('rowspan/colspan 을 풀어 열 위치를 정한다', () => {
    expect(g.text(0, 0)).toBe('A');
    expect(g.text(0, 1)).toBe('B b');
    expect(g.text(1, 1)).toBe('C'); // (1,0) 은 A 가 차지
    expect(g.text(1, 2)).toBe('D\nE');
    expect(g.at(1, 0)).toBeUndefined(); // 원점이 아닌 칸
  });

  it('row/cells 는 열·행 순으로 정렬한다', () => {
    expect(g.row(2).map((c) => c.text)).toEqual(['F (링크)', 'G', '굵게보통']);
    expect(g.cells(0, 2).map((c) => c.text)).toEqual(['A', 'B b', 'C', 'D\nE']);
  });

  it('빨간 글씨는 인라인 color 또는 .flxN CSS color 로 판정(background-color 제외)', () => {
    expect(g.isRed(g.at(1, 1)!)).toBe(true);
    expect(g.isRed(g.at(1, 2)!)).toBe(false);
    expect(g.isRed(g.at(2, 1)!)).toBe(true);
  });
});
