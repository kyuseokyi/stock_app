import sys, os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

font_path, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

# ---- 색 대비 ----
def lum(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
    c = [x/12.92 if x <= .03928 else ((x+.055)/1.055)**2.4 for x in c]
    return .2126*c[0] + .7152*c[1] + .0722*c[2]
def cr(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True); return (la+.05)/(lb+.05)
C = dict(blue='#5B7BE9', pink='#E0588E', ink='#25223A', lav='#F7F5FF',
         dark='#1A1826', blue_d='#9FB4F7', pink_d='#F0A0C0')
for k, bg in [('blue', '#FFFFFF'), ('pink', '#FFFFFF'), ('blue', C['lav']), ('pink', C['lav']), ('ink', '#FFFFFF'),
              ('blue_d', C['dark']), ('pink_d', C['dark'])]:
    print(f'contrast {k} on {bg}: {cr(C[k], bg):.2f}')

# ---- 기호(256 캔버스, 선 → 면) ----
U = 'M32 72A18 18 0 0 1 68 72V120A58 58 0 0 0 184 120V112A18 18 0 0 1 220 112V120A94 94 0 0 1 32 120Z'
DOT = (202, 54, 22)
U_S = 'M28 70A22 22 0 0 1 72 70V120A56 56 0 0 0 184 120V116A22 22 0 0 1 228 116V120A100 100 0 0 1 28 120Z'
DOT_S = (206, 44, 26)
def circ(cx, cy, r): return f'M{cx-r} {cy}A{r} {r} 0 1 0 {cx+r} {cy}A{r} {r} 0 1 0 {cx-r} {cy}Z'
def sym(u, dot, cu, cd, tx=0, ty=0, s=1):
    g = f'<path fill="{cu}" d="{u}"/><path fill="{cd}" d="{circ(*dot)}"/>'
    return g if (tx, ty, s) == (0, 0, 1) else f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.4f})">{g}</g>'
def svg(w, h, body, title, bg=None):
    b = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}"><title>{title}</title>{b}{body}</svg>\n'
def save(name, s): open(os.path.join(out, name), 'w').write(s)

save('symbol-black.svg', svg(256, 256, sym(U, DOT, '#000', '#000'), 'FunNote'))
save('symbol-color.svg', svg(256, 256, sym(U, DOT, C['blue'], C['pink']), 'FunNote'))
save('symbol-reversed.svg', svg(256, 256, sym(U, DOT, C['blue_d'], C['pink_d']), 'FunNote', C['dark']))
save('symbol-small-black.svg', svg(256, 256, sym(U_S, DOT_S, '#000', '#000'), 'FunNote'))
save('symbol-small-color.svg', svg(256, 256, sym(U_S, DOT_S, C['blue'], C['pink']), 'FunNote'))

# ---- 글자 로고(Manrope 800 → 외곽선) ----
f = TTFont(font_path)
f = instantiateVariableFont(f, {'wght': 800})
gs, cmap, hmtx = f.getGlyphSet(), f.getBestCmap(), f['hmtx']
cap = f['OS/2'].sCapHeight
TEXT, TRACK = 'FunNote', -0.01 * f['head'].unitsPerEm
def word(text, cap_px, color, x0, baseline):
    s = cap_px / cap; x = 0; parts = []
    for ch in text:
        gn = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[gn].draw(TransformPen(pen, (s, 0, 0, -s, x0 + x*s, baseline)))
        parts.append(pen.getCommands()); x += hmtx[gn][0] + TRACK
    bp = BoundsPen(gs); xx = 0
    for ch in text:
        gn = cmap[ord(ch)]; gs[gn].draw(TransformPen(bp, (1, 0, 0, 1, xx, 0))); xx += hmtx[gn][0] + TRACK
    xmin, ymin, xmax, ymax = bp.bounds
    return f'<path fill="{color}" d="{" ".join(parts)}"/>', (xmax - xmin) * s, xmin * s, ymin * s, ymax * s
# 단독 글자 로고: 대문자 높이 100
_, w, xm, ymn, ymx = word(TEXT, 100, '#000', 0, 0)
pad = 4; H = ymx - ymn + 2*pad
for nm, col, bg in [('black', '#000', None), ('color', C['ink'], None), ('reversed', '#F3F1FA', C['dark'])]:
    p, *_ = word(TEXT, 100, col, pad - xm, pad + ymx)
    save(f'wordmark-{nm}.svg', svg(w + 2*pad, H, p, 'FunNote', bg))

# 기호 실제 범위(256 캔버스): x 32~224, y 32~214
SX0, SX1, SY0, SY1 = 32, 224, 32, 214
def horiz(cu, cd, cw, bg, name):
    capx = 0.50 * 256  # 기호 높이 대비 대문자 높이
    s = 256 / (SY1 - SY0)        # 기호를 높이 256으로
    gap = 0.20 * 256
    _, ww, xm2, y0, y1 = word(TEXT, capx, cw, 0, 0)
    sym_w = (SX1 - SX0) * s
    tx = gap + sym_w; baseline = 128 + capx / 2   # 대문자 높이를 기호 중심에 맞춤
    p, *_ = word(TEXT, capx, cw, tx - xm2, baseline)
    W = tx + ww
    save(name, svg(W, 256, sym(U, DOT, cu, cd, -SX0*s, -SY0*s, s) + p, 'FunNote', bg))
def stacked(cu, cd, cw, bg, name):
    s = 256 / (SY1 - SY0); sym_w = (SX1 - SX0) * s
    capx = 0.27 * 256
    _, ww, xm2, y0, y1 = word(TEXT, capx, cw, 0, 0)
    W = max(ww, sym_w); gap = 0.20 * 256
    baseline = 256 + gap + capx
    p, *_ = word(TEXT, capx, cw, (W - ww)/2 - xm2, baseline)
    H = baseline - y0 if y0 < 0 else baseline
    H = baseline + max(0, -(y0)) + 4
    save(name, svg(W, H, sym(U, DOT, cu, cd, (W - sym_w)/2 - SX0*s, -SY0*s, s) + p, 'FunNote', bg))
horiz('#000', '#000', '#000', None, 'lockup-horizontal-black.svg')
horiz(C['blue'], C['pink'], C['ink'], None, 'lockup-horizontal-color.svg')
horiz(C['blue_d'], C['pink_d'], '#F3F1FA', C['dark'], 'lockup-horizontal-reversed.svg')
stacked('#000', '#000', '#000', None, 'lockup-stacked-black.svg')
stacked(C['blue'], C['pink'], C['ink'], None, 'lockup-stacked-color.svg')
stacked(C['blue_d'], C['pink_d'], '#F3F1FA', C['dark'], 'lockup-stacked-reversed.svg')
print('done', sorted(os.listdir(out)))
