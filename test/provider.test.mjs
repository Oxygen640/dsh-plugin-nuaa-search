// 插件自测：node --test test/
// 一半是纯逻辑（降级链、注册、截止时间），一半是真联网（真的去 Bing 搜）。
import test from 'node:test';
import assert from 'node:assert/strict';
import plugin, { LocalSearchProvider, resolveChain, apply, name, inject } from '../index.js';

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

test('真联网：能搜到真实结果，且形状合规', async () => {
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

test('request.maxResults 会被尊重', async () => {
  const provider = new LocalSearchProvider(() => ({ backend: 'bing', maxResults: 8, deadlineMs: 20000, backendTimeoutMs: 8000, searxngUrl: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', log: false }));
  const result = await provider.search({ query: '南京航空航天大学', maxResults: 3 });
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.length <= 3, `最多 3 条，实际 ${result.sources.length}`);
});

test('查询保真：不同查询拿到不同结果', async () => {
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
