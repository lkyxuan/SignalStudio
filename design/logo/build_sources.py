"""Generate the two approved review directions; does not change product assets."""
from pathlib import Path
from html import escape

HERE = Path(__file__).resolve().parent
ORANGE = "#FF8A24"
DARK = "#131419"


def mark(variant, color=ORANGE, terminal=None):
    if variant == "a":
        terminal = terminal or color
        return (f'<path d="M98 27H46L29 44V49L96 76V83L79 101H30" '
                f'fill="none" stroke="{color}" stroke-width="12" stroke-linejoin="round" '
                f'stroke-linecap="round"/>'
                f'<circle cx="98" cy="27" r="10" fill="{terminal}"/>'
                f'<circle cx="30" cy="101" r="10" fill="{terminal}"/>')
    return (f'<path d="M94 20H40L20 40V53L76 76V88H20V106H86L106 86V62L50 39V38H94Z" '
            f'fill="{color}"/>')


def svg(body, width, height, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">'
            f'<title>{escape(title)}</title>{body}</svg>\n')


def text(x, y, value, size=20, fill="#FFFFFF", weight=400):
    return (f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" '
            f'font-weight="{weight}" font-family="Helvetica Neue, Arial, PingFang SC, sans-serif">'
            f'{escape(value)}</text>')


def placed(variant, x, y, size, color=ORANGE, terminal=None):
    return f'<g transform="translate({x} {y}) scale({size / 128})">{mark(variant, color, terminal)}</g>'


def icon(variant, x, y, size):
    return (f'<g transform="translate({x} {y}) scale({size / 128})">'
            f'<rect x="8" y="8" width="112" height="112" rx="26" fill="{DARK}"/>'
            f'<g transform="translate(24 24) scale(.625)">{mark(variant, terminal="#FFFFFF" if variant == "a" else None)}</g></g>')


def main():
    for variant in ("a", "b"):
        (HERE / f"{variant}-mark.svg").write_text(svg(mark(variant), 128, 128, f"SignalStudio {variant.upper()} mark"))
        (HERE / f"{variant}-mark-dark.svg").write_text(svg(mark(variant, terminal="#FFFFFF" if variant == "a" else None), 128, 128, f"SignalStudio {variant.upper()} mark for dark backgrounds"))
        (HERE / f"{variant}-mark-mono.svg").write_text(svg(mark(variant, DARK), 128, 128, f"SignalStudio {variant.upper()} monochrome mark"))
        (HERE / f"{variant}-app-icon.svg").write_text(svg(icon(variant, 0, 0, 1024), 1024, 1024, f"SignalStudio {variant.upper()} app icon"))
        for theme in ("dark", "light"):
            ink = "#FFFFFF" if theme == "dark" else DARK
            color = ORANGE if theme == "dark" else DARK
            body = placed(variant, 0, 0, 64, color, ink if variant == "a" else None) + text(82, 45, "SignalStudio", 40, ink, 600)
            (HERE / f"{variant}-wordmark-{theme}.svg").write_text(svg(body, 342, 64, f"SignalStudio {variant.upper()} wordmark for {theme} background"))

    body = [f'<rect width="1600" height="1220" fill="{DARK}"/>',
            text(70, 64, "SignalStudio", 34, weight=600),
            text(70, 101, "LOGO STUDIES / 01", 14, "#A0A0AA"),
            text(1250, 68, "REVIEW · 2026.10", 15, "#A0A0AA"),
            '<path d="M70 133H1530" stroke="#35353D"/>']
    for variant, x, title, subtitle in (("a", 70, "A / Signal path", "S + connected terminals"),
                                       ("b", 840, "B / Compact S", "Solid geometric silhouette")):
        body += [text(x, 184, title, 25, weight=500), text(x, 216, subtitle, 16, "#A0A0AA"),
                 placed(variant, x + 225, 256, 236, terminal="#FFFFFF" if variant == "a" else None),
                 placed(variant, x + 105, 538, 58, terminal="#FFFFFF" if variant == "a" else None), text(x + 182, 580, "SignalStudio", 44, weight=600),
                 f'<rect x="{x}" y="630" width="690" height="174" rx="0" fill="#F5F5F7"/>',
                 text(x + 28, 664, "LIGHT / MONO", 12, "#707079"),
                 placed(variant, x + 35, 689, 75, DARK), text(x + 140, 740, "SignalStudio", 39, DARK, 600),
                 placed(variant, x + 562, 678, 94, DARK),
                 text(x, 849, "APP ICON", 13, "#A0A0AA"),
                 f'<rect x="{x}" y="866" width="690" height="234" fill="#25252D"/>',
                 icon(variant, x + 25, 886, 178)]
        for size, offset in ((64, 260), (32, 392), (16, 502)):
            body += [icon(variant, x + offset, 946 - size // 2, size),
                     text(x + offset, 1025, f"{size} px", 13, "#B8B8C1")]
        body += [text(x, 1150, "#131419  /  #FFFFFF  /  #FF8A24", 14, "#A0A0AA")]
    body.append(text(70, 1195, "Original vector studies · candidate orange · not applied to the product", 13, "#85858F"))
    (HERE / "logo-review.svg").write_text(svg("".join(body), 1600, 1220, "SignalStudio logo proposals A and B, wordmarks, monochrome and app icon size comparisons"))


if __name__ == "__main__":
    main()
