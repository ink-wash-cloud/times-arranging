# -*- coding: utf-8 -*-
"""
把完整中文字库裁剪成网页字体（woff2），体积通常能压到原来的 1/8 ~ 1/15。

用法：
    python scripts/subset-font.py <输入字体文件> [输出文件]

示例：
    python scripts/subset-font.py "C:/下载/汉仪文黑-85W.ttf"
    -> 生成 public/fonts/hanyi-wenhei-85w.woff2

默认输出到 public/fonts/hanyi-wenhei-85w.woff2，应用会自动加载它（优先于 ttf/otf）。

依赖：
    python -m pip install fonttools brotli

裁剪范围（可自行修改 KEEP_EXTRA）：
    · ASCII 可打印字符
    · GB2312 全部汉字（6763 个常用字）+ 全角符号
    · 中文标点、常用数学与货币符号
    · 本项目源码里出现过的所有字符（保证界面自身绝不会缺字）

注意：裁剪后，用户输入的罕见字（生僻名、异体字）可能不在字库内，
      会由系统字体接管显示，不会变成方框。
"""
import os
import sys
import glob

try:
    from fontTools import subset
    from fontTools.ttLib import TTFont
except ImportError:
    print("缺少依赖，请先运行：python -m pip install fonttools brotli")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "public", "fonts", "hanyi-wenhei-85w.woff2")

# 额外强制保留的字符（按需补充）
KEEP_EXTRA = "".join([
    "　、。〃々〈〉《》「」『』【】〔〕〖〗！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠",
    "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～",
    "·×÷±≈≠≤≥∞∴°′″℃￥＄€£‰§¶†‡※★☆○●◎◇◆□■△▲▽▼→←↑↓↔",
    "①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽",
    "💡🔥✅⚠️📌🎂❤️🎉🎓💍🏮🎄🌸⭐🎁💪📖🏃🧘💧🌙✍️🎯🥗🦷💻🎸✂️🩺📞🚿🛒🎬🧹💇🏥📷🕰️📅⚙️🏠📊🔔🖥️🎨📎⚡🔭⏳📋✨✓✕⏰📆🗓️💰🌞🌤️",
])


def build_charset():
    chars = set()
    # ASCII 可打印
    for i in range(0x20, 0x7F):
        chars.add(chr(i))
    # GB2312 一、二级汉字 + 全角符号
    for hi in range(0xA1, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    # 项目源码里出现的所有字符
    scanned = 0
    for pattern in ("src/**/*.ts", "src/**/*.tsx", "src/**/*.css", "index.html"):
        for path in glob.glob(os.path.join(ROOT, pattern), recursive=True):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    chars.update(f.read())
                scanned += 1
            except OSError:
                pass
    chars.update(KEEP_EXTRA)
    chars = {c for c in chars if c.strip() or c == " "}
    print("  扫描了 %d 个源码文件" % scanned)
    return "".join(sorted(chars))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    lossless = "--no-subset" in sys.argv

    if not args:
        print(__doc__)
        sys.exit(1)

    src = args[0]
    out = args[1] if len(args) > 1 else DEFAULT_OUT
    if not os.path.isfile(src):
        print("找不到输入字体：" + src)
        sys.exit(1)

    os.makedirs(os.path.dirname(out), exist_ok=True)

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]      # 保留 OpenType 特性（标点挤压、字距等）
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    options.drop_tables += ["DSIG", "meta"]   # 这两个表不支持裁剪，直接丢弃
    options.desubroutinize = False

    # 直接打开而不是 subset.load_font：这样 .ttc 字体集合也能取第 0 个字重
    try:
        font = TTFont(src, fontNumber=0, lazy=False)
    except Exception:
        font = TTFont(src, lazy=False)

    if lossless:
        # 无损：只做 woff2 压缩，一个字形都不丢
        print("  无损模式：保留全部 %d 个字形" % len(font.getGlyphOrder()))
        font.flavor = "woff2"
        font.save(out)
    else:
        text = build_charset()
        print("  保留字符数：%d" % len(text))
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(text=text)
        subsetter.subset(font)
        subset.save_font(font, out, options)
    font.close()

    before = os.path.getsize(src) / 1024 / 1024
    after = os.path.getsize(out) / 1024 / 1024
    print("")
    print("  输入 %s  (%.1f MB)" % (os.path.basename(src), before))
    print("  输出 %s  (%.2f MB)" % (os.path.relpath(out, ROOT), after))
    print("  体积降到原来的 %.0f%%" % (after / before * 100))
    print("")
    print("  重新构建后即可生效：npm run build")


if __name__ == "__main__":
    main()
