"""Build the existing development shell or a portable shared-client release."""
import argparse
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def build_shared(output, version, revision):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Version must be three numeric components")
    if output.exists():
        raise ValueError("Release output already exists; choose a fresh output path")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="signalstudio-shared-", dir=output.parent) as temporary:
        bundle = Path(temporary) / "SignalStudio.app"
        contents = bundle / "Contents"
        resources = contents / "Resources"
        binary = contents / "MacOS/SignalStudio"
        resources.mkdir(parents=True)
        binary.parent.mkdir()
        build_icon(resources)
        subprocess.run(["xcrun", "swiftc", "-O", "-target", "arm64-apple-macos14.0",
                        str(ROOT / "desktop/SharedConnection.swift"), str(ROOT / "desktop/SharedClient.swift"),
                        "-o", str(binary), "-framework", "Cocoa", "-framework", "WebKit"], check=True)
        with (contents / "Info.plist").open("wb") as file:
            plistlib.dump({"CFBundleName": "SignalStudio", "CFBundleDisplayName": "SignalStudio",
                          "CFBundleIdentifier": "local.signalstudio.desktop", "CFBundleExecutable": "SignalStudio",
                          "CFBundlePackageType": "APPL", "CFBundleVersion": version,
                          "CFBundleShortVersionString": version, "SignalStudioRevision": revision,
                          "CFBundleIconFile": "SignalStudio.icns", "LSMinimumSystemVersion": "14.0",
                          "NSHighResolutionCapable": True,
                          "NSLocalNetworkUsageDescription": "SignalStudio 连接你的 Tailscale 共享工作台。",
                          "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True}}, file)
        subprocess.run(["codesign", "--force", "--sign", "-", str(bundle)], check=True)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(bundle)], check=True)
        shutil.move(str(bundle), output)


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
    parser.add_argument('--dev', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--local', action='store_true', help='Build an explicit local development client')
    parser.add_argument('--release', action='store_true', help='Build a portable arm64 shared client without private configuration')
    parser.add_argument('--version', default='0.1.0')
    args = parser.parse_args()
    name = 'SignalStudio'
    if args.release:
        if args.local or args.dev or not args.output:
            parser.error('--release requires an explicit fresh output path and cannot use --local/--dev')
        output = Path(args.output).expanduser().resolve()
        if output.suffix != '.app':
            parser.error('Output must end with .app')
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        build_shared(output, args.version, revision)
        print(f'Built shared client: {output}')
        return
    connection = ROOT / 'desktop/connection.json'
    remote = json.loads(connection.read_text()) if connection.exists() and not args.local else None
    node = shutil.which('node')
    if not node and not remote:
        raise SystemExit('Node.js is required for SignalStudio.')
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
                      "CFBundleIdentifier": "local.signalstudio.desktop.dev", "CFBundleExecutable": "SignalStudio",
                      "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "CFBundleShortVersionString": "0.1.0",
                      "CFBundleIconFile": "SignalStudio.icns",
                      "NSHighResolutionCapable": True,
                      "NSDocumentsFolderUsageDescription": "SignalStudio 需要读取文稿中的项目文件和已有工作台数据。",
                      "NSLocalNetworkUsageDescription": "SignalStudio 通过 Tailscale 连接你的 Mac mini 共享工作台。",
                      # The private numeric Tailscale endpoint uses HTTP inside its encrypted tunnel.
                      "NSAppTransportSecurity": ({"NSAllowsArbitraryLoads": True} if remote
                                                  else {"NSAllowsLocalNetworking": True})}, file)
    config = {"project_root": str(ROOT), "python": sys.executable, "mode": "development", "node": node or ''}
    if remote:
        config.update(remote, mode='remote')
    (resources / "launch.json").write_text(json.dumps(config), encoding="utf-8")
    subprocess.run(["codesign", "--force", "--sign", "-", str(output)], check=True)
    print(f"Built: {output}")
    print(f'Open with: open "{output}"')


if __name__ == "__main__":
    main()
