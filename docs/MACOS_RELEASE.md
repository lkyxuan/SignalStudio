# macOS 共享客户端发行

依据：[SS-28 已批准共享客户端计划](https://app.notion.com/p/3f4038a63d5a815fb792d9c7e6c090d1)。共享版不内置后台或数据库，不迁移主数据；使用现有 Mac mini 服务。服务管理及访问边界见 [MAC_MINI_HOST.md](MAC_MINI_HOST.md)。

## 安装与连接

从 GitHub Release 下载 arm64 DMG 和同名 `.sha256`，在下载目录执行 `shasum -a 256 -c SignalStudio-0.1.0-arm64.sha256`。打开 DMG，将 App 拖入 Applications，再开启已获准访问主机的 Tailscale。首次打开填写完整工作台地址（仅协议、主机及可选端口），检查显示的地址和主机项目目录后确认。

本次发行使用 ad-hoc 签名，**没有 Developer ID 签名或 Apple 公证**。互联网下载可能被 Gatekeeper 阻止。信任来源后按系统“隐私与安全性”提示处理；受组织策略限制时不要绕过。签名完整性验证不能替代开发者身份或公证验证。

连接设置写入 `~/Library/Application Support/SignalStudio/shared-client.json`（600权限、原子写入），与 App 分开，替换 App 后仍保留。首次确认后固定远端项目目录；每次打开及手动重连须核验应用、development 服务模式、该目录、对应 `data/logic.db` 路径以及 ready 状态。拒绝健康检查重定向。身份校验用于避免误连工作台，不能作为用户认证。

地址错误或网络断开时显示原因；恢复网络及主机服务后点“重新连接”。通过 App 菜单“工作台连接…”可更换地址。新地址检查失败或用户取消，不替换已有连接配置；确认切换前先保存编辑。客户端不自动重载已打开页面，也不在失败后切换本地库；网页自身遵循现有草稿/版本提示逻辑。退出 App 不停止主机。

公开包只含原生程序、心跳图标及其 Lucide 许可证；没有私人连接地址、项目源码、数据库、Node/Python、Tailscale 密钥或其他凭证。它不赋予 tailnet 访问权；当前后台没有独立用户登录，不应公开后台端口。现有开发客户端仍用 `desktop/connection.json`，默认构建行为保持原样，两种客户端不共享连接配置。

## 构建与发布

需要 Apple Silicon Mac、Command Line Tools（Swift、SDK）、Python 3 和 macOS 自带 `sips`、`iconutil`、`codesign`、`hdiutil`。Python 仅参与构建；运行 App 不需要 Node/Python/源码。使用干净且已提交的工作区构建以保证内嵌 Git 版本可追溯。版本必须是三个数字段，产物路径必须新建，不覆盖既有 App/DMG。

```bash
python3 scripts/package_macos_release.py --version 0.1.0 --output /tmp/signalstudio-release-0.1.0
# 或只构建 App
python3 scripts/build_macos_app.py /tmp/SignalStudio.app --release --version 0.1.0
SIGNALSTUDIO_TEST_APP=/tmp/SignalStudio.app python3 -m unittest scripts.test_shared_client
```

首版 `v0.1.0` 为 GitHub prerelease，上传 DMG 与 SHA256。创建前检查 tag/Release 是否已存在，禁止覆盖已发行附件；核对 tag 的提交、内嵌 `SignalStudioRevision`、附件重新下载的 SHA256、安装后签名和连接检查。`scripts/package_macos_release.py` 不发布 Release；发布为显式交付步骤。

## 验证范围与限制

编译目标 `arm64-apple-macos14.0`，Info.plist 声明 macOS 14.0。实际本轮系统为 macOS 26.6.2 / Apple Silicon；没有在 macOS 14、Intel 或第二台 Mac 验证，不能将编译目标当作最低系统实测结果。

`scripts/test_shared_client.py` 用实际 App 二进制、非源码工作目录和仅 `/usr/bin:/bin` 的 PATH 检查隔离 HTTP 服务：身份/数据库不匹配、未就绪、HTTP失败、拒绝重定向、断连恢复及有效连接。另编译连接设置检查，覆盖持久化、替换、权限、损坏配置与非法地址。诊断模式为只读：

```bash
/Applications/SignalStudio.app/Contents/MacOS/SignalStudio --check-connection http://主机:端口 --expected-root /主机项目目录
```

发行检查还应挂载 DMG、复制到非源码目录、验证签名/arm64/系统动态库依赖及包内容白名单，并用该复制品检查真实共享服务。原生窗口、Finder/Dock外观和从互联网下载后的 Gatekeeper 交互需要已解锁图形会话；本轮 Mac mini 锁屏，尚未完成这些逐项人工操作，不能宣称已验证。安装说明中明确未公证；预发布产物保留此限制。
