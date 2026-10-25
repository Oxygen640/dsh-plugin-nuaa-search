# dsh-plugin-nuaa-search

A **zero-key** web search provider for DeepSeek Harness's built-in `web_search` tool.

It registers a search provider (`local-search`) into the harness's `ctx.web` seam and
answers queries by scraping real search engines — no official DeepSeek API key, no
third-party search API key, no settings card.

> 中文说明见 [`README.zh.md`](./README.zh.md)。

> Third-party community plugin, not affiliated with Nanjing University of Aeronautics and Astronautics. The `nuaa` in the name only helps students find it in the market; the plugin itself is network-agnostic.

## Why

`@deepseek-ai/dsh-web-search-deepseek` sends every search to DeepSeek's official
Anthropic-compatible endpoint, which needs an official API key. On a network or plan where
that key is unavailable (for example a mainland-China campus gateway that only serves an
OpenAI-compatible endpoint), `web_search` fails. This plugin replaces the provider instead
of the endpoint: it implements the harness's own `WebSearchProvider` interface and fetches
results itself.

## Install

This package is **not published to npm** (npm signup was unavailable for the author), so
install it from the market or from a prebuilt release tarball — do not run
`dsh plugin add <package-name>`, there is no registry entry behind that name.

**From the market (easiest):** open DSH → Settings → Plugins, search `nuaa`, and install.
Listing: <https://awesome-dsh-plugin.com/p/Oxygen640/dsh-plugin-nuaa-search/>

**From the prebuilt tarball:**

```bat
dsh plugin --profile desktop add "https://github.com/Oxygen640/dsh-plugin-nuaa-search/releases/latest/download/dsh-plugin-nuaa-search.tgz"
```

**From source:**

```bat
dsh plugin --profile desktop add github:Oxygen640/dsh-plugin-nuaa-search
```

Restart the harness. The bundle patch points `web.searchProvider` at `local-search` and
disables the official `web-search-deepseek` row (re-enable it in your profile's
`cordis.patch.yml` if you want it back).

## Backends

`auto` (default) = `bing` → `so360` → `searxng`: the first backend that returns results
wins, so a blocked or broken engine costs one timeout, not the whole search.

**Query variants.** Chinese long-tail queries break Bing's ranking: `南京航空航天大学图书馆`
returns the official library pages, while `南京航空航天大学图书馆 预约座位` returns generic
"南京市" pages instead. So each search also runs a second variant with trailing intent words
(`开放时间`, `预约座位`, `几点`, `怎么…`, `地址`, …) stripped, and keeps whichever result set
is more relevant to the entity phrase (longest-common-substring coverage; ties keep the
original query so ordinary searches are unaffected). Measured on the failing case: 1/8 → 7/8
results from `nuaa.edu.cn`. Turn it off with `stripIntent: false`.

| Backend | Status | Notes |
| --- | --- | --- |
| `bing` | default, ~270ms | Bing China HTML: direct URLs, snippets, publish dates |
| `so360` | fallback | 360 Search HTML: direct URLs |
| `searxng` | needs your instance | JSON API; the instance must enable `format=json` |
| `baidu` | often blocked | returns `[]` when the anti-bot page appears, never the challenge page |

## Config

Passed as the row `config` in `cordis.patch.yml`, or via environment variables as fallback.

| Key | Default | Meaning |
| --- | --- | --- |
| `backend` | `auto` | one backend or a chain (`"bing,so360"`) |
| `maxResults` | `8` | cap; the caller's `request.maxResults` is also honored |
| `deadlineMs` | `20000` | internal deadline — returns what it has instead of hanging |
| `backendTimeoutMs` | `8000` | per-backend timeout |
| `searxngUrl` | — | instance base URL |
| `userAgent` | Chrome 126 UA | user agent used for scraping |
| `log` | `true` | one summary line per search in the host log |
| `stripIntent` | `true` | also search the entity phrase with trailing intent words stripped |

Environment fallbacks: `SEARCH_BACKEND`, `SEARCH_MAX_RESULTS`, `SEARCH_DEADLINE_MS`,
`SEARXNG_URL`, `SEARCH_USER_AGENT`.

## Test

```bat
node --test test/provider.test.mjs
```

17 tests: backend-chain and config logic, the provider contract, query-variant relevance,
live network searches, `maxResults`, deadline, cancellation (including an already-aborted
signal), and query length normalization.

## Releasing a new version

No registry is involved, so a release is: bump `version` in `package.json`, then build and
attach the tarball under the **same asset name** so the `latest/download/` URL keeps working.

```bat
npm pack --pack-destination release
ren release\dsh-plugin-nuaa-search-0.1.2.tgz dsh-plugin-nuaa-search.tgz
```

Then publish a GitHub release and attach `dsh-plugin-nuaa-search.tgz`.

## Limitations

- HTML scraping: a Bing markup change needs a parser update (switch `backend` to `so360` meanwhile).
- **Bing ranks multi-token Chinese queries badly.** It handles a clean entity name
  (`南航图书馆`, `南京航空航天大学图书馆`) well, but degrades toward generic city pages when
  extra qualifiers pile up — `南京航空航天大学将军路校区图书馆` already returns "南京市".
  The query-variant fix covers the common "entity + intent word" shape, not this one.
- `site:` queries are not supported by the HTML endpoint and are passed through as plain text.
- Relevance is the search engine's; results are passed through, not rewritten or summarized.
- `publishedAt` is only set when a date is readable at the start of the snippet — never invented.
- One query per call, no pagination.
- Queries are truncated to 200 characters, which is where search engines stop honoring them anyway.

## License

MIT
