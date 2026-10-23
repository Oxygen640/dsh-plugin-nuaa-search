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

From the market, or:

```bat
dsh plugin --profile desktop add dsh-plugin-nuaa-search
```

Restart the harness. The bundle patch points `web.searchProvider` at `local-search` and
disables the official `web-search-deepseek` row (re-enable it in your profile's
`cordis.patch.yml` if you want it back).

## Backends

`auto` (default) = `bing` → `so360` → `searxng`: the first backend that returns results
wins, so a blocked or broken engine costs one timeout, not the whole search.

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
| `log` | `true` | one summary line per search in the host log |

## Test

```bat
node --test test/provider.test.mjs
```

10 tests, including live network searches, query fidelity, `maxResults`, deadline, and
caller cancellation.

## Limitations

- HTML scraping: a Bing markup change needs a parser update (switch `backend` to `so360` meanwhile).
- Relevance is the search engine's; results are passed through, not re-ranked or summarized.
- `publishedAt` is only set when a date is readable at the start of the snippet — never invented.
- One query per call, no pagination.

## License

MIT
