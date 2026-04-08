# 数据管线

当前仓库已经从“直接手改 `data/games.json`”切到“标题表 + 事件表 + 构建输出”模式。

## 文件

- `data/titles.json`: 相对稳定的标题元数据
- `data/catalog-events.json`: 入库/出库事件
- `data/games.json`: 给前端消费的构建产物

## 命令

### 从旧数据迁移

```bash
npm run migrate:legacy
```

把旧版 `data/games.json` 拆成：

- `data/titles.json`
- `data/catalog-events.json`

### 生成前端数据

```bash
npm run build:data
```

把 `titles + events` 聚合成前端继续使用的 `data/games.json`。

### 抓官方当前库页面

```bash
npm run fetch:ps-plus
```

输出：

- `data/raw/ps-plus-page/YYYY-MM-DD.html`
- `data/snapshots/us/YYYY-MM-DD.json`

说明：

- 这是第一版 best-effort 抓取器
- 主要用于保留原始页面和生成当天快照
- 页面结构如果变化，解析规则需要跟着调整

### 抓官方 Blog 文章

```bash
npm run fetch:ps-blog
```

输出：

- `data/raw/ps-blog/YYYY-MM-DD.json`

说明：

- 来源是 `blog.playstation.com` 的 WordPress REST API
- 当前会抓两类文章：
  - `PlayStation Plus Monthly Games`
  - `PlayStation Plus Game Catalog`

### 导入官方 Blog 新增事件

```bash
npm run import:blog-events
```

说明：

- 默认读取 `data/raw/ps-blog/` 里最新的一份抓取结果
- 会把官方公告里的“新增入库”导入 `data/catalog-events.json`
- 匹配不到现有 title 时，会创建占位 title，避免覆盖已有记录

只做预演、不落盘：

```bash
npm run import:blog-events -- --dry-run
```

### 从快照推断上下架候选

```bash
npm run infer:snapshots
```

输入：

- `data/snapshots/us/*.json`

输出：

- `data/generated/snapshot-event-candidates.json`

说明：

- 至少需要两份快照
- 结果是候选事件，不是最终官方确认事件
- 适合给 `catalog-events.json` 做人工复核和补录

### 一次同步官方数据

```bash
npm run sync:official
```

顺序：

1. 抓当前 PS Plus 目录页面
2. 生成快照差分候选
3. 抓官方 Blog 文章
4. 导入官方新增事件
5. 重建前端使用的 `data/games.json`

说明：

- 这条命令适合作为服务器上的定时任务入口
- 其中快照差分主要给“离库候选”使用
- `Blog` 导入主要给“新增事件”使用

## 定时任务建议

如果服务器已经部署了仓库，可以在服务器上用 `crontab -e` 加一条：

```cron
15 8 * * * cd /home/dev/timeline && /usr/bin/git pull --ff-only && /usr/bin/npm run sync:official >> /var/log/ps-plus-timeline-sync.log 2>&1
```

含义：

- 每天早上 08:15 执行一次
- 先拉最新代码
- 再跑官方同步流程
- 把输出写到 `/var/log/ps-plus-timeline-sync.log`

如果你想更稳一点，也可以拆成两条：

- 每天抓快照
- 每周或每天抓 Blog 并导入

## 当前约束

- 现有迁移数据仍然主要使用 `legacy:*` 形式的标题 ID
- 后续接 PlayStation Store 商品页后，建议逐步替换成真实 `productId` / `conceptId`
- `fetch:ps-plus` 和 `fetch:ps-blog` 已实现，但由于当前环境网络受限，这次没有在仓库内直接跑通在线抓取验证
- `import:blog-events` 当前优先自动化“新增事件”，不会直接自动写入离库事件
