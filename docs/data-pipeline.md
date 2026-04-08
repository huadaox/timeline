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

## 当前约束

- 现有迁移数据仍然主要使用 `legacy:*` 形式的标题 ID
- 后续接 PlayStation Store 商品页后，建议逐步替换成真实 `productId` / `conceptId`
- `fetch:ps-plus` 已实现，但由于当前环境网络受限，这次没有在仓库内直接跑通在线抓取验证
