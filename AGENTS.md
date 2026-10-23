# Fribench 阿瓦隆

继承 `D:\code_CPL\AGENTS.md`。代码准源为 `Max0314/avalon`，上游为 `aglinaodan/avalon`。

- 保留现有卡面原图；界面、规则提示、错误、帮助和无障碍名称使用简体中文。
- 在线由本应用服务端裁定；客户端不能提交身份、票数、胜负或任意房间快照。
- 离线扫码采用可信房主设备主持，只向各参与者发送其允许看到的投影。两种模式共用规则引擎。
- 不使用上游 Firebase、硬编码管理员或四位数字账号，不连接或改写原作者服务。
- 不提交实际数据库、会话、二维码配对正文、口令、秘密文件、日志或运行缓存。
- 正式服务单实例。按用户 2026-10-16 的明确决定，服务端使用独立 PostgreSQL 数据库/角色，SQLite 仅保留本地开发与旧卷；回环端口与 Nginx 规则登记运维仓库。详见 `docs/unified-login.md`。
- 每次变更至少 `npm run check`；涉及客户端流程运行 `npm run test:e2e`。发布前记录限制与回滚。

<!-- fribench-shared-policy:start -->
## Fribench 公共规范引用

- 此节只适用于 Fribench 接入及部署；保留本文件其他项目约束，其他环境按原项目流程执行。
- 每次任务先定位 ops：优先 FRIBENCH_OPS_ROOT，本机默认 D:/code_CPL/fribench_ops；不得依赖工作树的相对位置。准源为私有 https://github.com/Max0314/fribench_ops 。
- 必须实际读取 ops 最新 GitHub main 的 AGENTS.md、docs/workflow.md、docs/contracts.md，不能只读本链接或依赖会话记忆。优先运行 `python <ops>/scripts/read_shared_policy.py`；也可在核实准源后 `git fetch --no-tags <GitHub remote> main`，记录 FETCH_HEAD 的 SHA，逐个用 `git show <SHA>:<文件>` 读取。不要切换、重置或覆盖 ops 的现有工作树。
- 记录本次规范 SHA；修改公共接口、接入组件及发布前再次检查变化。网络失败须标记未核实最新，不能静默用旧缓存批准公共接口或发布。未发布本地规则必须明确标注。
- 规范按最新主线读取，公共组件依赖按明确版本使用；遇到本项目原规则与公共规则冲突，列出差异和适用环境，不静默覆盖。完整引用流程见 ops 的 docs/shared-policy.md。
- 本阶段 work 各服务与私人主页面保持现状；本轮仅补充规范引用，不改变业务、不部署，也不更新其运行依赖。
<!-- fribench-shared-policy:end -->
