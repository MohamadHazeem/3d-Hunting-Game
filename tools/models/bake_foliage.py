"""Bake the foliage card atlases from photographed CC0 leaves, twigs, needle
sprays and grass blades (Poly Haven, see sources.json), and the fir bark.

    python3 -I tools/models/bake_foliage.py <download dir> public/models [preview.jpg]

Writes <out>/foliage/<name>_c.webp, <name>_a.png and <out>/bark/fir_bark_*.jpg.

Each atlas is 1024x1024 with four 512x512 cells, one cluster per cell, its
attachment point at the bottom centre of the cell. Written as two files so the
game can rebuild its own coverage-preserving mip chain on the CPU (a canvas
would lose the colour under transparent texels):
    <name>_c.webp  colour, bled out under the transparent parts
    <name>_a.png   coverage (alpha)
"""

import math
import os
import random
import site
import sys

# PIL and numpy live in the user site, which -I leaves out
sys.path.append(site.getusersitepackages())
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

SRC = os.path.join(sys.argv[1], 'tex')
OUT = os.path.join(sys.argv[2], 'foliage')
BARK_OUT = os.path.join(sys.argv[2], 'bark')
PREVIEW = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(OUT, exist_ok=True)
os.makedirs(BARK_OUT, exist_ok=True)
CELL = 512
DRY_GRADE = dict(mul=(1.0, 0.91, 0.68), sat=1.2, gain=0.95)

# cut-outs in the 2k source maps: (x0, y0, x1, y1)
FIR = [(388, 100, 852, 640), (1336, 88, 1916, 756), (1020, 536, 1288, 820), (632, 832, 1312, 1588), (1304, 936, 1952, 1700)]
FIR_SMALL = [(1112, 204, 1200, 468), (792, 596, 936, 784)]
PINE = [(72, 92, 448, 904), (1336, 700, 1916, 1060)]
SEARSIA = [(112, 156, 388, 432), (456, 152, 680, 344), (1032, 56, 1196, 408), (64, 424, 352, 796), (372, 476, 660, 808), (568, 280, 908, 492), (744, 468, 1020, 772)]
# twigs and which way their thick end points in the source
TWIGS = [((44, 776, 516, 2008), 'top'), ((568, 1008, 952, 2016), 'bottom'), ((980, 1360, 1184, 2012), 'bottom'), ((1120, 600, 1196, 964), 'bottom')]
ISLAND = [(32, 40, 300, 1048), (336, 40, 692, 804), (740, 64, 988, 740), (1060, 100, 1332, 744), (1420, 40, 1672, 848), (444, 1180, 728, 2048), (864, 1236, 1152, 2048), (36, 1288, 372, 2048)]
NEEDLES = [(48, 56, 248, 280), (420, 72, 592, 276), (704, 52, 932, 280), (1072, 96, 1272, 280)]
BLADES = [(64, 72, 336, 1976), (924, 116, 1256, 1564), (1792, 76, 2008, 2048), (304, 336, 616, 1992), (736, 476, 836, 1488), (1372, 348, 1696, 1832), (1628, 532, 1744, 1268), (1128, 916, 1296, 1648), (1656, 1496, 1752, 2044)]
CLUMPS = [(420, 1520, 1016, 1852), (1204, 1552, 1768, 1768), (1224, 1768, 1616, 2048), (512, 1824, 1012, 2048)]


def load(name, diff, alpha):
    d = Image.open(os.path.join(SRC, f'{name}__{diff}_2k.png')).convert('RGB')
    a = Image.open(os.path.join(SRC, f'{name}__{alpha}_2k.png')).convert('L').resize(d.size)
    d.putalpha(a)
    return d


def largest_component(mask):
    """Keep the biggest 4-connected blob of a boolean mask (simple flood fill)."""
    h, w = mask.shape
    seen = np.zeros_like(mask, bool)
    best = None
    best_n = 0
    for y0 in range(0, h, 2):
        for x0 in range(0, w, 2):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            stack = [(y0, x0)]
            seen[y0, x0] = True
            pts = []
            while stack:
                y, x = stack.pop()
                pts.append((y, x))
                for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True
                        stack.append((yy, xx))
            if len(pts) > best_n:
                best_n = len(pts)
                best = pts
    out = np.zeros_like(mask, bool)
    if best:
        ys, xs = zip(*best)
        out[list(ys), list(xs)] = True
    return out


def cut(img, box):
    """Crop a cut-out, keep only its own blob (neighbours can poke into the
    box) and trim to its alpha."""
    c = img.crop(box)
    a = np.array(c.getchannel('A'))
    small = Image.fromarray(a).resize((max(1, a.shape[1] // 4), max(1, a.shape[0] // 4)), Image.BILINEAR)
    keep = largest_component(np.array(small) > 60)
    keep = Image.fromarray((keep * 255).astype(np.uint8)).resize(c.size, Image.BILINEAR).filter(ImageFilter.MaxFilter(9))
    a = (a.astype(np.float32) * (np.array(keep) / 255.0)).astype(np.uint8)
    c.putalpha(Image.fromarray(a))
    bb = c.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    return c.crop(bb) if bb else c


def upright(sprite):
    """Rotate a leaf so its long axis is vertical (principal axis of alpha)."""
    a = np.array(sprite.getchannel('A')) > 100
    ys, xs = np.nonzero(a)
    if len(xs) < 10:
        return sprite
    cov = np.cov(np.vstack([xs - xs.mean(), ys - ys.mean()]))
    w, v = np.linalg.eigh(cov)
    ax = v[:, np.argmax(w)]
    ang = math.degrees(math.atan2(ax[1], ax[0]))
    return rot(sprite, ang - 90)


def rot(sprite, deg):
    # premultiplied while resampling so the edges don't go dark
    p = sprite.convert('RGBa').rotate(-deg, resample=Image.BICUBIC, expand=True)
    return p.convert('RGBA')


def scale(sprite, sx, sy=None):
    sy = sx if sy is None else sy
    w = max(1, int(round(sprite.width * sx)))
    h = max(1, int(round(sprite.height * sy)))
    return sprite.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')


def grade(sprite, mul=(1, 1, 1), sat=1.0, gain=1.0, gamma=1.0):
    """Colour-grade a sprite: saturation around its own luminance, then a
    per-channel multiply and gain."""
    arr = np.array(sprite).astype(np.float32) / 255.0
    rgb = arr[..., :3]
    lum = (rgb * np.array([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True)
    rgb = lum + (rgb - lum) * sat
    rgb = np.clip(rgb, 0, 1) ** gamma
    rgb = rgb * np.array(mul) * gain
    arr[..., :3] = np.clip(rgb, 0, 1)
    return Image.fromarray((arr * 255).astype(np.uint8))


def paste(canvas, sprite, cx, cy, anchor=(0.5, 0.5)):
    x = int(round(cx - sprite.width * anchor[0]))
    y = int(round(cy - sprite.height * anchor[1]))
    canvas.alpha_composite(sprite, (max(0, x), max(0, y)), (max(0, -x), max(0, -y)))


def rotate_about_base(sprite, deg):
    """Rotate a sprite whose base is at its bottom centre, returning the
    rotated sprite and where that base ended up."""
    w, h = sprite.size
    r = rot(sprite, deg)
    # base relative to centre, rotated (image y down)
    bx, by = 0, h / 2
    t = math.radians(deg)
    rx = bx * math.cos(t) - by * math.sin(t)
    ry = bx * math.sin(t) + by * math.cos(t)
    return r, (r.width / 2 + rx, r.height / 2 + ry)


def paste_base(canvas, sprite, deg, bx, by):
    r, (ox, oy) = rotate_about_base(sprite, deg)
    x = int(round(bx - ox))
    y = int(round(by - oy))
    canvas.alpha_composite(r, (max(0, x), max(0, y)), (max(0, -x), max(0, -y)))


def twig_points(twig, n, rnd, lo=0.25):
    """Random points on a twig's wood, away from its base (base at bottom)."""
    a = np.array(twig.getchannel('A')) > 128
    ys, xs = np.nonzero(a)
    h = twig.height
    keep = ys < h * (1 - lo)
    ys, xs = ys[keep], xs[keep]
    idx = [rnd.randrange(len(xs)) for _ in range(n)]
    return [(xs[i], ys[i]) for i in idx]


def new_cell():
    return Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))


def leaf_cluster(rnd, twigs, leaves, n, leaf_len, aspect, top_grade, under_grade, under=0.3, spread=55, twig_grade=None, size_var=0.35):
    """A twig carrying leaves: the twig stands on the cell's bottom centre and
    leaves grow from points along it, pointing away from the base, the ones at
    the back darker."""
    base = (CELL / 2, CELL - 2)
    # a few twigs fanning out from the bottom centre
    twig_layer = new_cell()
    nt = 3
    for j in range(nt):
        t = twigs[rnd.randrange(len(twigs))]
        L = CELL * (0.82 if j == 1 else rnd.uniform(0.5, 0.68))
        tw = scale(t, L / t.height)
        if tw.width > CELL * 0.6:
            tw = scale(tw, CELL * 0.6 / tw.width)
        if twig_grade:
            tw = grade(tw, **twig_grade)
        if rnd.random() < 0.5:
            tw = tw.transpose(Image.FLIP_LEFT_RIGHT)
        ang = (j - 1) * rnd.uniform(28, 40) + rnd.uniform(-6, 6)
        paste_base(twig_layer, tw, ang, base[0], base[1])
    pts = twig_points(twig_layer, n, rnd)
    order = list(range(n))
    rnd.shuffle(order)
    leaf_layer = new_cell()
    for k, i in enumerate(order):
        px, py = pts[i]
        depth = k / max(1, n - 1)  # 0 = back, 1 = front
        lf = leaves[rnd.randrange(len(leaves))]
        L = leaf_len * rnd.uniform(1 - size_var, 1 + size_var * 0.6)
        # leaf length L, width L * aspect
        lf = scale(lf, (L * aspect) / lf.width, L / lf.height)
        is_under = rnd.random() < under
        g = dict(under_grade if is_under else top_grade)
        g['gain'] = g.get('gain', 1.0) * (0.72 + 0.34 * depth) * rnd.uniform(0.88, 1.12)
        lf = grade(lf, **g)
        if rnd.random() < 0.5:
            lf = lf.transpose(Image.FLIP_LEFT_RIGHT)
        # point away from the twig base, with a spread
        ang = math.degrees(math.atan2(px - base[0], base[1] - py)) + rnd.uniform(-spread, spread)
        paste_base(leaf_layer, lf, ang, px, py)
        if k == n // 3:
            # the twig sits among the leaves, not all in front or behind
            leaf_layer.alpha_composite(twig_layer)
    return leaf_layer


def spray_cell(rnd, sprays, count, size, fan, tint, back_dark=0.7):
    """Conifer sprays fanning out from the bottom centre."""
    cell = new_cell()
    for k in range(count):
        sp = sprays[rnd.randrange(len(sprays))]
        s = size * rnd.uniform(0.8, 1.1) / max(sp.width, sp.height)
        sp = scale(sp, s)
        depth = k / max(1, count - 1)
        g = dict(tint)
        g['gain'] = g.get('gain', 1.0) * (back_dark + (1 - back_dark) * depth) * rnd.uniform(0.9, 1.08)
        sp = grade(sp, **g)
        if rnd.random() < 0.5:
            sp = sp.transpose(Image.FLIP_LEFT_RIGHT)
        ang = (k / max(1, count - 1) - 0.5) * 2 * fan + rnd.uniform(-10, 10) if count > 1 else rnd.uniform(-8, 8)
        bx = CELL / 2 + rnd.uniform(-CELL * 0.04, CELL * 0.04)
        by = CELL - 2 - rnd.uniform(0, CELL * 0.18) * (1 if count > 1 else 0)
        paste_base(cell, sp, ang, bx, by)
    return cell


def bleed(img):
    """Fill the colour under transparent texels from their neighbours (pull-
    push), so mip-mapping and filtering never pull in black."""
    arr = np.array(img).astype(np.float32) / 255.0
    rgb, a = arr[..., :3], arr[..., 3:4]
    w = (a > 0.02).astype(np.float32)
    levels = [(rgb * w, w)]
    while levels[-1][1].shape[0] > 1:
        c, ww = levels[-1]
        h2, w2 = c.shape[0] // 2, c.shape[1] // 2
        c = c[: h2 * 2, : w2 * 2].reshape(h2, 2, w2, 2, 3).sum((1, 3))
        ww = ww[: h2 * 2, : w2 * 2].reshape(h2, 2, w2, 2, 1).sum((1, 3))
        levels.append((c, ww))
    col = levels[-1][0] / np.maximum(levels[-1][1], 1e-6)
    for c, ww in reversed(levels[:-1]):
        up = np.repeat(np.repeat(col, 2, 0), 2, 1)[: c.shape[0], : c.shape[1]]
        own = c / np.maximum(ww, 1e-6)
        k = np.clip(ww, 0, 1)
        col = own * k + up * (1 - k)
    out = np.concatenate([col, a], -1)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))


def save_atlas(name, cells):
    atlas = Image.new('RGBA', (CELL * 2, CELL * 2), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        atlas.alpha_composite(c, ((i % 2) * CELL, (i // 2) * CELL))
    atlas = bleed(atlas)
    atlas.convert('RGB').save(os.path.join(OUT, f'{name}_c.webp'), quality=86, method=6)
    atlas.getchannel('A').save(os.path.join(OUT, f'{name}_a.png'), optimize=True)
    return atlas


def main():
    rnd = random.Random(7)
    fir_img = load('fir_tree_01', 'twig_diff', 'twig_alpha')
    sprays = [cut(fir_img, b) for b in FIR]
    small_sprays = [cut(fir_img, b) for b in FIR_SMALL]
    pine_img = load('pine_tree_01', 'twig_diff', 'twig_alpha')
    pine = [cut(pine_img, b) for b in PINE]
    # make the horizontal pine twig stand up like the other one
    pine[1] = rot(pine[1], -90)
    sears = load('searsia_lucida', 'Diffuse', 'Alpha')
    leaves = [upright(cut(sears, b)) for b in SEARSIA]
    burch = load('searsia_burchellii', 'Diffuse', 'Alpha')
    twigs = []
    for b, base in TWIGS:
        t = cut(burch, b)
        twigs.append(t.transpose(Image.FLIP_TOP_BOTTOM) if base == 'top' else t)
    isl = load('island_tree_02', 'leaves_diff', 'leaves_alpha')
    oak_leaves = [upright(cut(isl, b)) for b in ISLAND]
    roo = load('wild_rooibos_bush', 'Diffuse', 'Alpha')
    needles = [cut(roo, b) for b in NEEDLES]
    g2 = load('grass_medium_02', 'Diffuse', 'Alpha')
    g2d = load('grass_medium_02', 'dry_diff', 'Alpha')
    blades_g = [cut(g2, b) for b in BLADES]
    blades_d = [cut(g2d, b) for b in BLADES]
    g1d = load('grass_medium_01', 'dry_diff', 'Alpha')
    g1 = load('grass_medium_01', 'Diffuse', 'Alpha')
    clumps_d = [cut(g1d, b) for b in CLUMPS]
    clumps_g = [cut(g1, b) for b in CLUMPS]

    atlases = {}
    dark_twig = dict(mul=(0.62, 0.6, 0.58), sat=0.6)

    # Olive: narrow leaves, dark grey-green above and silvery beneath
    olive_top = dict(mul=(0.8, 0.88, 0.72), sat=0.32, gain=0.9, gamma=1.1)
    olive_under = dict(mul=(0.93, 0.98, 0.9), sat=0.16, gain=1.25, gamma=0.9)
    atlases['olive'] = [
        leaf_cluster(rnd, twigs, leaves, n, 66, 0.3, olive_top, olive_under, under=0.34, spread=60, twig_grade=dark_twig)
        for n in (240, 210, 260, 230)
    ]

    # Palestine oak: small, dense, dark glossy leaves
    oak_top = dict(mul=(0.7, 0.86, 0.55), sat=0.85, gain=0.92, gamma=1.05)
    oak_under = dict(mul=(0.78, 0.9, 0.62), sat=0.6, gain=1.1)
    atlases['oak'] = [
        leaf_cluster(rnd, twigs, oak_leaves, n, 50, 0.62, oak_top, oak_under, under=0.18, spread=75, twig_grade=dark_twig, size_var=0.3)
        for n in (330, 300, 350, 320)
    ]

    # Stone pine: tufts of long needles at the tips of short shoots
    pine_cells = []
    for k in range(4):
        c = spray_cell(rnd, pine, 4 + k % 2, CELL * 0.62, 38, dict(mul=(0.86, 1.0, 0.78), sat=0.95, gain=0.95), back_dark=0.62)
        # a few needle fascicles round the edge
        for j in range(10):
            nd = needles[rnd.randrange(len(needles))]
            nd = grade(scale(nd, CELL * 0.22 / nd.height), mul=(0.8, 0.95, 0.72), sat=0.8, gain=0.9 * rnd.uniform(0.8, 1.05))
            paste_base(c, nd, rnd.uniform(-70, 70), CELL / 2 + rnd.uniform(-60, 60), CELL * rnd.uniform(0.35, 0.75))
        pine_cells.append(c)
    atlases['pine'] = pine_cells

    # Cilician fir: one big spray per cell
    fir_tint = dict(mul=(0.9, 1.0, 0.9), sat=0.9, gain=1.18)
    atlases['fir'] = [spray_cell(rnd, [sprays[i]], 1, CELL * 0.96, 0, fir_tint) for i in (0, 1, 3, 4)]

    # Lebanon cedar: flat plates of short sprays, blue-green
    cedar_tint = dict(mul=(0.82, 0.96, 0.95), sat=0.55, gain=1.2)
    atlases['cedar'] = [spray_cell(rnd, sprays + small_sprays, n, CELL * 0.6, 55, cedar_tint) for n in (5, 6, 5, 7)]

    # Greek juniper: dense masses of fine grey-green sprays with a few berries
    jun_tint = dict(mul=(0.82, 0.94, 0.88), sat=0.45, gain=1.32)
    jun = []
    for n in (9, 11, 10, 12):
        c = spray_cell(rnd, sprays + small_sprays, n, CELL * 0.42, 70, jun_tint, back_dark=0.6)
        d = ImageDraw.Draw(c)
        a = np.array(c.getchannel('A'))
        for _ in range(26):
            x, y = rnd.randrange(60, CELL - 60), rnd.randrange(80, CELL - 30)
            if a[y, x] > 200:
                r = rnd.uniform(3.5, 5.5)
                v = rnd.randrange(55, 85)
                d.ellipse([x - r, y - r, x + r, y + r], fill=(v - 10, v, v + 30, 255))
        jun.append(c)
    atlases['juniper'] = jun

    # Garrigue: thorny burnet cushions (bare grey twigs, tiny leaves) and a
    # green lentisk / kermes-oak scrub
    burnet = []
    for k in range(2):
        c = new_cell()
        for j in range(5):
            t = twigs[rnd.randrange(len(twigs))]
            t = grade(scale(t, CELL * rnd.uniform(0.55, 0.8) / t.height), mul=(0.85, 0.8, 0.74), sat=0.5, gain=rnd.uniform(0.8, 1.1))
            paste_base(c, t, rnd.uniform(-60, 60), CELL / 2 + rnd.uniform(-40, 40), CELL - 2)
        lf = [grade(l, mul=(0.85, 0.9, 0.7), sat=0.4, gain=0.8) for l in leaves]
        a = np.array(c.getchannel('A')) > 128
        ys, xs = np.nonzero(a)
        for j in range(160):
            i = rnd.randrange(len(xs))
            l = scale(lf[rnd.randrange(len(lf))], 0.06 * rnd.uniform(0.8, 1.3))
            paste_base(c, l, rnd.uniform(0, 360), xs[i], ys[i])
        burnet.append(c)
    scrub_top = dict(mul=(0.7, 0.85, 0.55), sat=0.75, gain=0.9, gamma=1.05)
    for n in (180, 200):
        burnet.append(leaf_cluster(rnd, twigs, leaves, n, 46, 0.55, scrub_top, scrub_top, under=0.0, spread=80, twig_grade=dark_twig))
    atlases['shrub'] = burnet

    # Grass: tufts of photographed blades fanning from the root, dry and
    # green, and two of the photographed clumps
    def tuft(dry_share, n):
        c = new_cell()
        for k in range(n):
            dry = rnd.random() < dry_share
            b = (blades_d if dry else blades_g)[rnd.randrange(len(BLADES))]
            L = CELL * rnd.uniform(0.35, 0.95) ** 0.8
            # thinner than the photo: fine blades, many of them
            b = scale(b, max(0.03, L / b.height * 0.2 * rnd.uniform(0.75, 1.2)), L / b.height)
            depth = k / max(1, n - 1)
            g = dict(DRY_GRADE) if dry else dict(sat=1.05)
            g['gain'] = g.get('gain', 1.0) * (0.55 + 0.5 * depth) * rnd.uniform(0.88, 1.1)
            b = grade(b, **g)
            if rnd.random() < 0.5:
                b = b.transpose(Image.FLIP_LEFT_RIGHT)
            off = rnd.gauss(0, CELL * 0.045)
            ang = off / (CELL * 0.045) * 12 + rnd.uniform(-16, 16)
            paste_base(c, b, ang, CELL / 2 + off, CELL - 1)
        return c

    def clump(src, g=None):
        c = new_cell()
        cl = src[rnd.randrange(len(src))]
        cl = scale(cl, CELL * 0.98 / cl.width)
        if g:
            cl = grade(cl, **g)
        paste(c, cl, CELL / 2, CELL - 1, (0.5, 1.0))
        return c

    # the dry blades photograph pale and grey: warm them to sun-cured straw
    atlases['grass'] = [tuft(0.92, 130), clump(clumps_d, dict(mul=(1.0, 0.93, 0.8), sat=1.1)), tuft(0.3, 130), clump(clumps_g)]

    for name, cells in atlases.items():
        save_atlas(name, cells)
        print('baked', name)

    # fir bark for the fir and cedar trunks: 1k, recompressed
    for m in ('bark_diff', 'bark_nor_gl'):
        im = Image.open(os.path.join(SRC, f'fir_tree_01__{m}_1k.jpg')).convert('RGB')
        im.save(os.path.join(BARK_OUT, f'fir_{m}.jpg'), quality=82, optimize=True)

    if PREVIEW:
        names = list(atlases)
        T = 640
        sheet = Image.new('RGB', (4 * T, 2 * (T + 18)), (120, 120, 120))
        d = ImageDraw.Draw(sheet)
        for i, n in enumerate(names):
            a = Image.new('RGBA', (CELL * 2, CELL * 2), (0, 0, 0, 0))
            for j, c in enumerate(atlases[n]):
                a.alpha_composite(c, ((j % 2) * CELL, (j // 2) * CELL))
            bg = Image.new('RGBA', a.size, (150, 160, 170, 255))
            bg.alpha_composite(a)
            x, y = (i % 4) * T, (i // 4) * (T + 18)
            sheet.paste(bg.convert('RGB').resize((T, T)), (x, y + 18))
            d.text((x + 6, y + 3), n, fill=(255, 255, 255))
        sheet.save(PREVIEW, quality=88)


main()
