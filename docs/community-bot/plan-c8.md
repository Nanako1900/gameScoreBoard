# C8 · 临时房创建与移入延迟

2026-11-03，机主反馈实际约7秒，希望接近其他服务器2秒。上期#49已合并，从最新main `ed05342` 开始。按最新请求，本期先做建房性能；独立Nanako绑定知识库问答Agent保留为后续一期。

## 1. 证据与目标

本地真实CommunityEngine＋真实Discord适配器＋内存store／有状态REST替身确认：普通成员从进入口到move PATCH完成36次REST、15串行波；包含最后guard为41次／16波。无关旧任务还可能被通用claim抢先执行，入口任务留到下个5秒tick。

优化成功标准是减少可证实的重复请求／串行波次和不必要排队，保留所有身份、权限、位置、版本、租约及恢复边界。统一注入REST延迟用于前后对照，不把模拟结果称为线上2秒。

## 2. 主线全量基线

Node22.22.3，`ed05342`，八套全部通过，无先行失败。

| 套件 | 文件 / 通过 | todo |
|---|---:|---:|
| unit | 50 / 745 | 0 |
| DOM | 60 / 768 | 0 |
| Worker/D1 | 19 / 561 | 5 |
| PG | 49 / 1115 | 5 |
| server | 45 / 688 | 0 |
| typecheck、build、build:pages | 通过 | — |

仅本机临时PG（取消TEST_DATABASE_URL），日志 `/private/tmp/edg-c8-baseline-*.log`。

## 3. Discord适配器

先失败测试、实现、绿后提交：

- 独立context／parent／owner和移动前context／member／source／target读取并行；不跨操作或POST复用权限。
- 新增可选createVoiceVerified返回严格核对过的真实POST频道回执，旧createVoice仍返回string。核对id、guild、类型、父分类、名称、人数及本次显式ACL；任何POST后畸形／不符结果标记不确定，保留审计marker恢复，禁止盲目重建。
- 新增可选moveFrom绑定原source，开始和PATCH前都检查位置。成员已离开或失去目标连接权限时不移动；Bot缺权限明确失败。每次移动仍读取当前角色、成员和覆盖权限。
- native写入前调用beforeWrite重查数据库身份／租约／版本，之后再次核对位置／Gateway；Bot消息位仍只取服务器权限与分类有效权限的交集。

## 4. 指定任务及调度

- claim可指定刚入队的ref，只尝试该项，不能顺便执行无关旧任务；同scope的running／needs_review／更早queued屏障、guild隔离及并发短锁不变。
- 入口保存enqueue返回值并指定执行。tick合并重复调用，逐个房间／作业投递serial片段，每片完成后才投下一片，让已排队的入口先行。
- 完整目录同步仍保持串行、epoch与完整性保护，不开并行入口lane。stop等待tick编排收尾，内部stopped检查防停止后继续入队。

## 5. 创建专用快路径

- 仅适配器同时支持两个新方法时启用。入口可复用完整成功快照中可用非Bot成员的显示映射；缺失／不可用时沿用单成员REST。映射只供排队／命名，不能当成实际权限许可。
- 创建中不重复读取仅为显示用途的member；native创建及移动已完整校验当前成员与权限时，合并engine重复member／canConnect／canView预读，保留DBauthority、租约、管理限制、room版本与最终guard。
- POST前复查设置版本／appliedVersion、完整快照ready／revision、原入口位置。自己创建引发的ChannelCreate失效不能误伤后续move；move依赖新鲜REST与当前设置／身份／位置核验。
- 创建意图必须在POST前落库，真实频道映射必须在移动前落库。源位置变化不拉回，已有新房进入原空房回收规则。创建回执未知仍待核对。
- 旧适配器继续原路径，已有人房间返回、固定房权限、语音证据和90天覆盖规则不变。

## 6. 可观测与验证

- 每次真实创建输出一条固定字段耗时摘要，区分队列、create、move、收尾与入口到移入；trace为随机短引用，不含原始Discord／频道／用户标识、房名、token、payload或上游错误。观察回调失败／变慢不影响业务。
- 基准用统一0／100／400ms REST延迟、有状态假Discord与真实engine／adapter，从轨迹动态算请求、波次与移入时刻；旧 `ed05342` 源提取到临时目录，不切换或污染当前工作树。分别测普通／管理员、已有旧房、回流、面板阻塞、双入口及等待中撤权／离开。
- 针对关键链路设置请求／波次预算，避免机器墙钟阈值。PG验证指定claim、scope屏障、并发和恢复；server验证权限／位置／回执及调度门闩。
- 提PR前八套全量及server build，记录各套件前后数量。线上端到端2秒目标由机主在相同环境测试，客户端传播、REST限流和网络不纳入假时钟结论。

## 7. 分支与提交

`codex/room-creation-latency`，从 `ed05342` 开始。每步先红后绿再commit：`<type>: <中文描述>（C8）`；不加署名行。并行分工仅提交各自明确文件，最后复核整树。

## 8. PR

标题 `perf: 缩短临时房创建与移入链路（C8）`。按步骤描述测试、前后基准、剩余真实网络限制及必要衔接。一个PR后停，等待机主检查与合并。

## 9. 边界

不部署、不操作Coolify／Cloudflare／远程数据库，不执行远程迁移或真实Discord调用。无密钥／导出数据提交；不改信誉／案件／语音隐私、永久深链、CSP或组件公共props契约；不为性能跳过新鲜授权、覆盖完整性或审计恢复。
