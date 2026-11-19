# 部署、验证与回滚

以下保留 2026-10-15 首次 SQLite 部署记录。正式环境现用独立 PostgreSQL，身份、备份与发布规则见[统一登录部署](unified-login.md)，运行提交以私有运维仓库回执为准。

2026-11-18 圆桌界面候选按运维规范 `c813948f3bff289298fc95bb1581e768205ac967` 开发，沿用现有数据库和 Compose 项目，无需迁移。新版本将 `art/` 和 `audio/` 随镜像发布，入口脚本、样式和离线缓存按内容哈希更新。回退时指向保留的兼容镜像，并继续使用当前 PostgreSQL 库。

候选验证覆盖 46 项 Node 检查，含隔离 PostgreSQL 的账号席位恢复、游客认领及完整战绩。远端 Chromium 实际走通五人在线任务与刺杀、短线同步原席位、五人离线 WebRTC、二维码解码、断网从缓存启动与资源读取。十人牌桌在 320、390、960 和 1360 像素宽度无重叠或横向溢出。浏览器验证使用临时数据库和回环监听。iOS、微信相机和实际设备听感待验收。

固定视口与互动续作按运维规范 `72f3c82320ee35951a088292f0aac38ca35417bc` 开发。上线前仍按阿瓦隆专库备份与既有发布锁流程执行。使用旧镜像回退前需确认在线人机局已结算且大厅人机已由房主移除。在线人机进度保存在原房间快照中，旧镜像缺少执行它们的调度器。

续作的 `npm run check` 在隔离 PostgreSQL 上通过 63 项检查，含原席位恢复、换桌事务、人机重启、战绩及排行榜。远端 Chromium 通过 320～1360 像素宽度的十人布局、移动图鉴触摸手势和正常动效的开场演出。`AVALON_TEST_NUMERIC_ICE=1 npm run test:e2e` 在隔离浏览器通过五人在线和离线完整对局、断线恢复、回答码重扫、断网缓存、大屏和人机入口。此模式使用数值地址直接验证原生 WebRTC 数据通道，实体设备的 mDNS、微信相机与投屏需按实际环境验收。

2026-11-18 夜间石厅候选基于线上 `9263c5f` 和运维规范 `6101a44c37e98f76c8099f6ad28e9812625e722b`。本次使用既有镜像构建和数据库结构。角色、石厅和配乐分别使用 `/art/night/` 和 `/audio/night/` 下的新地址，让已缓存上一版的玩家在首次重访时即可取得新素材。服务端和离线缓存均支持原有地址，旧页面可继续读取。回滚可直接使用 `9263c5f` 的阿瓦隆镜像。

该候选在远端隔离环境通过 63 项 Node 检查、五人在线和 WebRTC 离线对局、断线恢复、四种视口宽度的十人布局与手机手册手势验证。在 Chromium 准备好上一版离线包后切换候选服务，首次重访的角色立绘与音乐均匹配候选文件哈希。新版离线缓存接管后断网刷新，新旧立绘与音乐地址、音频分段响应及圆桌贴图均验证通过。

2026-11-19 定妆、视听体验和昼夜候选基于线上 `fa238b0` 和运维规范 `eba275b4373bbd0a5af5020030e008f129abe062`。新版立绘和场景使用 `/art/court/`，随镜像与离线清单交付。已有 `/art/night/` 和旧媒体地址继续提供对应资源。体验页使用同源入口 `/?preview=effects`，离线包准备完成后也可打开。场景选择保存在浏览器，试玩媒体在体验页内播放。发布沿用现有数据库结构和入口，回滚版本为 `fa238b0`。

在远端隔离 PostgreSQL 中通过 63 项检查。远端 Chromium 专项核对了首页和牌桌的昼夜切换、刷新后的设置恢复、忠臣和爪牙变体、湖中仙女立绘、内联演出及实际音效与配乐播放。体验页未发起房间 API 或 WebSocket 请求。

- 主机：腾讯云成都 `1.14.72.50`，域名 `avalon.fribench.cn`。
- 路径：`/srv/fribench/games/avalon/repo.git` 为只读来源缓存；`releases/<完整 SHA>` 为归档制品；`current` 指向正在运行的发布目录。
- 项目 `fribench-avalon`，镜像 `fribench-avalon:<完整 SHA>`，非 root、只读文件系统、256 MB/0.5 CPU/64 PIDs；仅 `127.0.0.1:23010 → 3000`。
- 独立 SQLite 卷 `fribench-avalon-data`，不挂载共享 PostgreSQL/Redis，无跨应用数据库用户。配置 `/etc/fribench/apps/avalon/app.env` 为 root 0600，无需 API 密钥；数据库/配置/日志不进入 Git。
- Node `24.21.0-bookworm-slim` 固定摘要；构建运行检查，运行镜像不带 npm 依赖。Nginx 单独站点与证书，SSE 禁止缓冲并保留长连接，相机仅同源。

先在本地测试并提交推送，服务器 fetch 后验证完整 SHA，再用 `git archive` 生成新目录，构建镜像，设置 `AVALON_IMAGE` 渲染 Compose，`docker compose config --quiet` 通过后 `up -d --wait`。新建 HTTP ACME 站点时先 `nginx -t`，签发独立证书，再安装 HTTPS 配置、再次检查并 reload。不要对其他项目执行 Compose 或重启。

服务器现有 `/srv/fribench/ops` 有未提交文件，不能 reset/pull 覆盖；此次运维准源使用独立 `ops/releases/avalon/<运维 SHA>` 归档，仅安装阿瓦隆新站点，保留原工作树。应用 Compose 随自身已提交发布版本保存。

验证：容器 healthy，回环与公网 `/healthz`、`/readyz`，HTTP 跳 HTTPS，TLS 有效，端口只在回环监听，SSE 在线状态、成员权限/私人数据、缓存和日志。记录发布 SHA、证书期限和受影响服务。

升级前可按需要手动一致快照：

```sh
cd /srv/fribench/games/avalon/current
sudo AVALON_IMAGE=fribench-avalon:<当前SHA> AVALON_RELEASE=<当前SHA> docker compose -f compose.prod.yaml exec -T app \
  node tools/backup.mjs /app/data/manual/<时间>.sqlite
```

此工具调用 SQLite backup API，避免复制活动 WAL 数据库。快照含访客/房间数据，只留受限运行卷或服务器备份目录，不能进入文档仓库。遵循当前决定：不新增自动备份、COS 或定时任务。

回滚代码：选择已保留的旧 SHA/镜像，在旧发布目录用同一 Compose 项目及原数据卷执行 `up -d --wait`，健康后调整 `current` 链接；不执行 `down -v`。没有旧成功镜像时，撤回可停止本项目，移除新站点软链接并检查/reload Nginx，保留卷和制品。后续如 schema 不兼容，先停止本应用，再评估单独恢复已验证的快照；不能覆盖其他应用数据。


2026-10-15 验收：已上线 `8e06b72a61946982446c511f7f1aaecac7ed22a4`，保留成功镜像 `07beaf3b5dd67db57072276aa5c73ba8c3dcec21` 可回滚。公网五人完整在线局/重启恢复、五人 WebRTC/QR 解码/断网缓存通过；十人 320～1360px 布局通过；容器健康、回环监听、Nginx/HTTPS 与 Certbot 模拟续期通过。证书有效至 2027-01-13。实体手机相机/微信浏览器仍需实机验收。此验收记录的后续文档提交不改变运行代码。
