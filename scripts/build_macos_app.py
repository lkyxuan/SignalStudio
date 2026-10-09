"""Build a local macOS shell; paths are resolved on the machine that builds it."""
import argparse
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def build_icon(resources):
    source = ROOT / "design/logo/heartbeat-app-icon.png"
    with tempfile.TemporaryDirectory(prefix="signalstudio-icon-") as temporary:
        iconset = Path(temporary) / "SignalStudio.iconset"
        iconset.mkdir()
        for points in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                pixels = points * scale
                name = f"icon_{points}x{points}{'@2x' if scale == 2 else ''}.png"
                subprocess.run(["sips", "-z", str(pixels), str(pixels), str(source),
                                "--out", str(iconset / name)], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["iconutil", "-c", "icns", str(iconset),
                        "-o", str(resources / "SignalStudio.icns")], check=True)
    shutil.copyfile(ROOT / "design/logo/LUCIDE-LICENSE", resources / "LUCIDE-LICENSE")


def main():
    if sys.platform != "darwin":
        raise SystemExit("This app requires macOS.")
    parser = argparse.ArgumentParser()
    parser.add_argument('output', nargs='?')
    parser.add_argument('--dev', action='store_true')
    args = parser.parse_args()
    name = 'SignalStudio Dev' if args.dev else 'SignalStudio'
    node = shutil.which('node') if args.dev else ''
    if args.dev and not node:
        raise SystemExit('Node.js is required for the Dev App.')
    output = Path(args.output).expanduser().resolve() if args.output else Path.home() / f'Applications/{name}.app'
    if output.suffix != ".app":
        raise SystemExit("Output must end with .app")
    contents = output / "Contents"
    binary = contents / "MacOS/SignalStudio"
    resources = contents / "Resources"
    binary.parent.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)
    build_icon(resources)
    subprocess.run(["xcrun", "swiftc", str(ROOT / "desktop/SignalStudio.swift"),
                    "-o", str(binary), "-framework", "Cocoa", "-framework", "WebKit"], check=True)
    with (contents / "Info.plist").open("wb") as file:
        plistlib.dump({"CFBundleName": name, "CFBundleDisplayName": name,
                      "CFBundleIdentifier": "local.signalstudio.desktop" + (".dev" if args.dev else ""), "CFBundleExecutable": "SignalStudio",
                      "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "CFBundleShortVersionString": "0.1.0",
                      "CFBundleIconFile": "SignalStudio.icns",
                      "NSHighResolutionCapable": True,
                      "NSDocumentsFolderUsageDescription": "SignalStudio 需要读取文稿中的项目文件和已有工作台数据。",
                      "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True}}, file)
    (resources / "launch.json").write_text(json.dumps({"project_root": str(ROOT), "python": sys.executable, "mode": "development" if args.dev else "production", "node": node}), encoding="utf-8")
    subprocess.run(["codesign", "--force", "--sign", "-", str(output)], check=True)
    print(f"Built: {output}")
    print(f'Open with: open "{output}"')


if __name__ == "__main__":
    main()
