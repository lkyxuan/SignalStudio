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

工作台只监听该 Tailscale IP，不监听 LAN 或公网接口。访问权限依赖已有 Tailscale 网络规则；应用尚未提供独立用户账户/登录系统，不应对公网发布。API 代理拒绝其他网页 Origin 的请求。原生 App 读取 `desktop/connection.json`，核验远端项目、数据库和就绪状态，失败不切换到本地库；退出客户端不停止主机服务。

2026-10-09 已将旧 `~/SignalStudio` 移出日常项目目录；包含原有未提交修改的可恢复备份位于 `~/Library/Application Support/SignalStudio/retired-project-20261009-152001`，不作为运行或开发入口。以后使用上表唯一目录。

## 服务管理

常驻方式为账户的 LaunchAgent：`~/Library/LaunchAgents/local.signalstudio.server.plist`。它独立于 SSH 会话及客户端 App，用户登录后自动启动、进程退出后重启。主机当日已有 `sleep=0`、`autorestart=1` 设置，部署未改变这些系统选项。未验证断电重启后无需登录就能运行；用户级服务不能承诺登录前可用。

SSH 登录主机后安装/重新安装（先安装 npm 依赖，保留现有数据库）：

```bash
cd ~/SignalStudio-server
PATH=/opt/homebrew/bin:$PATH npm ci --no-audit --no-fund
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

尚未配置 GitHub 自动拉取或自动部署；推送代码后需明确执行主机更新。主机源码更新才会反映到共享界面。可以在主机远程开发，也可以在其他电脑提交推送后，在主机备份数据库、核对 `git status`，使用 `git pull --ff-only` 更新代码；如更新涉及数据库文件，停止并核对迁移方案，不能直接覆盖。前端和 catalog 可热更新，相关后台文件会触发后台重启；依赖或启动器变化应重新安装依赖并重启服务。App 原生代码、连接地址变化须重新构建本机 App。

用户于 2026-10-10 [明确批准默认交付收尾](https://app.notion.com/p/3f4038a63d5a81069660fd3f01218da1)：代理完成每批已批准且验证通过的修改后，应提交推送，再继续将主机快进更新至对应已验证提交，检查服务健康和客户端实际生效，并报告提交与同步结果。此步骤不需重复请求同一范围的同步许可；执行时仍须按上文检查工作区、备份并保护主数据库。遇到冲突、主机离线、迁移需求或验证失败须报告具体阻碍，不强制覆盖。原生外壳修改须按批准范围构建并验证对应客户端，拉取源码不能替代安装。该规则是代理交付流程，尚无常驻自动更新程序。

## 核验

从客户端检查 `/__signalstudio_health`：必须返回 `SignalStudio`、development 模式、上表项目/数据库路径、`client_ready=true`；网页应加载同一图数据。主机 `lsof` 应仅显示工作台绑定 `100.123.241.60:15173`，API/控制绑定回环。验证服务重启后恢复、客户端退出不停止服务、断连重连，以及草稿/冲突保护；隔离数据测试不得改动真实卡片。

两台实体客户端同时编辑、整机断电恢复以及定时异地备份不因单台客户端验证而视为完成。

2026-10-09 部署核验通过：96 个节点、76 条连线，迁移后八张应用表的完整行内容摘要与迁移快照一致；端口绑定、LaunchAgent 重启恢复、原生远程窗口、断连后重连、退出客户端后主机继续运行通过。本机构建/类型检查、签名检查和隔离真实进程测试通过；后者包含同源健康转发、跨 Origin 拒绝、后台重启、编辑冲突和进程清理。
