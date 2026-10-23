# dsh-plugin-nuaa-search

DSH（DeepSeek Harness）的本地搜索插件。它向 `ctx.web` 注册一个搜索提供方
（id = `local-search`），让 `web_search` 工具直接由本插件去真实搜索引擎取结果，
**不需要官方 DeepSeek API key**。


> 第三方社区插件，与南京航空航天大学官方无关。名字里的 `nuaa` 只是为了便于本校同学在插件市场里搜到；插件本身对任何网络环境通用。

它是 `@deepseek-ai/dsh-web-search-deepseek` 的替代品，不是包装：

| | 官方 `web-search-deepseek` | 本插件 |
| --- | --- | --- |
| 搜索来源 | DeepSeek 官方 `api.deepseek.com/anthropic/v1`，需要官方 key | 本机直连 Bing 中文站 / 360 / SearXNG |
| 协议 | Anthropic Messages + 原生 `web_search_20250305` | 一步到位：实现 `WebSearchProvider` 接口 |
| 成本 | 每次搜索一次模型请求 | 一次 HTTP 抓取，不动模型额度 |
| 依赖 | 官方额度 | 无（零 npm 依赖，只用内置 `fetch`） |

> 这也是"假 DeepSeek 端点 + 本地 HTTP 服务"那套方案的升级版：不再需要自建服务、
> 不需要重复校验 key、不需要伪造 Anthropic 报文 —— 取消信号、预算、错误码全部由
> DSH 的 `web` 接缝原生管理。

---

## 1. 安装

用自带 CLI（`dsh plugin` 会把剩余参数转发给 profile 目录里的 pnpm）：

```bat
dsh plugin --profile desktop add link:D:\Ai_Coding_Project\Problems\dsh-plugin-nuaa-search
```

`desktop` 是桌面版使用的 profile（`$DSH_HOME/profiles/desktop`）。装完这个命令会自动做三件事：

1. `package.json` 记录依赖 `dsh-plugin-nuaa-search: link:<你的路径>`；
2. 把包名追加进 `dsh.profile.bundles`（**顺序很重要**，排在最后才能盖住 base 的配置）；
3. 在 `node_modules` 里建符号链接。

然后**重启 DSH** 生效（bundle 列表变化不属于 profile 的 live patch 监视范围）。

从 npm 安装（发布之后）就是普通包名：

```bat
dsh plugin --profile desktop add dsh-plugin-nuaa-search
```

### 卸载 / 回退

```bat
dsh plugin --profile desktop remove dsh-plugin-nuaa-search
```

也可以只回退"谁来搜"，保留插件：在 `$DSH_HOME/profiles/desktop/cordis.patch.yml`
（用户层，永远最后应用）里写

```yaml
- id: web
  config:
    searchProvider: deepseek-official   # 换回官方
    fetchProvider: http
- id: web-search-deepseek
  disabled: false
```

## 2. 它怎么接管 `web_search`

DSH 的 web 接缝（`@deepseek-ai/dsh-web`）在执行期按 id 解析提供方：

- `web` 行的 `searchProvider` 有值 → 用那个 id 的提供方；
- 没配 → 必须**恰好一个**可用提供方，否则报 `WEB_PROVIDER_AMBIGUOUS`。

`dsh-base` 原本把它固定成 `deepseek-official`，本插件的 bundle patch
（`cordis.patch.yml`）把三件事一起做了：

```yaml
- insert:                         # 1) 挂上本插件
    - id: web-search-local
      name: dsh-plugin-nuaa-search
      config: { backend: auto, maxResults: 8, deadlineMs: 20000, ... }

- id: web                        # 2) 让 web 接缝用本插件
  config:
    searchProvider: local-search
    fetchProvider: http          # patch 是整段替换 config，原有字段必须写回

- id: web-search-deepseek        # 3) 停掉官方那行（不装官方 key 也用不了）
  disabled: true
```

插件本体只有一句关键的：

```js
export const name = 'web-search-local'
export const inject = ['web']
export function apply(ctx, config) {
  ctx.web.registerSearchProvider(new LocalSearchProvider(() => normalizeConfig(config)))
}
```

实现的接口就是 DSH 声明的那个：

```ts
interface WebSearchProvider {
  readonly id: string
  available(): boolean
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}
// WebSearchRequest { query: string; maxResults?: number }
// WebSearchResult  { content?: string; sources: WebSearchSource[]; truncated: boolean }
// WebSearchSource  { url: string; title?: string; snippet?: string; publishedAt?: string }
```

`content` 故意不设：让 `web_search` 工具自己拼那份 markdown 来源列表
（标题 / 链接 / 摘要 / 发布日期），和官方提供方的行为一致。

## 3. 搜索后端

`backend` 支持 `auto` / `bing` / `so360` / `baidu` / `searxng`，也可以写降级链
`"bing,so360"`。`auto` = `bing → so360 → searxng`：前一个拿不到结果才试下一个，
拿到第一批就停，不白等。

| 后端 | 状态 | 说明 |
| --- | --- | --- |
| `bing`（cn.bing.com） | ✅ 默认，~270ms | 直链 + 摘要 + 发布日期，最稳 |
| `so360`（so.com） | ✅ 可用 | 降级链第二位 |
| `searxng` | ⚠️ 需自建 | 公共实例在本机网络全部不可达，还要在实例上开 `format=json` |
| `baidu` | ⚠️ 常被拦 | 会弹「百度安全验证」，检测到就返回空结果，不会把验证页当结果 |

官方 API（Bing/Brave/Serper/Tavily/Exa）**不依赖**，也没实现 —— 它们都要 key。

## 4. 配置

改 `cordis.patch.yml` 里 `config:` 那段，重启生效：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `backend` | `auto` | 后端或降级链 |
| `maxResults` | `8` | 最多几条（1–20），也会尊重调用方给的 `request.maxResults` |
| `deadlineMs` | `20000` | 内部总截止；到点返回已拿到的结果，宁可空也不挂住 |
| `backendTimeoutMs` | `8000` | 单后端超时 |
| `searxngUrl` | 空 | `searxng` 后端的实例地址 |
| `userAgent` | Chrome 126 UA | 抓取 UA |
| `log` | `true` | 是否在宿主日志打一行每请求摘要 |

也可以用环境变量兜底覆盖：`SEARCH_BACKEND`、`SEARCH_MAX_RESULTS`、
`SEARCH_DEADLINE_MS`、`SEARXNG_URL`、`SEARCH_USER_AGENT`。

## 5. 自测

```bat
cd /d D:\Ai_Coding_Project\Problems\dsh-plugin-nuaa-search
node --test test/provider.test.mjs
```

10 项，一半纯逻辑一半真联网：

```
✔ 插件身份：name / inject / apply 形状正确
✔ apply() 会向 ctx.web 注册 provider
✔ 降级链解析
✔ 空查询直接返回空结果，不打网络
✔ 到内部截止时间就返回（不挂住）
✔ 后端不可用（searxng 未配置）时返回空结果而不是抛错
✔ 真联网：能搜到真实结果，且形状合规
✔ request.maxResults 会被尊重
✔ 查询保真：不同查询拿到不同结果
✔ 调用方取消信号能打断搜索
```

## 6. 验证记录

除了单测，还在真实 DSH 组合里跑过一整轮：新建临时 profile
（`dsh --profile localtest --from-default-profile headless`）装同一个包，让模型自己去调
`web_search`，宿主日志出现本插件的一行，模型拿到的是真实来源：

```
[web-search-local] query="DeepSeek 是什么" sources=8 backend=auto attempts=[bing=10(256ms)] ms=256

1. [DeepSeek | Into the Unknown](https://www.deepseek.com/)
2. [爆火的DeepSeek到底是什么？（一次性讲解清楚） - CSDN博客](https://blog.csdn.net/...)
3. [DeepSeek是什么？免费吗？2026年最新版新手使用教程一次 ...](https://zhuanlan.zhihu.com/...)
```

再查「南京航空航天大学」直接命中 `https://nuaa.edu.cn/main.htm`。
`dsh --profile desktop --dump-config` 也确认了最终树：
`web.searchProvider: local-search`、`web-search-local` 行已插入、`web-search-deepseek` 已 `disabled: true`。

## 7. 已知限制

- **抓取方案的通病**：Bing 的 HTML 结构改版就得改解析器。真到那天把 `backend` 切成
  `so360`，或上自建 SearXNG。
- **结果相关性取决于搜索引擎本身**，插件如实转发，不加工、不加摘要、不做 LLM 改写。
- **`publishedAt` 是猜的**：只在摘要开头的日期能被识别时才填
  （`2025年2月6日` / `Oct 1, 2026` / `2025-02-06`），识别不到就不填，不瞎编。
- **单查询、不翻页**：每次 `search()` 只搜一次。
- **没有设置页**：DSH 的「插件配置」标签页是各包手写卡片的，本插件只提供宿主侧能力，
  配置走 `cordis.patch.yml` 或环境变量。
- 高频请求可能被搜索引擎限流，这是给个人用的插件。

## 8. 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | 插件本体 + 四个搜索后端（零依赖，中文注释） |
| `cordis.patch.yml` | bundle patch：挂载插件、指定 `searchProvider`、停用官方行 |
| `package.json` | 包元数据；`dsh.bundle.patch` 指向上面那个 patch |
| `test/provider.test.mjs` | 单测（含真联网） |
| `README.zh.md` | 本文件 |
