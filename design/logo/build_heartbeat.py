"""Export the workbench Activity mark for brand and app-icon review.

Activity path: lucide-react 0.468.0, ISC (see LUCIDE-LICENSE).
Does not modify product assets or the installed application.
"""
from pathlib import Path
from build_sources import svg, text, DARK, ORANGE

HERE = Path(__file__).resolve().parent
ACTIVITY = "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"


def mark(x=0, y=0, size=24, color=ORANGE):
    return (f'<g transform="translate({x} {y}) scale({size / 24})">'
            f'<path d="{ACTIVITY}" fill="none" stroke="{color}" stroke-width="2" '
            'stroke-linecap="round" stroke-linejoin="round"/></g>')


def icon(x, y, size):
    return (f'<g transform="translate({x} {y}) scale({size / 1024})">'
            f'<rect x="64" y="64" width="896" height="896" rx="208" fill="{DARK}"/>'
            f'{mark(224, 224, 576)}</g>')


def main():
    assets = {
        'heartbeat-mark': svg(mark(), 24, 24, 'SignalStudio heartbeat mark'),
        'heartbeat-mark-mono': svg(mark(color=DARK), 24, 24, 'SignalStudio monochrome heartbeat mark'),
        'heartbeat-app-icon': svg(icon(0, 0, 1024), 1024, 1024, 'SignalStudio heartbeat app icon'),
    }
    for theme, ink in [('dark', '#FFFFFF'), ('light', DARK)]:
        assets[f'heartbeat-wordmark-{theme}'] = svg(
            mark(0, 8, 48) + text(64, 43, 'SignalStudio', 36, ink, 600),
            300, 64, f'SignalStudio heartbeat wordmark for {theme} background')
    body = [f'<rect width="1200" height="820" fill="{DARK}"/>',
            text(60, 64, 'SignalStudio', 32, weight=600),
            text(60, 100, 'WORKBENCH HEARTBEAT / APP ICON', 14, '#A0A0AA'),
            '<path d="M60 126H1140" stroke="#35353D"/>',
            mark(76, 175, 56), text(152, 216, 'SignalStudio', 38, weight=600),
            text(60, 275, 'Same Activity waveform as the design workbench', 16, '#A0A0AA'),
            '<rect x="60" y="312" width="510" height="132" fill="#F5F5F7"/>',
            mark(82, 350, 52), text(154, 390, 'SignalStudio', 36, DARK, 600),
            icon(700, 162, 330),
            text(60, 530, 'APP ICON / ACTUAL PIXEL SIZES', 14, '#A0A0AA'),
            '<rect x="60" y="560" width="1080" height="170" fill="#25252D"/>']
    for size, x in [(128, 92), (64, 320), (32, 526), (16, 720)]:
        body += [icon(x, 580 + (128-size)/2, size), text(x, 758, f'{size} px', 14, '#C5C5C5')]
    body += [text(60, 802, '#FF8A24 / #131419 · Lucide Activity · Review assets', 13, '#A0A0AA')]
    assets['heartbeat-review'] = svg(''.join(body), 1200, 820, 'SignalStudio workbench heartbeat logo and app icon review')
    for name, content in assets.items():
        (HERE / f'{name}.svg').write_text(content)


if __name__ == '__main__':
    main()
