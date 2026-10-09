"""Build a local macOS shell; paths are resolved on the machine that builds it."""
import json
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def main():
    if sys.platform != "darwin":
        raise SystemExit("This app requires macOS.")
    output = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else Path.home() / "Applications/SignalStudio.app"
    if output.suffix != ".app":
        raise SystemExit("Output must end with .app")
    contents = output / "Contents"
    binary = contents / "MacOS/SignalStudio"
    resources = contents / "Resources"
    binary.parent.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)
    subprocess.run(["xcrun", "swiftc", str(ROOT / "desktop/SignalStudio.swift"),
                    "-o", str(binary), "-framework", "Cocoa", "-framework", "WebKit"], check=True)
    with (contents / "Info.plist").open("wb") as file:
        plistlib.dump({"CFBundleName": "SignalStudio", "CFBundleDisplayName": "SignalStudio",
                      "CFBundleIdentifier": "local.signalstudio.desktop", "CFBundleExecutable": "SignalStudio",
                      "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "CFBundleShortVersionString": "0.1.0",
                      "NSHighResolutionCapable": True,
                      "NSDocumentsFolderUsageDescription": "SignalStudio 需要读取文稿中的项目文件和已有工作台数据。",
                      "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True}}, file)
    (resources / "launch.json").write_text(json.dumps({"project_root": str(ROOT), "python": sys.executable}), encoding="utf-8")
    subprocess.run(["codesign", "--force", "--sign", "-", str(output)], check=True)
    print(f"Built: {output}")
    print(f'Open with: open "{output}"')


if __name__ == "__main__":
    main()
