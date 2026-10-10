# SignalStudio Mac mini 运行说明

本机部署经用户批准，依据：[跨电脑访问与共享开发工作台](https://app.notion.com/p/3f4038a63d5a81069660fd3f01218da1)。

## 地址与运行来源

| 项目 | 配置 |
| --- | --- |
| 主机 | Miracle的Mac mini，账户 `miracle0x` |
| Tailscale IPv4 | `100.123.241.60` |
| 工作台 | `http://100.123.241.60:15173` |
| SSH | `miracle0x@100.123.241.60:22`，当前开发 Mac 别名 `signalstudio-mini` |
| 唯一服务目录 | `/Users/miracle0x/SignalStudio-server` |
| 主数据库 | `/Users/miracle0x/SignalStudio-server/data/logic.db` |
| 后台 API | `127.0.0.1:18788`，由工作台同源代理访问 |
| 会话检查 | `127.0.0.1:18789/health`，同源入口 `/__signalstudio_health` |
| Node | `/opt/homebrew/bin/node` |
| Python | `/Library/Developer/CommandLineTools/usr/bin/python3` |

工作台只监听该 Tailscale IP，不监听 LAN 或公网接口。访问权限依赖已有 Tailscale 网络规则；应用尚未提供独立用户账户/登录系统，不应对公网发布。API 代理拒绝其他网页 Origin 的请求。开发版原生 App 读取 `desktop/connection.json`；[SS-28 共享安装版](MACOS_RELEASE.md)首次填写地址并确认工作台，设置留在用户目录。两者核验远端项目、数据库和就绪状态，失败不切换到本地库；退出客户端不停止主机服务。

2026-10-09 已将旧 `~/SignalStudio` 移出日常项目目录；包含原有未提交修改的可恢复备份位于 `~/Library/Application Support/SignalStudio/retired-project-20261009-152001`，不作为运行或开发入口。以后使用上表唯一目录。

## 服务管理

常驻方式为账户的 LaunchAgent：`~/Library/LaunchAgents/local.signalstudio.server.plist`。它独立于 SSH 会话及客户端 App，用户登录后自动启动、进程退出后重启。主机当日已有 `sleep=0`、`autorestart=1` 设置，部署未改变这些系统选项。未验证断电重启后无需登录就能运行；用户级服务不能承诺登录前可用。

SSH 登录主机后安装/重新安装（先安装 npm 依赖并构建页面，保留现有数据库）：

```bash
cd ~/SignalStudio-server
PATH=/opt/homebrew/bin:$PATH npm ci --no-audit --no-fund
PATH=/opt/homebrew/bin:$PATH npm run build
/Library/Developer/CommandLineTools/usr/bin/python3 scripts/install_macos_service.py --node /opt/homebrew/bin/node --host 100.123.241.60
```

检查、重启和停止：

```bash
launchctl print gui/$(id -u)/local.signalstudio.server
launchctl kickstart -k gui/$(id -u)/local.signalstudio.server
launchctl bootout gui/$(id -u)/local.signalstudio.server
```

日志在 `~/Library/Logs/SignalStudio/host.log` 和 `host-error.log`。服务仅停止自己创建的子进程，不抢占已有端口；端口冲突会记录错误并重试。服务安装脚本拒绝非 Tailscale IPv4 地址。

## 数据与源码更新

主数据统一写入 Mac mini；本机仓库里的数据库是迁移前副本，不能继续作为第二份主数据使用。仓库仍跟踪历史 SQLite 文件，提交代码时排除在线数据库；不要以 `git reset --hard` 或文件同步覆盖它。

迁移使用 SQLite backup API，包括 WAL 中已提交内容；初始快照和迁移前仓库数据库保存在主机 `~/Library/Application Support/SignalStudio/backups/20261009-152135/`。该备份是本机单份快照，尚未配置定时/异地备份。后续改动需要另做快照。备份示例（在主机执行，输出文件须不存在）：

```bash
/Library/Developer/CommandLineTools/usr/bin/python3 - <<'PY'
from pathlib import Path
import datetime, sqlite3
root = Path.home() / 'SignalStudio-server'
backup = Path.home() / 'Library/Application Support/SignalStudio/backups'
backup.mkdir(parents=True, exist_ok=True)
target = backup / (datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.db')
with sqlite3.connect(root / 'data/logic.db') as source, sqlite3.connect(target) as destination:
    source.backup(destination)
    assert destination.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print(target)
PY
```

恢复时先停止服务，备份当前库，将选定快照恢复为 `data/logic.db`，不要保留不属于该快照的 `logic.db-wal`/`logic.db-shm`，再重新安装服务并核对卡片内容；不要在服务写入时覆盖数据库。

SS-31 提供保守的主机自动更新器（安装与验证范围见下文）。未安装或暂停更新器时，推送代码后需明确执行主机更新。主机源码更新才会反映到共享界面。可以在主机远程开发，也可以在其他电脑提交推送后，在主机备份数据库、核对 `git status`，使用 `git pull --ff-only` 更新代码；如更新涉及数据库文件，停止并核对迁移方案，不能直接覆盖。共享入口使用 dist 中的构建页面，前端改动须构建并更新服务；catalog及相关后台文件会触发后台重启；依赖或启动器变化应重新安装依赖并重启服务。App 原生代码、连接地址变化须重新构建本机 App。

用户于 2026-10-10 [明确批准默认交付收尾](https://app.notion.com/p/3f4038a63d5a81069660fd3f01218da1)：代理完成每批已批准且验证通过的修改后，应提交推送，再继续将主机快进更新至对应已验证提交，检查服务健康和客户端实际生效，并报告提交与同步结果。此步骤不需重复请求同一范围的同步许可；执行时仍须按上文检查工作区、备份并保护主数据库。遇到冲突、主机离线、迁移需求或验证失败须报告具体阻碍，不强制覆盖。原生外壳修改须按批准范围构建并验证对应客户端，拉取源码不能替代安装。该规则是代理交付流程；SS-31 的常驻自动更新器另按下文安装和安全边界运行。

## 核验

从客户端检查 `/__signalstudio_health`：必须返回 `SignalStudio`、development 模式、上表项目/数据库路径、`client_ready=true`；网页应加载同一图数据。主机 `lsof` 应仅显示工作台绑定 `100.123.241.60:15173`，API/控制绑定回环。验证服务重启后恢复、客户端退出不停止服务、断连重连，以及草稿/冲突保护；隔离数据测试不得改动真实卡片。

两台实体客户端同时编辑、整机断电恢复以及定时异地备份不因单台客户端验证而视为完成。

2026-10-09 部署核验通过：96 个节点、76 条连线，迁移后八张应用表的完整行内容摘要与迁移快照一致；端口绑定、LaunchAgent 重启恢复、原生远程窗口、断连后重连、退出客户端后主机继续运行通过。本机构建/类型检查、签名检查和隔离真实进程测试通过；后者包含同源健康转发、跨 Origin 拒绝、后台重启、编辑冲突和进程清理。

## 保守自动更新器（SS-31）

[实施依据](https://app.notion.com/p/3f4038a63d5a81a3b0f3f6bacab4ee1e)。用户2026-10-10批准原卡方案。安装后用户级 LaunchAgent 每60秒检查 origin/main，独立于客户端 App；仍依赖账户登录、主机唤醒和网络。安装命令在主机唯一服务目录执行：

```bash
python3 scripts/macos_updater.py install
python3 scripts/macos_updater.py status
python3 scripts/macos_updater.py pause
python3 scripts/macos_updater.py resume
python3 scripts/macos_updater.py retry
```

`pause` 阻止下一轮，已经开始的交付会完成；`resume` 不会重试同一失败提交，确认修复后使用 `retry`。`once` 可手动执行单轮。控制程序复制到 `~/Library/Application Support/SignalStudio/updater/`，仓库脚本变更不会替换正在运行的控制代码；更新控制程序须重新安装。可用 `launchctl print gui/$(id -u)/local.signalstudio.updater` 检查计划任务。卸载仅停止该更新器：

```bash
launchctl bootout gui/$(id -u)/local.signalstudio.updater
```

仅 main 分支可安全快进。允许前端、public、docs、design 及明确列出的构建配置；任何 server、catalog、data、运行/部署脚本或未知路径变化都暂停并要求人工兼容性检查，包括看似无迁移的后台修改。索引必须无暂存改动；唯一可忽略的工作区差异是未暂存的在线 data/logic.db。未提交源码、未跟踪文件、分叉、失败的同一提交和中断交付都会阻止自动应用。上游涉及数据库的提交不能通过 `retry` 绕过此规则。

候选提交以 git archive 提取到临时目录，独立 npm ci、类型检查/构建、前端契约/布局检查及隔离真实进程检查通过后，才停止工作台入口与后台。后台 SIGTERM 完成当前请求和事务再退出，不完整请求体有10秒超时；运行器为每个子进程最多等待20秒，LaunchAgent允许60秒退出窗口；异常退出仍按失败诊断，不能承诺零中断。端口确认关闭后以 SQLite backup API 备份并检查完整性，再快进源码、替换候选依赖和构建页面、恢复服务并核对项目/数据库身份与 ready 状态。失败恢复旧代码、依赖和构建页面，保留当前在线数据库，绝不用旧备份覆盖。回退失败或执行中断进入 recovery_required，必须核对 status.json 的旧/新提交、改动路径、备份及依赖目录后人工恢复；不自动重试。

状态、当前/候选提交、时间、阶段、失败或暂停原因在 updater/status.json；events.log 轮转保留约两个1MB文件。失败指数退避，最多1小时；对已失败提交不会反复应用，出现新提交或明确 retry 才再评估。更新前备份保留最近10份；还须自行安排异地备份，当前未提供。

共享入口使用 Vite preview 提供已构建页面，不注入开发重连客户端，避免服务器重启强制刷新并清空编辑。本机回环开发入口仍保留 Vite 热更新。图数据按既有轮询机制恢复；已打开页面检测到代码版本变化后提示“先保存编辑，再刷新页面”，原生外壳/图标仍需单独重建客户端。安装这版之前已加载的旧客户端仍遵循旧版重连逻辑，首次部署前应保存编辑并重新打开页面。验证记录必须区分隔离故障注入与真实主机交付，不把隔离回退测试称为真实主机故障回退演练。

2026-10-10 首次交付核验：`84bcac2` 已推送 main 并安全快进到共享主机；停止服务后备份为 `~/Library/Application Support/SignalStudio/backups/ss31-20261010-080303.db`。恢复后的全部应用表行内容摘要与备份一致（104节点），项目/数据库/代码版本身份及 client_ready 检查通过。已安装 local.signalstudio.updater。隔离验证通过13项Python检查、9项前端契约和3项布局检查及类型检查/构建；另从提交快照独立安装依赖并验证候选成功。浏览器隔离实测服务重启和版本切换后保留未保存的新节点草稿，并显示手动刷新提示。未进行真实主机故障回退或断电恢复演练。

更新器与请求排空检查可在隔离开发工作区执行：

```bash
python3 -m unittest scripts.test_macos_updater scripts.test_graceful_shutdown scripts.test_dev_runtime server.test_desktop_server
npm run build
npm run test:contracts
npm run test:layout
```

2026-10-10 08:04（Asia/Shanghai）真实定时链路核验：安装后的60秒LaunchAgent自行发现验证说明提交 `e991897`，从 `84bcac2` 完成隔离依赖/构建/测试、备份、快进和服务恢复；status.json记录 last_check=00:04:17Z、last_success=00:04:53Z，健康接口返回对应code_revision及client_ready=true。此记录验证自动检查与成功交付，不代表真实主机故障回退已演练。服务安装配置显式设置ExitTimeOut=60秒，给运行器排空请求与退出子进程保留时间。
