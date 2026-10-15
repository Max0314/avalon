# 部署、验证与回滚

设计核对：2026-10-15。实际版本与状态以 `server_plan/docs/12-avalon.md` 和运维仓库发布记录为准。

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

回滚代码：选择已保留的旧 SHA/镜像，在旧发布目录用同一 Compose 项目及原数据卷执行 `up -d --wait`，健康后调整 `current` 链接；不执行 `down -v`。本版首发没有历史阿瓦隆镜像；首发撤回停止本项目，移除新站点软链接并检查/reload Nginx，保留卷和制品。后续如 schema 不兼容，先停止本应用，再评估单独恢复已验证的快照；不能覆盖其他应用数据。
