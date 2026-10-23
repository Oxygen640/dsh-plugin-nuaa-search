# 发布到插件市场 · 零基础版

目标：让你的插件出现在 DSH 的 **插件市场**（就是 `设置 → 插件` 里能搜、能一键装的那个），
本校同学搜 `nuaa` 或「南航」就能找到。

已经定好的名字：

| 用途 | 值 |
| --- | --- |
| GitHub 仓库名 | `dsh-plugin-nuaa-search` |
| npm 包名 | `dsh-plugin-nuaa-search`（已查，未被占用） |
| 市场里显示的条目 | `<你的GitHub用户名>/dsh-plugin-nuaa-search` |
| 分类 | `browser` |
| 协议 | MIT |

---

## 一、先搞清三个"名字"（这是你刚才问的点）

一个插件在三个地方各有一个名字，它们**不是同一个东西**：

| 名字 | 长什么样 | 干什么用 | 用户能看到吗 |
| --- | --- | --- | --- |
| **GitHub 仓库名** | `zhangsan/dsh-plugin-nuaa-search` | 放代码的地方；市场条目标题就是它；条目文件名、链接都靠它 | ✅ 市场列表上的大字标题 |
| **npm 包名** | `dsh-plugin-nuaa-search` | 安装标识，`dsh plugin add <这个名字>`；也是大陆下载走腾讯镜像的那个包 | ⚠️ 详情页里能看到 |
| **市场条目** | 市场仓库里的一个 YAML 文件 | 决定分类、中英文描述、图标 | ✅ 卡片上的说明文字 |

**学生搜什么能搜到？** 市场搜索会同时匹配这些字段（权重从高到低，这是从 `dsh-market` 源码里读出来的真值）：

| 字段 | 权重 | 我们填了什么 |
| --- | --- | --- |
| `name`（`owner/repo`） | 700 | `…/dsh-plugin-**nuaa**-search` |
| `npm` 包名 | 700 | `dsh-plugin-**nuaa**-search` |
| `owner`（你的用户名） | 400 | 你的用户名 |
| 首选描述（中文） | 280 | 含「南京航空航天大学」「南航」「校园网」 |
| 其他语言描述 | 240 | 英文版 |
| 分类 id / 分类名 | 180 | `browser` / 浏览器与网络 |

所以搜 `nuaa`、`南航`、`南京航空航天大学`、`web_search`、`搜索` 都能命中。
搜索还做了中英混排切分，`nuaa搜索` 这种连写也能用。

> ⚠️ 提醒：这是**公开目录**，全世界都能看到、都能装，不只是本校。
> 插件里没有任何密钥，所以没有隐私风险；但名字里带 `nuaa` 容易被误认为是学校官方插件，
> 所以我在 README 里写了「第三方社区插件，与南京航空航天大学官方无关」——
> 这句话建议保留。

## 二、为什么非要 GitHub 仓库（不能只发 npm 吗）

因为收录流程就是围绕 GitHub 仓库设计的，三条硬性原因：

1. **CI 会去仓库读 `package.json`**，验证里面声明了 `dsh.bundle.patch`（没这个就装不上）；
2. **仓库创建必须满 1 天**，CI 自动查——这是为了挡掉"提 PR 前几分钟刚建的空仓库"；
3. **维护者会读你的代码**，核对描述里说的是不是真的（比如"抓 Bing/360/SearXNG"就得真有）。

npm 是可选的，但**强烈建议发**，因为大陆用户下载走的是腾讯镜像
`mirrors.cloud.tencent.com/npm`——只有发到 npm，他们才是从腾讯镜像快速装；
只放 GitHub 的话会绕 `gh-proxy.com` 代理，慢而且容易断。

---

## 三、你要做的 5 件事

> 每一步都给了"网页版"做法（不用命令行）和"终端版"做法（可选）。
> 代码我已经全部写好了，你只需要搬运。

### ① 注册 GitHub 账号（5 分钟）

打开 <https://github.com/signup>，用邮箱注册。用户名会成为 `owner`，
比如你叫 `zhangsan`，那插件就是 `zhangsan/dsh-plugin-nuaa-search`。

### ② 建仓库并上传代码（网页版，不用 git）

1. 登录后点右上角 **+ → New repository**
2. **Repository name** 填：`dsh-plugin-nuaa-search`
3. 选 **Public**（必须公开，CI 要能读），**不要**勾 "Add a README file"
4. 点 **Create repository**
5. 在新仓库页面点 **uploading an existing file**
6. 把本地这个文件夹里的**全部文件**拖进去：

```
D:\Ai_Coding_Project\Problems\dsh-plugin-nuaa-search\
├── index.js            ← 插件本体
├── cordis.patch.yml    ← 挂载声明（必须有）
├── package.json        ← 必须有 dsh.bundle
├── README.md
├── README.zh.md
├── LICENSE
├── assets\
│   └── icon-180.jpg   ← 市场卡片图标
└── test\provider.test.mjs
```

7. 下面 **Commit changes** 点一下

> 终端版（装了 Git 的话）：
> ```bat
> cd /d D:\Ai_Coding_Project\Problems\dsh-plugin-nuaa-search
> git init & git add -A & git commit -m "feat: zero-key search provider for DSH web_search"
> git branch -M main
> git remote add origin https://github.com/<你的用户名>/dsh-plugin-nuaa-search.git
> git push -u origin main
> ```

### ③ 给仓库加 topic（30 秒，必须）

仓库首页右侧 **About** 旁边的齿轮 ⚙ → **Topics** 里加：`dsh-plugin` → Save。

### ④ 发布到 npm（10 分钟，大陆用户的关键）

```bat
cd /d D:\Ai_Coding_Project\Problems\dsh-plugin-nuaa-search

:: 先把仓库地址写进 package.json（见下面），否则 npm 包不会和市场条目关联、没有下载量统计
:: 然后：
npm login
npm publish --access public
```

`package.json` 里要加这 4 行（把 `<你的用户名>` 换掉）：

```jsonc
"repository": { "type": "git", "url": "git+https://github.com/<你的用户名>/dsh-plugin-nuaa-search.git" },
"homepage": "https://github.com/<你的用户名>/dsh-plugin-nuaa-search#readme",
"bugs": { "url": "https://github.com/<你的用户名>/dsh-plugin-nuaa-search/issues" },
"author": "<你的名字或昵称>",
```

发布后验一下腾讯镜像有没有同步（要等几分钟到几小时）：

```bat
curl https://mirrors.cloud.tencent.com/npm/dsh-plugin-nuaa-search/latest
```

### ⑤ 提 PR 加一个文件（唯一的"申请收录"动作）

打开 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>，点 **Fork**，
然后在你的 fork 里新建文件：

```
data/plugins/<你的用户名>__dsh-plugin-nuaa-search.yml
```

内容（把 `<你的用户名>` 换掉，其余照抄）：

```yaml
url: https://github.com/<你的用户名>/dsh-plugin-nuaa-search
name: <你的用户名>/dsh-plugin-nuaa-search
category: browser
description:
  en: 'Zero-key web search provider for the built-in web_search tool: scrapes Bing China, 360 and SearXNG through a backend fallback chain and returns real URLs with snippets and publish dates. No API key and no settings card are required.'
  zh: '免 key 的 web_search 后端：按降级链抓取 Bing 中文站、360 与 SearXNG，返回真实 URL、摘要与发布日期；不需要任何 API key，也没有设置卡片。面向校园网等拿不到官方 key 的环境。'
icon: https://raw.githubusercontent.com/<你的用户名>/dsh-plugin-nuaa-search/main/assets/icon-180.jpg
```

三个坑：
- 描述里有 `: `（冒号+空格）**必须**用引号包起来，否则 YAML 解析失败（上面已经加了）；
- **不要**写 `npm:` 字段——它由 registry 自动采集，手写会被校验拒；
- **不要**手改 README，那是脚本生成的。

PR 标题：

```
Add dsh-plugin-nuaa-search — zero-key web search provider
```

PR 正文：

```
Adds data/plugins/<你的用户名>__dsh-plugin-nuaa-search.yml.

- Replaces the built-in web_search backend. No official DeepSeek key and no third-party
  search API key are needed, which is the gap this fills: the two existing search providers
  in this category both require keys (dsh-plugin-tavily: Tavily key; dsh-websearch: keys for
  most of its engines).
- Backends: Bing China, 360 Search, SearXNG, with a fallback chain and a 20s internal
  deadline that returns partial results instead of hanging.
- package.json declares dsh.bundle.patch; cordis.patch.yml points web.searchProvider at this
  provider and disables the official web-search-deepseek row.
- Repo has the dsh-plugin topic. Tested end-to-end inside a real DSH composition: the model
  called web_search and received 8 real sources.
```

> 如果 `icon` 那行暂时没有图，**把这一行删掉**即可（市场会回退到你的 GitHub 头像）。

---

## 四、时间线

| 时间 | 做什么 |
| --- | --- |
| 今天 | ①②③ 做完（仓库建起来就开始算"满 1 天"） |
| 今天 | ④ 发 npm（可选但推荐） |
| **明天以后** | ⑤ 提 PR（不到 1 天 CI 必拒） |
| 几天内 | CI 绿 → 维护者读代码 → 合并 → 网站和目录自动重建 |
| 之后 | 同学在 `设置 → 插件` 搜 `nuaa` 就能装 |

CI 依次检查：条目 ≤ 3 → `dsh.bundle` 存在 → 仓库年龄 ≥ 1 天 → lint 与站点构建。
失败会在 PR 评论里指出改什么，**在同一个分支上推修复**即可，不用重开 PR。

## 五、几个会被打回的情况（都已提前避开）

| 坑 | 我们的状态 |
| --- | --- |
| 只声明 `dsh.client`、没有 `dsh.bundle` | ✅ 已声明 `dsh.bundle.patch` |
| 仓库不满 1 天 | ⚠️ 明天再提 |
| 忘加 `dsh-plugin` topic | ⚠️ 步骤 ③ |
| 描述夸大、和代码对不上 | ✅ 描述只写实现里真有的 |
| 和已有条目重复 | ✅ 差异化写明：现有两个搜索插件都要 key |
| 手改生成的 README | ✅ 只加自己那一个 yml |
| 一个 PR 塞多个插件 | ✅ 只提 1 条 |
| 官方 `@deepseek-ai/*` 写成 `dependencies` | ✅ 一个都没依赖 |

## 六、现在只差一个东西：你的 GitHub 用户名

1. ✅ **图标已就位**：你给的 `Tou_Xiang.jpg`（320×320 方图，28 KB）已经用**原始字节**放进
   `assets\icon-180.jpg`（没有重编码，不会糊），`package.json` 的 `icon` 和条目里的 `icon:`
   路径都已指向它。市场按约 96px 显示，320 够了。
   > 这张图会作为插件卡片在公开市场里展示，和你的 GitHub 头像一样是所有人可见的。
   > 如果想换成更"插件感"的几何图标，随时换文件、改一行路径即可。
2. ⏳ **GitHub 用户名**：告我之后，我把下面 3 处的 `<你的用户名>` 一次性填死：
   - `package.json` 的 `repository` / `homepage` / `bugs` / `author`
   - 条目 YAML 的 `url` / `name` / `icon`
   - PR 标题与正文

   你也可以自己全局替换，一共就 12 个地方。

## 七、可选加分项

**截图**：仓库根目录放 `screenshots.json`，列 1–8 张仓库内的相对路径：

```json
["assets/screenshot-1.png", "assets/screenshot-2.png"]
```

市场详情页会像 App Store 那样展示。以后换图推自己仓库即可，下次构建自动生效。
不声明也行，市场会从 README 里自动抽图。

---

## 附：我已经做完的部分

| 产物 | 状态 |
| --- | --- |
| `index.js`（插件本体，四个后端） | ✅ 10/10 单测通过 |
| `cordis.patch.yml`（挂载 + 接管 `searchProvider` + 停用官方行） | ✅ 已在真 DSH 里端到端验过 |
| `package.json`（`dsh.bundle.patch`、`files` 已收敛） | ✅ `npm pack` 实测 7 文件 / 43.2 kB |
| `assets/icon-180.jpg`（市场卡片图标） | ✅ 用你给的原图字节，320×320 |
| `README.md` / `README.zh.md` | ✅ 含"第三方、非官方"声明 |
| `LICENSE`（MIT） | ✅ 待填作者名 |
| 收录条目 YAML、PR 标题与正文 | ✅ 见上方，只差替换 `<你的用户名>` |
