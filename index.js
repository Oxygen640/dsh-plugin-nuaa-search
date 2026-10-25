/**
 * dsh-plugin-local-search —— DSH 的本地搜索引擎插件。
 *
 * 不做"假 Anthropic 端点"，也不起本地 HTTP 服务：直接作为 Cordis 插件向
 * `ctx.web` 注册一个搜索 provider（id = `local-search`），`web_search` 工具
 * 就调到这里，由插件自己抓真实搜索结果。
 *
 * 这样比"伪装 DeepSeek 端点"少一整层：没有自建 HTTP 服务、没有重复的 key 校验、
 * 没有伪造的 Anthropic 报文；取消信号、预算、错误码都由 DSH 的 web 接缝原生管理。
 *
 * 契约（照 @deepseek-ai/dsh-web 的真实声明实现）：
 *   interface WebSearchProvider {
 *     readonly id: string
 *     available(): boolean
 *     search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
 *   }
 *   WebSearchRequest  { query: string; maxResults?: number }
 *   WebSearchResult   { content?: string; sources: WebSearchSource[]; truncated: boolean }
 *   WebSearchSource   { url: string; title?: string; snippet?: string; publishedAt?: string }
 *
 * 零依赖：只用 Node 内置 fetch。不 import 任何 @deepseek-ai/*，避免模块解析差异。
 */

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 默认值。行配置（cordis.patch.yml 里的 config）会覆盖这里。 */
const DEFAULTS = {
  /** 后端：auto | bing | so360 | baidu | searxng，也可写降级链 "bing,so360" */
  backend: 'auto',
  /** 最多返回几条 */
  maxResults: 8,
  /** 内部截止毫秒，DSH 给 web_search 的预算是 30s/60s，这里留足余量 */
  deadlineMs: 20000,
  /** 单后端超时 */
  backendTimeoutMs: 8000,
  /** SearXNG 实例地址（backend=searxng/auto 时用） */
  searxngUrl: '',
  /** 抓取 UA，按正常浏览器写 */
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  /** 是否在宿主日志里打一行每请求摘要 */
  log: true,
};

/** 配置夹紧：数字有上下限，字符串去掉空值。 */
function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {};
  const num = (value, fallback, min, max) => {
    const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const str = (value, fallback) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  return {
    backend: str(input.backend, process.env.SEARCH_BACKEND ?? DEFAULTS.backend),
    maxResults: num(input.maxResults ?? process.env.SEARCH_MAX_RESULTS, DEFAULTS.maxResults, 1, 20),
    deadlineMs: num(input.deadlineMs ?? process.env.SEARCH_DEADLINE_MS, DEFAULTS.deadlineMs, 1000, 55000),
    backendTimeoutMs: num(input.backendTimeoutMs, DEFAULTS.backendTimeoutMs, 500, 55000),
    searxngUrl: str(input.searxngUrl ?? process.env.SEARXNG_URL, DEFAULTS.searxngUrl),
    userAgent: str(input.userAgent ?? process.env.SEARCH_USER_AGENT, DEFAULTS.userAgent),
    log: bool(input.log, DEFAULTS.log),
  };
}

// ---------------------------------------------------------------------------
// HTML / URL 工具
// ---------------------------------------------------------------------------

/** 解 HTML 实体（含数字实体）。 */
function decodeEntities(text) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ensp: ' ', emsp: ' ', thinsp: ' ', middot: '·', hellip: '…',
    mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', raquo: '»',
  };
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) => {
      const v = named[name.toLowerCase()];
      return v === undefined ? whole : v;
    });
}

/** 数字实体越界时不要炸。 */
function codePoint(code) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * 去标签 + 解实体 + 压空白。
 * 行内标签（搜索引擎用它高亮关键词）直接删掉而不是换成空格，否则标题会被断词。
 */
function stripTags(html) {
  const INLINE = /<\/?(?:strong|b|em|i|u|mark|span|a|cite|bdi|small|sup|sub|font|abbr)\b[^>]*>/gi;
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(INLINE, '')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从摘要开头的日期提取 YYYY-MM-DD。 */
function extractPublishedAt(text) {
  const head = String(text).slice(0, 60);
  let m = head.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m !== null) return isoDate(m[1], m[2], m[3]);
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  m = head.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})\b/);
  if (m !== null) {
    const mon = months[m[1].toLowerCase()];
    if (mon !== undefined) return isoDate(m[3], String(mon), m[2]);
  }
  m = head.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m !== null) return isoDate(m[1], m[2], m[3]);
  return null;
}

/** 组装 YYYY-MM-DD。 */
function isoDate(y, mo, d) {
  const year = Number.parseInt(y, 10);
  const month = Number.parseInt(mo, 10);
  const day = Number.parseInt(d, 10);
  if (!(year >= 1990 && year <= 2100) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 清洗 URL：去追踪参数与片段，非法值返回 null。 */
function cleanUrl(raw) {
  let url = decodeEntities(String(raw)).trim();
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from']) {
      u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}

/** 组一条来源；url 拿不到就整条丢掉（绝不编造）。 */
function makeSource(url, title, snippet, publishedAt) {
  const clean = cleanUrl(url);
  if (clean === null) return null;
  const t = typeof title === 'string' ? stripTags(title).slice(0, 200) : '';
  let s = typeof snippet === 'string' ? stripTags(snippet).slice(0, 400) : '';
  if (publishedAt !== null && publishedAt !== undefined && publishedAt !== '') {
    // 日期已经单独抽出来了，摘要开头别重复
    s = s.replace(
      /^\s*(?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3}[a-z]*\.?\s+\d{1,2},\s*\d{4})\s*[·•\-–]*\s*/,
      '',
    );
  }
  const source = { url: clean };
  if (t !== '') source.title = t;
  if (s !== '') source.snippet = s;
  if (publishedAt !== null && publishedAt !== undefined && publishedAt !== '') source.publishedAt = publishedAt;
  return source;
}

/** 取正文，3xx 一律当该源失败（和 DSH 自己的 fetch 语义保持一致）。 */
async function fetchText(url, timeoutMs, signal, userAgent, extraHeaders) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.any([signal, ctl.signal]),
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        ...extraHeaders,
      },
    });
    if (res.status < 200 || res.status >= 300) {
      await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 各搜索引擎后端
// ---------------------------------------------------------------------------

/** Bing 中文站。实测本机网络下最稳：直链、有摘要和日期。 */
async function searchBing(query, ctx) {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&ensearch=0`;
  const html = await fetchText(url, ctx.timeoutMs, ctx.signal, ctx.config.userAgent);
  const out = [];
  for (const chunk of html.split(/<li class="b_algo/).slice(1)) {
    const seg = chunk.slice(0, 6000);
    const linkMatch = seg.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (linkMatch === null) continue;
    let href = linkMatch[1];
    if (/bing\.com\/ck\/a/i.test(href)) {
      const decoded = decodeBingRedirect(href);
      if (decoded === null) continue;
      href = decoded;
    }
    let snippet = null;
    const pMatch = seg.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    if (pMatch !== null) snippet = pMatch[1];
    else {
      const capMatch = seg.match(/<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/);
      if (capMatch !== null) snippet = capMatch[1];
    }
    const plain = snippet === null ? null : stripTags(snippet);
    const source = makeSource(href, linkMatch[2], plain, plain === null ? null : extractPublishedAt(plain));
    if (source !== null) out.push(source);
  }
  return out;
}

/** 解 Bing 的 ck/a 跳转：u=a1<base64url> 就是真实地址。 */
function decodeBingRedirect(href) {
  try {
    const raw = new URL(href).searchParams.get('u');
    if (raw === null || !raw.startsWith('a1')) return null;
    const b64 = raw.slice(2).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** 百度 HTML。爱弹「安全验证」：一检测到就返回空，绝不把验证页当结果。 */
async function searchBaidu(query, ctx) {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&ie=utf-8`;
  const html = await fetchText(url, ctx.timeoutMs, ctx.signal, ctx.config.userAgent);
  if (/<title>\s*百度安全验证\s*<\/title>|请输入验证码|wappass\.baidu\.com/i.test(html)) return [];
  const seeds = [];
  for (const chunk of html.split(/<div[^>]+class="result[^"]*"/).slice(1)) {
    const seg = chunk.slice(0, 4000);
    const m = seg.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (m === null) continue;
    const snippetMatch = seg.match(/class="(?:c-abstract|content-right_8Zs40|result-content)"[^>]*>([\s\S]*?)<\/(?:div|span)>/);
    seeds.push({ href: decodeEntities(m[1]), title: m[2], snippet: snippetMatch === null ? null : snippetMatch[1] });
    if (seeds.length >= ctx.config.maxResults) break;
  }
  const resolved = await Promise.all(
    seeds.map((s) => resolveBaiduRedirect(s.href, Math.min(ctx.timeoutMs, 4000), ctx.signal, ctx.config.userAgent)),
  );
  const out = [];
  seeds.forEach((seed, i) => {
    if (resolved[i] === null) return;
    const plain = seed.snippet === null ? null : stripTags(seed.snippet);
    const source = makeSource(resolved[i], seed.title, plain, plain === null ? null : extractPublishedAt(plain));
    if (source !== null) out.push(source);
  });
  return out;
}

/** 跟随百度 link?url= 跳转取真实地址；解不出就丢掉这条，不编 URL。 */
async function resolveBaiduRedirect(href, timeoutMs, signal, userAgent) {
  if (/^https?:\/\//i.test(href) && !/baidu\.com\/link/i.test(href)) return href;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(href, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.any([signal, ctl.signal]),
      headers: { 'user-agent': userAgent, 'accept-language': 'zh-CN,zh;q=0.9' },
    });
    await res.body?.cancel?.().catch(() => {});
    const finalUrl = res.url;
    if (finalUrl !== undefined && !/baidu\.com\/(link|s)\b/i.test(finalUrl)) return finalUrl;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 360 搜索（so.com）。备选源，直链。 */
async function searchSo360(query, ctx) {
  const url = `https://www.so.com/s?q=${encodeURIComponent(query)}&ie=utf-8`;
  const html = await fetchText(url, ctx.timeoutMs, ctx.signal, ctx.config.userAgent);
  const out = [];
  for (const chunk of html.split(/<li[^>]+class="[^"]*\bres-list\b[^"]*"/).slice(1)) {
    const seg = chunk.slice(0, 6000);
    const m =
      seg.match(/<h3[^>]*class="[^"]*\bres-title\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) ??
      seg.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (m === null) continue;
    const snippetMatch = seg.match(/<p[^>]*class="[^"]*\bres-desc\b[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const plain = snippetMatch === null ? null : stripTags(snippetMatch[1]);
    const source = makeSource(m[1], m[2], plain, plain === null ? null : extractPublishedAt(plain));
    if (source !== null) out.push(source);
    if (out.length >= ctx.config.maxResults) break;
  }
  return out;
}

/** SearXNG 的 JSON API。公共实例实测不可达，需自建并开 format=json。 */
async function searchSearxng(query, ctx) {
  if (ctx.config.searxngUrl === '') throw new Error('searxngUrl 未配置');
  const base = ctx.config.searxngUrl.replace(/\/+$/, '');
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=zh-CN`;
  const text = await fetchText(url, ctx.timeoutMs, ctx.signal, ctx.config.userAgent, { accept: 'application/json' });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('searxng 返回的不是 JSON（实例可能关了 format=json）');
  }
  const items = Array.isArray(parsed.results) ? parsed.results : [];
  const out = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const source = makeSource(
      item.url ?? '',
      item.title ?? '',
      item.content ?? '',
      typeof item.publishedDate === 'string' ? item.publishedDate.slice(0, 10) : null,
    );
    if (source !== null) out.push(source);
    if (out.length >= ctx.config.maxResults) break;
  }
  return out;
}

/** 后端注册表。 */
const BACKENDS = { bing: searchBing, baidu: searchBaidu, so360: searchSo360, searxng: searchSearxng };

/** 把 backend 配置解析成降级链。auto = bing → so360 → searxng。 */
export function resolveChain(backend) {
  const raw = String(backend ?? 'auto').toLowerCase();
  if (raw === 'auto') return ['bing', 'so360', 'searxng'];
  const names = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  const valid = names.filter((n) => Object.hasOwn(BACKENDS, n));
  return valid.length > 0 ? valid : ['bing'];
}

// ---------------------------------------------------------------------------
// 搜索流程
// ---------------------------------------------------------------------------

/**
 * 按降级链搜一遍。拿到第一批就停；到内部截止时间就返回已拿到的（宁可空结果，也不挂住）。
 * @returns {Promise<{sources: object[], attempts: string[], timedOut: boolean}>}
 */
export async function runSearch(query, config, signal, deadlineAt = Date.now() + config.deadlineMs) {
  const chain = resolveChain(config.backend);
  const attempts = [];
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, Math.max(200, deadlineAt - Date.now()));
  const combined = ctl.signal;

  let sources = [];
  let timedOut = false;
  try {
    for (const name of chain) {
      const left = deadlineAt - Date.now();
      if (left <= 300) {
        timedOut = true;
        break;
      }
      const timeoutMs = Math.min(config.backendTimeoutMs, left);
      const startedAt = Date.now();
      try {
        const got = await BACKENDS[name](query, { config, timeoutMs, signal: combined });
        attempts.push(`${name}=${got.length}(${Date.now() - startedAt}ms)`);
        if (got.length > 0) {
          sources = got;
          break;
        }
      } catch (err) {
        attempts.push(`${name}=${errorName(err)}(${Date.now() - startedAt}ms)`);
        if (combined.aborted) {
          timedOut = true;
          break;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }

  // 按 url 去重并截断
  const seen = new Set();
  const unique = [];
  for (const source of sources) {
    const key = source.url.replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
    if (unique.length >= config.maxResults) break;
  }
  return { sources: unique, attempts, timedOut };
}

/** 错误名，别把整段 message 带进日志。 */
function errorName(err) {
  if (err === null || err === undefined) return 'unknown';
  if (err.name === 'TimeoutError') return 'timeout';
  if (err.name === 'AbortError') return 'aborted';
  return err.name || 'error';
}

/** 查询词长度上限。搜索引擎对超长 query 要么回 414，要么干脆给 0 条。 */
export const MAX_QUERY_CHARS = 200;

/**
 * 清洗查询词：去首尾空白 + 截断超长。
 * @param {unknown} raw 调用方给的 query
 * @returns {string} 可直接塞进 URL 的查询词，空串表示没有有效查询
 */
export function normalizeQuery(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_QUERY_CHARS);
}

// ---------------------------------------------------------------------------
// Provider + Cordis 插件
// ---------------------------------------------------------------------------

/** 注册进 `ctx.web` 的搜索提供方。 */
export class LocalSearchProvider {
  /** 注册表键；`searchProvider: local-search` 就是指向它。 */
  id = 'local-search';

  /**
   * @param {() => object} resolveConfig 每次搜索现算配置（设置变更后无需重注册）
   */
  constructor(resolveConfig) {
    this.resolveConfig = resolveConfig;
  }

  /** 不需要任何凭据或端点，永远可用。 */
  available() {
    return true;
  }

  /**
   * 跑一次搜索。
   * @param {{query: string, maxResults?: number}} request
   * @param {AbortSignal} [signal] DSH 的取消/超时信号
   * @returns {Promise<{sources: object[], truncated: boolean}>}
   */
  async search(request, signal) {
    const config = this.resolveConfig();
    // 调用方在进来之前就已经取消（例如工具预算已耗尽）：立刻返回，不要再打网络
    if (signal?.aborted === true) return { sources: [], truncated: false };
    const query = normalizeQuery(request?.query);
    if (query === '') return { sources: [], truncated: false };
    // 尊重调用方给的条数上限，但不超过自己的配置
    const wanted = Number.isInteger(request?.maxResults) && request.maxResults > 0 ? request.maxResults : config.maxResults;
    const limit = Math.min(wanted, config.maxResults);

    const startedAt = Date.now();
    const outcome = await runSearch(query, { ...config, maxResults: limit }, signal);
    const ms = Date.now() - startedAt;
    if (config.log) {
      // 只记查询、耗时、条数、命中的后端；没有任何凭据可泄
      console.log(
        `[web-search-local] query=${JSON.stringify(query)} sources=${outcome.sources.length} ` +
          `backend=${config.backend} attempts=[${outcome.attempts.join(',')}] ms=${ms}` +
          (outcome.timedOut ? ' timedOut=true' : ''),
      );
    }
    // 注意：不设 content，让 web_search 工具自己拼 markdown 来源列表
    return { sources: outcome.sources, truncated: false };
  }
}

/** Cordis 插件名（诊断用）。 */
export const name = 'web-search-local';

/** 硬依赖 web 接缝服务。 */
export const inject = ['web'];

/**
 * 挂载插件：向 `ctx.web` 注册本地搜索 provider。
 * @param {object} ctx Cordis 上下文
 * @param {object} [config] 行配置（cordis.patch.yml 里的 config）
 */
export function apply(ctx, config) {
  const current = config === undefined ? {} : config;
  const provider = new LocalSearchProvider(() => normalizeConfig(current));
  ctx.web.registerSearchProvider(provider);
}

export default { name, inject, apply, LocalSearchProvider, resolveChain, runSearch, normalizeQuery, MAX_QUERY_CHARS };
