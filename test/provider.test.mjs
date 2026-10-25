// 插件自测：node --test test/
// 一半是纯逻辑（降级链、注册、截止时间），一半是真联网（真的去 Bing 搜）。
import test from 'node:test';
import assert from 'node:assert/strict';
import plugin, { LocalSearchProvider, resolveChain, apply, name, inject, normalizeQuery, MAX_QUERY_CHARS, stripIntent, buildVariants, longestCommonSubstring, relevanceOf, chooseGroup } from '../index.js';

// 真联网的用例带 SKIP_LIVE=1 就跳过（CI 的 unit job 用它，保证离线必过）
const LIVE = { skip: process.env.SKIP_LIVE === '1' ? 'SKIP_LIVE=1（离线模式）' : false };

/** 造一个只装了 web 接缝的假 ctx。 */
function fakeCtx() {
  const registered = [];
  return {
    registered,
    ctx: {
      web: {
        registerSearchProvider(provider) {
          registered.push(provider);
          return () => {};
        },
      },
      get() {
        return undefined;
      },
    },
  };
}

test('插件身份：name / inject / apply 形状正确', () => {
  assert.equal(name, 'web-search-local');
  assert.deepEqual(inject, ['web']);
  assert.equal(typeof apply, 'function');
  assert.equal(typeof plugin.apply, 'function');
});

test('apply() 会向 ctx.web 注册 provider', () => {
  const { ctx, registered } = fakeCtx();
  apply(ctx, { backend: 'bing' });
  assert.equal(registered.length, 1);
  assert.equal(registered[0].id, 'local-search');
  assert.equal(registered[0].available(), true);
});

test('降级链解析', () => {
  assert.deepEqual(resolveChain('auto'), ['bing', 'so360', 'searxng']);
  assert.deepEqual(resolveChain('BING'), ['bing']);
  assert.deepEqual(resolveChain('bing,so360'), ['bing', 'so360']);
  // 不认识的名字要忽略；全不认识就退回 bing，绝不返回空链
  assert.deepEqual(resolveChain('nope'), ['bing']);
  assert.deepEqual(resolveChain('nope,bing'), ['bing']);
  assert.deepEqual(resolveChain(undefined), ['bing', 'so360', 'searxng']);
});

test('空查询直接返回空结果，不打网络', async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'auto', maxResults: 8, deadlineMs: 5000, backendTimeoutMs: 3000, searxngUrl: '', userAgent: 'x', log: false }));
  assert.deepEqual(await provider.search({ query: '   ' }), { sources: [], truncated: false });
});

test('到内部截止时间就返回（不挂住）', async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'bing', maxResults: 8, deadlineMs: 1, backendTimeoutMs: 3000, searxngUrl: '', userAgent: 'x', log: false }));
  const started = Date.now();
  const result = await provider.search({ query: 'DeepSeek' });
  const elapsed = Date.now() - started;
  assert.deepEqual(result.sources, []);
  assert.ok(elapsed < 2000, `应该立刻返回，实际 ${elapsed}ms`);
});

test('后端不可用（searxng 未配置）时返回空结果而不是抛错', async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'searxng', maxResults: 8, deadlineMs: 5000, backendTimeoutMs: 3000, searxngUrl: '', userAgent: 'x', log: false }));
  const result = await provider.search({ query: 'DeepSeek' });
  assert.deepEqual(result.sources, []);
});

test('真联网：能搜到真实结果，且形状合规', LIVE, async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'auto', maxResults: 8, deadlineMs: 20000, backendTimeoutMs: 8000, searxngUrl: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', log: false }));
  const result = await provider.search({ query: 'DeepSeek 是什么' });
  assert.ok(result.sources.length > 0, '应该搜到结果（若失败先跑 node probe.mjs 看网络）');
  assert.ok(result.sources.length <= 8);
  assert.equal(result.truncated, false);
  for (const source of result.sources) {
    assert.match(source.url, /^https?:\/\//, `url 必须是绝对地址: ${source.url}`);
    if (source.title !== undefined) assert.equal(typeof source.title, 'string');
    if (source.snippet !== undefined) assert.equal(typeof source.snippet, 'string');
    if (source.publishedAt !== undefined) assert.match(source.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
  // 按 url 去重
  const urls = result.sources.map((s) => s.url);
  assert.equal(new Set(urls).size, urls.length, 'url 不许重复');
  console.log('    真实结果示例:', result.sources.slice(0, 3).map((s) => `${s.title} | ${s.url}`));
});

test('request.maxResults 会被尊重', LIVE, async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'bing', maxResults: 8, deadlineMs: 20000, backendTimeoutMs: 8000, searxngUrl: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', log: false }));
  const result = await provider.search({ query: '南京航空航天大学', maxResults: 3 });
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.length <= 3, `最多 3 条，实际 ${result.sources.length}`);
});

test('查询保真：不同查询拿到不同结果', LIVE, async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'bing', maxResults: 5, deadlineMs: 20000, backendTimeoutMs: 8000, searxngUrl: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', log: false }));
  const [a, b] = await Promise.all([
    provider.search({ query: 'Python asyncio 教程' }),
    provider.search({ query: 'Rust 所有权 borrow checker' }),
  ]);
  assert.ok(a.sources.length > 0 && b.sources.length > 0);
  assert.notEqual(a.sources[0].url, b.sources[0].url, '两个不同查询不该返回同一条首结果');
});

test('调用方取消信号能打断搜索', async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'bing', maxResults: 8, deadlineMs: 20000, backendTimeoutMs: 8000, searxngUrl: '', userAgent: 'x', log: false }));
  const ctl = new AbortController();
  const pending = provider.search({ query: 'DeepSeek' }, ctl.signal);
  ctl.abort(); // 立刻取消
  const result = await pending;
  assert.deepEqual(result.sources, []);
});

test('进来时 signal 已取消：立刻返回，不打网络', async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'bing', maxResults: 8, deadlineMs: 20000, backendTimeoutMs: 8000, searxngUrl: '', userAgent: 'x', log: false }));
  const ctl = new AbortController();
  ctl.abort(); // 调用前就取消
  const started = Date.now();
  const result = await provider.search({ query: 'DeepSeek' }, ctl.signal);
  const elapsed = Date.now() - started;
  assert.deepEqual(result.sources, []);
  assert.ok(elapsed < 50, `不该发起网络请求，实际耗时 ${elapsed}ms`);
});

test('normalizeQuery：截断超长、去空白、非字符串给空', () => {
  assert.equal(normalizeQuery('  DeepSeek  '), 'DeepSeek');
  assert.equal(normalizeQuery('   '), '');
  assert.equal(normalizeQuery(undefined), '');
  assert.equal(normalizeQuery(123), '');
  const long = '超长查询测试'.repeat(300);
  assert.equal(normalizeQuery(long).length, MAX_QUERY_CHARS);
  assert.ok(MAX_QUERY_CHARS <= 300, '上限必须落在搜索引擎能接受的范围');
});

test('超长查询不会再搜不到（会被截断到上限内）', LIVE, async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'bing', maxResults: 5, deadlineMs: 15000, backendTimeoutMs: 8000, searxngUrl: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', log: false }));
  const long = 'DeepSeek 是什么'.repeat(200); // 远超上限
  const result = await provider.search({ query: long });
  assert.ok(result.sources.length > 0, '截断后仍应能搜到结果');
});

test('stripIntent：剥掉尾部意图词，得到实体短语', () => {
  assert.equal(stripIntent('南航图书馆 开放时间'), '南航图书馆');
  assert.equal(stripIntent('南京航空航天大学图书馆 预约座位'), '南京航空航天大学图书馆');
  assert.equal(stripIntent('南京航空航天大学 图书馆 怎么预约座位'), '南京航空航天大学 图书馆');
  assert.equal(stripIntent('DeepSeek 是什么'), 'DeepSeek');
  // 只从尾部剥，不误伤词中的字
  assert.equal(stripIntent('时间简史'), '时间简史');
  assert.equal(stripIntent(''), '');
});

test('buildVariants：只有剥出实体短语时才多查一次', () => {
  assert.deepEqual(buildVariants('南航图书馆 开放时间'), ['南航图书馆 开放时间', '南航图书馆']);
  assert.deepEqual(buildVariants('DeepSeek'), ['DeepSeek']);
  assert.deepEqual(buildVariants('南航图书馆 开放时间', false), ['南航图书馆 开放时间']);
  assert.deepEqual(buildVariants('   '), []);
});

test('相关性选组：选更相关的那组，接近时保留原文组', () => {
  assert.equal(longestCommonSubstring('南航图书馆', '南京航空航天大学图书馆'), 3);
  const bad = [{ url: 'https://www.csair.com/cn/', title: '中国南方航空官网' }];
  const good = [{ url: 'https://lib.nuaa.edu.cn/', title: '南京航空航天大学图书馆' }];
  assert.ok(relevanceOf(good, '南航图书馆') > relevanceOf(bad, '南航图书馆'));
  assert.deepEqual(chooseGroup([bad, good], '南航图书馆'), good);
  const a = [{ url: 'https://www.deepseek.com/', title: 'DeepSeek' }];
  const b = [{ url: 'https://deepseek.com.cn/', title: 'DeepSeek 官网' }];
  assert.deepEqual(chooseGroup([a, b], 'DeepSeek'), a, '相关性接近时应保留原文组');
  assert.deepEqual(chooseGroup([null, []], 'x'), []);
});

test('真联网：长尾中文查询也能命中学校官网', LIVE, async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'bing', maxResults: 8, deadlineMs: 15000, backendTimeoutMs: 8000, searxngUrl: '', stripIntent: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', log: false }));
  const result = await provider.search({ query: '南航图书馆 开放时间' });
  const hit = result.sources.filter((s) => /nuaa\.edu\.cn/.test(s.url)).length;
  assert.ok(hit >= 3, `应至少 3 条命中 nuaa.edu.cn，实际 ${hit} 条`);
  console.log('    命中官网的结果:', result.sources.filter((s) => /nuaa\.edu\.cn/.test(s.url)).slice(0, 3).map((s) => s.url));
});
