# Mac 客户端自动更新契约（SS-59）

依据：[SS-59 已批准修订计划](https://app.notion.com/p/3f6038a63d5a81b6a4f5d3a6feb138ae)。共享客户端使用 Sparkle 2.10.0；主机更新仍按 [MAC_MINI_HOST.md](MAC_MINI_HOST.md)，客户端更新不会部署主机、修改主数据库或重排图谱。

## 运行行为

共享版默认自动检查、下载和校验更新，正常退出时安装；“检查更新…”在新版就绪后可请求安装并重启。已下载的更新等待正常退出，不以定时器主动退出工作台。用户可从原生菜单“自动更新设置…”或更新面板关闭自动更新。Sparkle 的检查周期默认一天；手动检查不要求等待周期。

正常退出、关闭窗口以及 Sparkle 请求退出都通过 `applicationShouldTerminate` 检查当前工作台的 `signalstudioQuitState()`。未保存编辑、拖拽、排队/进行中的写入、未关闭的新节点/提议窗口和 busy 状态阻止退出，要求回工作台保存；明确识别为草稿且无写入进行时，可由用户选择“放弃草稿并退出”。未知状态或进行中的操作不提供放弃按钮。已加载界面无法提供草稿状态时也阻止退出。此保护不覆盖强制结束、崩溃或系统断电。

更新校验与安装由 Sparkle 执行，不在网页执行下载文件或 shell 命令。原生桥 `clientUpdater` 仅接受已配置工作台或该工作台专属备用界面的主框架请求，动作仅为 `status`、`check`、布尔值 `automatic`。其他来源/子框架/动作拒绝。安装前仍经过退出保护。

共享版 Info.plist 内嵌真实发行版本、源码提交、更新源和公钥；开发外壳没有此更新器，不订阅共享发行。在线界面与备用界面由原生桥获得客户端状态。旧共享版只有提交信息时显示能力缺失，不用界面提交猜测安装版本。浏览器不报告已安装 App 版本。

## 信任与发行

- `desktop/updater.json` 是公开 feed URL 和公钥。HTTPS feed 为本仓库 `releases/appcast.xml`，归档为对应 GitHub Release 的固定版本 ZIP。通道是明确批准的共享预发布发行，标签说明预发布身份；main 提交不是可安装发行。
- Sparkle 分发归档 SHA256 固定在 `scripts/sparkle.py`，下载与每次提取前核验。复制 Framework 保留符号链接与执行权限；保留 Sparkle MIT 许可。
- `SUPublicEDKey` 验证 Ed25519 更新签名，`SUVerifyUpdateBeforeExtraction` 强制先验证归档；`SURequireSignedFeed` 同时验证 feed，签名失败不设置到期后忽略策略。归档与 feed 均由 `sign_update` 签名并验证。
- 私钥为发布用户 Keychain 的 Sparkle `SignalStudio` account。不要打印、提交、随包发布或放在 feed 托管位置。密钥丢失可能中断更新链；当前无 Developer ID 轮换保障。备份应由用户在受保护环境操作；不要以明文私钥作为构建输入默认路径。
- EdDSA 不等于 Apple Developer ID 或公证。当前构建继续 ad-hoc、未公证，系统可能要求信任确认。目录权限不足可能要求系统授权，拒绝或失败必须显示原因。禁止通过移除隔离属性或停用 Gatekeeper 来让检查通过。
- 连接设置与快照位于 Application Support，替换 App 不删除；数据库继续在主机。失败应保持旧包可用或报告恢复路径，不能承诺任意新版运行故障都自动回滚。

## 构建与发布顺序

在干净、已提交工作区先运行 `npm ci`、`npm run build`，再构建 App。`scripts/build_macos_app.py --release --version X.Y.Z` 会下载并验证固定 Sparkle 分发包；机器需要访问 GitHub，并满足原有 Swift 构建依赖。

首次发布前使用固定分发工具 `bin/generate_keys --account SignalStudio` 生成 Keychain 密钥，确认 `-p` 输出的公钥等于配置；签名时系统可能要求 Keychain 授权。后续必须使用同一私钥，不要每次生成新公钥。

```bash
python3 scripts/build_macos_app.py /tmp/release/SignalStudio.app --release --version X.Y.Z
python3 scripts/prepare_client_update.py --app /tmp/release/SignalStudio.app \
  --output /tmp/release/update \
  --download-url https://github.com/lkyxuan/SignalStudio/releases/download/vX.Y.Z/SignalStudio-X.Y.Z-arm64.zip
python3 scripts/package_macos_release.py --version X.Y.Z --output /tmp/release/dmg
```

准备工具不会发布。先检查 tag/Release 不存在，验证包内容、签名、连接和版本；上传 ZIP、DMG、校验文件及 appcast 到批准的预发布 Release，重新下载校验归档；最后将**原样已签名**的 appcast 放进 `releases/appcast.xml`，提交推送，并核对 HTTPS feed 内容与签名。修改 feed 任意字节后都要重新签名。不得先推送引用尚不存在附件的 feed，不覆盖已有版本附件，不向公共 feed 添加测试发行。

首个带更新器的 App 必须协助安装一次；旧 v0.1.0 不含更新器，不能通过更新网页获得原生更新能力。以后发行无需手动拖拽替换。把产物发布与某台用户 Mac 已安装分开核验。

## 主机状态接口

更新面板打开时立即读取状态，打开期间每5秒自动读取，并显示“状态每5秒自动刷新”；不提供重复的手动读取按钮。读取状态只展示更新器已有结果，不触发新的版本检查。界面精简依据：[SS-68](https://app.notion.com/p/3f7038a63d5a81e6bc5dd43c286e48ff)。

`GET /__signalstudio_updater` 经现有同源入口代理到运行器 `/updater`。只读返回有限 `phase`、40位 `current_commit`/`candidate_commit`、`last_check`/`last_success`/`updated_at`、`stale` 和固定公开原因。检查时间缺失、超出180秒或在未来均为过期；无文件为 `not-installed`，损坏为 `unknown`。不返回日志、备份、项目路径或原始异常，不接受 resume/retry/部署动作。跨 Origin 请求拒绝。接口沿用私有网络访问边界，并没有新增用户认证。

## 验证

```bash
python3 -m unittest scripts.test_update_status scripts.test_dev_runtime server.test_desktop_server
python3 -m unittest scripts.test_client_bridge scripts.test_client_update
SIGNALSTUDIO_TEST_APP=/tmp/release/SignalStudio.app python3 -m unittest scripts.test_shared_client
python3 -m unittest scripts.test_offline_workspace
npm run build
npm run test:contracts
```

Sparkle 实测使用专属临时 App identifier、两个递增版本、本地签名 feed 和隔离目录；不改用户 App、公共 feed、主数据库。验证退出安装、取消退出后重试、立即重启及篡改包拒绝。真实联网发行、用户安装目录权限、最低系统/跨机测试需要单独记录实际结果，不以编译成功代替。
