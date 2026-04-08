# PS Plus 会员库自动更新实现研究

更新日期：2026-04-08

## 现状

当前项目是纯静态数据驱动：

- 前端直接读取 `data/games.json`
- 没有抓取、同步、校验、快照、差分逻辑
- `data/ps_plus_history_research.txt` 是人工整理资料，不是机器可重复执行的数据源

这意味着现在的“更新时间”只是手工维护结果，不是系统实际同步结果。

## 先说结论

这个项目可以做到“绝大部分自动更新”，但很难做到“100% 仅靠公开网页、零人工介入地精确拿到所有游戏的上下架时间”。

原因是 PlayStation 官方公开信息分成三层：

1. 当前仍在库里的游戏列表：能拿到
2. 每月新入库游戏和生效日期：能拿到
3. 每个 Game Catalog 游戏的精确离库日期：公开结构化来源不稳定，很多时候拿不到完整列表

所以现实可行方案是：

- `Essential`：基本可自动化
- `Extra / Premium` 的“新增”：可自动化
- `Extra / Premium` 的“离库”：做成“自动发现 + 官方信息补强 + 少量人工确认”的半自动流程

## 官方来源核实结果

### 1. 当前目录列表可从官方页面获取

PlayStation 官方 `PS Plus games` 页面公开了当前可见的完整 A-Z 列表，并区分：

- Game Catalog
- Classics Catalog
- Monthly Games
- Game Trials

来源：

- https://www.playstation.com/en-us/ps-plus/games/

这个页面还能直接拿到每个游戏的 `store.playstation.com` 链接，因此可以继续反查商品页信息。

### 2. 官方会明确说明“目录会变化，但并不公开完整 end date 数据”

同一官方页面 FAQ 明确写了：

- Game Catalog 和 Classics Catalog 中“some games may have an end date”

来源：

- https://www.playstation.com/en-us/ps-plus/games/

但这个页面本身没有给出每个游戏的具体离库日期字段。

### 3. 官方 Blog 能稳定拿到“每月新增 + 生效日期”

PlayStation Blog 每月会发两类文章：

- `PlayStation Plus Monthly Games ...`
- `PlayStation Plus Game Catalog ...`

这些文章通常能拿到：

- 本月新增名单
- 对应 tier
- 可玩/可领取开始日期
- 对于 Monthly Games，通常还能拿到截至日期

示例：

- https://blog.playstation.com/2026/04/01/playstation-plus-monthly-games-for-april-lords-of-the-fallen-tomb-raider-i-iii-remastered-sword-art-online-fractured-daydream/
- https://blog.playstation.com/2026/03/11/playstation-plus-game-catalog-for-march-warhammer-40000-space-marine-2-ea-sports-madden-nfl-26-persona-5-royal-blasphemous-2-and-more/

### 4. 官方确实存在“Last chance to play”信息，但主要在主机端，不是稳定公开 API

官方 Blog 在部分文章里明确提到：

- 离库游戏会出现在主机端的 `Last chance to play` 区域

示例：

- https://blog.playstation.com/2024/05/15/playstation-plus-game-catalog-for-may-red-dead-redemption-2-deceive-inc-crime-boss-rockay-city-and-more/

这说明“离库提醒”是官方存在的数据，但公开网页侧并没有稳定、完整、结构化地暴露出来。

### 5. Store 商品页能判断“当前是否包含在 PS Plus”，但没看到公开离库时间

商品页常见文案是：

- `Subscribe to PlayStation Plus Extra to access this game and hundreds more in the Game Catalog`

示例：

- https://store.playstation.com/en-us/product/UP1018-PPSA01593_00-HOGWARTSLEGACY01

这对“当前是否在库”有帮助，但对“什么时候离库”帮助有限。

## 为什么现有数据结构不适合自动同步

当前 `data/games.json` 的记录形态接近：

```json
{
  "id": "ext-2022-06-acv",
  "title": "Assassin's Creed Valhalla",
  "tier": "extra",
  "platform": "PS4/PS5",
  "addedDate": "2022-06-13",
  "removedDate": "2022-12-20"
}
```

这个结构有两个问题：

1. 一个游戏只能有一组 `addedDate/removedDate`
2. 不能表示“同一游戏离库后又重新入库”

而 PS Plus 实际上存在：

- 重复回库
- 同系列不同版本分别入库
- 同一 concept 下不同 edition 的 Plus 状态不一致

所以如果要做自动更新，建议从“游戏列表”改成“事件流”。

## 建议的数据模型

建议拆成至少两个文件。

### 1. `data/titles.json`

存放相对稳定的商品信息：

```json
{
  "titles": [
    {
      "id": "UP1018-PPSA01593_00-HOGWARTSLEGACY01",
      "conceptId": "232447",
      "title": "Hogwarts Legacy PS5 Version",
      "canonicalUrl": "https://store.playstation.com/en-us/product/UP1018-PPSA01593_00-HOGWARTSLEGACY01",
      "cover": "https://image.api.playstation.com/...",
      "platform": ["PS5"]
    }
  ]
}
```

### 2. `data/catalog-events.json`

存放“入库/出库事件”：

```json
{
  "events": [
    {
      "titleId": "UP1018-PPSA01593_00-HOGWARTSLEGACY01",
      "tier": "extra",
      "catalog": "game-catalog",
      "region": "US",
      "eventType": "added",
      "eventDate": "2025-04-15",
      "confidence": "official-blog",
      "sourceUrl": "https://blog.playstation.com/2025/04/09/..."
    },
    {
      "titleId": "UP1018-PPSA01593_00-HOGWARTSLEGACY01",
      "tier": "extra",
      "catalog": "game-catalog",
      "region": "US",
      "eventType": "removed",
      "eventDate": "2025-10-21",
      "confidence": "snapshot-confirmed",
      "sourceUrl": "https://www.playstation.com/en-us/ps-plus/games/"
    }
  ]
}
```

再由构建脚本把事件聚合成前端需要的时间线视图。

## 可落地的自动更新方案

## 方案总览

建议做成三段式：

1. 官方网页抓取当前快照
2. 官方 Blog 抽取新增事件
3. 用快照差分推断离库事件，并给出置信度

## A. 当前在库快照抓取

目标：每天拿到一次“当前 US 区仍在库的标题集合”。

抓取源：

- `https://www.playstation.com/en-us/ps-plus/games/`

要提取的字段：

- 标题名
- 所属区块：Monthly Games / Game Catalog / Classics / Trials
- 商品页 URL
- 可能的封面图

输出建议：

- `snapshots/us/2026-04-08.json`

示例结构：

```json
{
  "capturedAt": "2026-04-08T08:00:00Z",
  "region": "US",
  "items": [
    {
      "section": "game-catalog",
      "title": "Hogwarts Legacy PS5 Version",
      "url": "https://store.playstation.com/en-us/product/UP1018-PPSA01593_00-HOGWARTSLEGACY01"
    }
  ]
}
```

价值：

- 可自动更新当前在库状态
- 可用于检测“昨天还在，今天不在”的离库候选

## B. 月度 Blog 解析新增事件

目标：拿到官方确认的 `addedDate`。

抓取源：

- `PlayStation Plus Monthly Games ...`
- `PlayStation Plus Game Catalog ...`

解析规则：

- 从文章标题判断类型
- 从正文提取“available from / available to play on / from Tuesday ... until Monday ...”
- 逐个解析游戏标题和平台

输出：

- `eventType = added`
- `confidence = official-blog`

这一步对 `Essential` 特别有效，因为官方每个月都给开始日期，而且往往直接给领取截止区间。

## C. 用快照差分发现离库

目标：在没有公开 end date API 的情况下，尽可能自动补全 `removedDate`。

规则：

- 某个 title 昨天在快照里，今天不在了
- 且不是因为页面结构变更或标题归一化失败
- 则生成一个离库候选事件

示例：

```json
{
  "eventType": "removed",
  "eventDate": "2026-04-08",
  "confidence": "snapshot-diff"
}
```

然后再用两种方式补强：

- 若当月官方 Blog 明确写了 leaving date，则升级为 `official-note`
- 若人工从主机端 `Last chance to play` 核对过，则升级为 `console-confirmed`

## 建议的置信度体系

为了避免“自动化看起来很准，实际上是猜的”，建议把来源显式写出来：

- `official-blog`
- `official-page`
- `official-note`
- `snapshot-diff`
- `console-confirmed`
- `manual`

前端可以把低置信度离库时间显示成不同样式，例如：

- 实线：官方确认
- 虚线：快照推断

## 实现时最关键的技术点

### 1. 不能只靠标题匹配，必须尽量落到商品 ID

同名、版本差异、豪华版/标准版、PS4/PS5 跨版本都会导致标题匹配不稳定。

优先使用：

- product id，例如 `UP1018-PPSA01593_00-HOGWARTSLEGACY01`
- concept id，例如 `232447`

它们通常能从 Store URL 或商品页拿到。

### 2. 页面解析要按 section，而不是只扫所有链接

因为同一页面同时混有：

- Monthly Games
- Game Catalog
- Classics Catalog
- Game Trials

如果不保留 section，上游抓到的只是“游戏名集合”，下游就没法确定 tier。

### 3. 需要做标题归一化层

至少要处理：

- `PS4 & PS5`
- `PS4/PS5`
- 冒号、破折号、注册商标符号
- `Standard Edition` / `Digital Deluxe Edition`

建议做两个字段：

- `displayTitle`
- `normalizedTitle`

## 推荐的目录和脚本

建议新增：

```text
scripts/
  fetch-ps-plus-page.mjs
  fetch-ps-blog-posts.mjs
  normalize-store-product.mjs
  build-catalog-events.mjs
  build-games-json.mjs

data/
  raw/
    ps-plus-page/
    ps-blog/
  snapshots/
    us/
  titles.json
  catalog-events.json
  games.json
```

职责划分：

- `fetch-ps-plus-page.mjs`: 拉当前目录页并产出快照
- `fetch-ps-blog-posts.mjs`: 拉官方 Blog 并抽取新增事件
- `normalize-store-product.mjs`: 从 Store URL 反查 product id / concept id / cover
- `build-catalog-events.mjs`: 合并官方事件和快照差分
- `build-games-json.mjs`: 生成前端继续使用的兼容格式

## 推荐执行流程

每天跑一次：

1. 抓 `ps-plus/games` 页面
2. 更新当天快照
3. 和上一份快照做 diff
4. 补充当前 active 状态
5. 若有新 Blog 文章，则写入新增事件
6. 重建 `games.json`

每月人工核对一次：

1. 检查当月 `Game Catalog` Blog
2. 检查是否提到 leaving titles
3. 如有条件，从主机端 `Last chance to play` 补齐高置信度离库日期

## 对这个项目最实际的分阶段路线

### Phase 1

先解决“以后不再纯手工维护”：

- 保留现有前端
- 新增抓取脚本
- 每天生成 catalog 快照
- 自动更新当前在库状态

这一步已经能显著减少手工维护量。

### Phase 2

把新增事件自动化：

- 自动抓 PlayStation Blog
- 自动写入 `addedDate`
- 自动补齐新游戏封面和商店链接

这一步后，新增基本不用手填。

### Phase 3

把离库变成“高概率自动 + 少量确认”：

- 快照差分生成离库候选
- 官方 Blog note 补强
- 主机端手工校验少量争议项

这是精度和维护成本最平衡的方案。

## 不建议的方向

以下方案不建议作为主方案：

- 只靠第三方站点整理历史
- 只靠游戏标题做模糊匹配
- 继续把全部历史塞进一个平面的 `games.json`
- 假设官方网页一定会公开所有离库时间

这些方案都很脆弱，后面维护成本会更高。

## 对当前仓库的直接建议

如果下一步开始做，我建议先改这三件事：

1. 把数据层从单文件平面结构改成 `titles + catalog-events + build output`
2. 新增“官方快照抓取”脚本
3. 新增“官方 Blog 事件解析”脚本

这样即使离库时间还做不到 100% 全自动，系统也已经从“纯人工填表”升级到“自动同步为主，人工只做校验”。
