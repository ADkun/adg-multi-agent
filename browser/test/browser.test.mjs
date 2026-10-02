// `browser/` 的不变量用例（编号与 design.md 的 I1..I11 一一对应）。
//
// 全部零依赖、零副作用：不 spawn 浏览器、不联网、不读写 profile。
// CDP 客户端用「可注入的假 socket」测，所以协议行为（id 关联 / 错误映射 / 事件丢弃 / 关闭后拒绝）
// 能在没有浏览器的机器上被钉住。
//
// 跑法：  cd browser && node --test test
// DSH 沙箱（workspace-write）里加 --test-isolation=none，见 testing-guide.md。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  chromeCandidates,
  detectMode,
  dshHome,
  findChrome,
  launchArgs,
  planLaunch,
  resolveMode,
  resolvePort,
  resolveProfile,
  MODE_DEFAULT,
  PROFILE_DIRNAME,
} from '../lib/target.mjs';
import { assertRuntime, connect, pickPage, pickTabsToClose } from '../lib/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, '..', 'lib');

// ---------- 假 socket：模拟 WebSocket 的最小事件/发送面 ----------

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    this.listeners = new Map();
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  emit(type, ev) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  send(str) {
    this.sent.push(JSON.parse(str));
  }

  close() {
    this.closed = true;
  }

  reply(msg) {
    this.emit('message', { data: JSON.stringify(msg) });
  }
}

/** 真 WebSocket 的 open 是异步的，假 socket 也必须异步，否则 connect 会漏掉事件。 */
function fakeFactory(sockets) {
  return (url) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    queueMicrotask(() => s.emit('open', {}));
    return s;
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------- I1：profile 解析确定性 ----------

test('I1 默认 profile 固定在 <DSH_HOME>/browser-profile', () => {
  const p = resolveProfile({ env: { DSH_HOME: 'C:\\Users\\x\\.dsh' }, cwd: 'D:\\somewhere\\else' });
  assert.equal(p, path.resolve('C:\\Users\\x\\.dsh', PROFILE_DIRNAME));
});

test('I1 没有 DSH_HOME 时回落成 <home>/.dsh/browser-profile', () => {
  const p = resolveProfile({ env: {}, home: path.join('C:', 'Users', 'x') });
  assert.equal(p, path.join('C:', 'Users', 'x', '.dsh', PROFILE_DIRNAME));
});

test('I1 profile 与工作区无关：换 cwd 不改变默认结果', () => {
  const env = { DSH_HOME: 'C:\\Users\\x\\.dsh' };
  const a = resolveProfile({ env, cwd: 'D:\\ws-one' });
  const b = resolveProfile({ env, cwd: 'D:\\ws-two\\deep' });
  assert.equal(a, b);
});

test('I1 显式 --profile 优先于 ADG_BROWSER_PROFILE 与默认值', () => {
  const env = { DSH_HOME: 'C:\\Users\\x\\.dsh', ADG_BROWSER_PROFILE: 'D:\\from-env' };
  assert.equal(resolveProfile({ profile: 'D:\\explicit', env, cwd: 'D:\\ws' }), path.resolve('D:\\explicit'));
  assert.equal(resolveProfile({ env, cwd: 'D:\\ws' }), path.resolve('D:\\from-env'));
  assert.equal(resolveProfile({ profile: 'rel', env, cwd: 'D:\\ws' }), path.resolve('D:\\ws', 'rel'));
});

test('I1 dshHome 优先 DSH_HOME，缺省 ~/.dsh', () => {
  assert.equal(dshHome({ DSH_HOME: 'D:\\dsh-home' }, 'C:\\Users\\x'), path.resolve('D:\\dsh-home'));
  assert.equal(dshHome({}, path.join('C:', 'Users', 'x')), path.join('C:', 'Users', 'x', '.dsh'));
});

// ---------- I2：启动参数不含伪装 / 降权旗标 ----------

const FORBIDDEN_FLAGS = ['--no-sandbox', '--disable-blink-features', '--user-agent', '--disable-web-security'];

test('I2 启动参数必须带 user-data-dir 与 remote-debugging-port', () => {
  const args = launchArgs({ profile: 'D:\\p', port: 9333, urls: ['https://example.com'] });
  assert.ok(args.some((a) => a.startsWith('--user-data-dir=')));
  assert.ok(args.some((a) => a === '--remote-debugging-port=9333'));
  assert.equal(args[args.length - 1], 'https://example.com');
});

test('I2 启动参数禁止出现伪装 / 降权旗标', () => {
  const args = launchArgs({ profile: 'D:\\p', port: 9333, urls: [] });
  for (const flag of FORBIDDEN_FLAGS) {
    assert.ok(
      !args.some((a) => a.startsWith(flag)),
      `启动参数里不该出现 ${flag}（旧形态 D:\\dsh\\.browser-tools\\start-chrome-headed.ps1 的反例）`,
    );
  }
});

// ---------- I3：同模式复用；换模式是显式的，且必须先关后开 ----------

test('I3 实例活着且模式相同 → reuse，且不产生启动参数', () => {
  const plan = planLaunch({ alive: true, aliveMode: 'headless', chrome: 'D:\\chrome.exe', profile: 'D:\\p', port: 9333 });
  assert.equal(plan.action, 'reuse');
  assert.equal(plan.args, undefined);
  assert.equal(plan.aliveMode, 'headless');
});

test('I3 活着的实例模式未知 → 也 reuse（不认识的活实例不许被静默换掉）', () => {
  const plan = planLaunch({ alive: true, aliveMode: 'unknown', chrome: 'D:\\chrome.exe', profile: 'D:\\p', port: 9333 });
  assert.equal(plan.action, 'reuse');
  assert.equal(plan.modeUnverified, true);
  assert.equal(plan.args, undefined);
});

test('I3 活着的实例是另一种模式 → switch，且必须带上**目标模式**的启动参数', () => {
  const plan = planLaunch({
    alive: true,
    aliveMode: 'headless',
    chrome: 'D:\\chrome.exe',
    profile: 'D:\\p',
    port: 9333,
    mode: 'headed',
  });
  assert.equal(plan.action, 'switch');
  assert.equal(plan.aliveMode, 'headless');
  // 2026-10-03 事故的回归锁：switch 曾经不带 args，于是调用方 spawn(chrome, undefined)
  // 用**空参数**启动了浏览器 —— 那是用户自己的默认 profile，请求被转交给用户日常那个实例。
  assert.ok(Array.isArray(plan.args), 'switch 必须给 args');
  assert.ok(!plan.args.includes('--headless=new'), '目标是 headed，不该再带无头旗标');
  assert.ok(plan.args.includes('--user-data-dir=D:\\p'));
  assert.ok(plan.args.includes('--remote-debugging-port=9333'));
});

test('I3 活着的是另一种模式但没有可用浏览器 → error（不退化成空参数启动）', () => {
  const plan = planLaunch({
    alive: true,
    aliveMode: 'headless',
    chrome: null,
    profile: 'D:\\p',
    port: 9333,
    mode: 'headed',
  });
  assert.equal(plan.action, 'error');
  assert.equal(plan.reason, 'CHROME_NOT_FOUND');
});

test('I11 没显式要求模式 → 活着的有头实例**不动它**（modeNotRequested）', () => {
  const plan = planLaunch({
    alive: true,
    aliveMode: 'headed',
    chrome: 'D:\\chrome.exe',
    profile: 'D:\\p',
    port: 9333,
    env: {},
  });
  assert.equal(plan.action, 'reuse');
  assert.equal(plan.modeNotRequested, true);
  assert.equal(plan.args, undefined, '复用路径不许产生启动参数');
});

test('I11 只有显式要求（旗标 / ADG_BROWSER_MODE）才允许换掉活着的实例', () => {
  const aliveBase = { alive: true, aliveMode: 'headed', chrome: 'D:\\chrome.exe', profile: 'D:\\p', port: 9333 };
  assert.equal(planLaunch({ ...aliveBase, mode: 'headless', modeExplicit: true }).action, 'switch');
  assert.equal(planLaunch({ ...aliveBase, env: { ADG_BROWSER_MODE: 'headless' } }).action, 'switch');
  assert.equal(planLaunch({ ...aliveBase, env: {} }).action, 'reuse');
  assert.equal(planLaunch({ ...aliveBase, modeExplicit: false }).action, 'reuse');
});

test('I11 launch 在 spawn 前拒绝空 / 非数组启动参数（源码级断言）', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'cli.mjs'), 'utf8');
  const guard = src.indexOf('没有构造出启动参数');
  const spawnAt = src.indexOf('spawn(plan.chrome, plan.args');
  assert.ok(guard > 0, '找不到"拒绝空参数"的闸门');
  assert.ok(spawnAt > 0, '找不到 launch 的 spawn 调用');
  assert.ok(guard < spawnAt, '闸门必须排在 spawn 之前');
  assert.match(src, /Array\.isArray\(plan\.args\)/, '闸门要检查 args 是数组');
});

test('I3 实例不在且找到 Chrome → start', () => {
  const plan = planLaunch({ alive: false, chrome: 'D:\\chrome.exe', profile: 'D:\\p', port: 9333, urls: ['https://a'] });
  assert.equal(plan.action, 'start');
  assert.equal(plan.chrome, 'D:\\chrome.exe');
  assert.ok(plan.args.includes('https://a'));
});

test('I3 找不到浏览器 → error CHROME_NOT_FOUND（不静默换浏览器）', () => {
  const plan = planLaunch({ alive: false, chrome: null, profile: 'D:\\p', port: 9333 });
  assert.equal(plan.action, 'error');
  assert.equal(plan.reason, 'CHROME_NOT_FOUND');
});

// ---------- I11：默认无头；模式显式可选、也能从活实例读出 ----------

test('I11 默认模式是无头：不给 mode 时 launchArgs 带 --headless=new', () => {
  const args = launchArgs({ profile: 'D:\\p', port: 9333, urls: [] });
  assert.ok(args.includes('--headless=new'), '默认必须是无头（2026-10-03 用户拍板）');
  assert.equal(resolveMode({ env: {} }), 'headless');
  assert.equal(MODE_DEFAULT, 'headless');
});

test('I11 --headed 只去掉无头旗标，其余参数逐字相同', () => {
  const headless = launchArgs({ profile: 'D:\\p', port: 9333, urls: ['https://a'] });
  const headed = launchArgs({ profile: 'D:\\p', port: 9333, urls: ['https://a'], mode: 'headed' });
  assert.ok(headless.includes('--headless=new'));
  assert.ok(!headed.includes('--headless=new'));
  assert.deepEqual(
    headless.filter((a) => a !== '--headless=new'),
    headed,
  );
});

test('I11 模式优先级：显式 > ADG_BROWSER_MODE > 默认；非法值抛错不回落', () => {
  assert.equal(resolveMode({ mode: 'headed', env: { ADG_BROWSER_MODE: 'headless' } }), 'headed');
  assert.equal(resolveMode({ env: { ADG_BROWSER_MODE: 'HEADED' } }), 'headed');
  for (const bad of ['new', 'false', 'headless=false', '有头']) {
    assert.throws(() => resolveMode({ mode: bad, env: {} }), /浏览器模式不合法/, `mode=${bad} 应当抛错`);
  }
  assert.throws(() => resolveMode({ env: { ADG_BROWSER_MODE: 'garbage' } }), /浏览器模式不合法/);
});

test('I11 detectMode 从 User-Agent 读出模式（2026-10-03 三条真实读数）', () => {
  const braveHeadless = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36',
  };
  const edgeHeadless = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0',
  };
  const braveHeaded = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  };
  assert.equal(detectMode(braveHeadless), 'headless');
  assert.equal(detectMode(edgeHeadless), 'headless');
  assert.equal(detectMode(braveHeaded), 'headed');
});

test('I11 detectMode 拿不到 User-Agent 时报 unknown，不猜', () => {
  assert.equal(detectMode(null), 'unknown');
  assert.equal(detectMode({}), 'unknown');
  assert.equal(detectMode({ 'User-Agent': '' }), 'unknown');
  assert.equal(detectMode({ 'User-Agent': 42 }), 'unknown');
});

// ---------- I4：非法端口不静默回落 ----------

test('I4 非法端口一律抛错', () => {
  for (const bad of [0, -1, 70000, 'abc', 3.5, NaN]) {
    assert.throws(() => resolvePort({ port: bad }), /调试端口不合法/, `port=${String(bad)} 应当抛错`);
  }
});

test('I4 合法端口接受数字与数字串，并遵循优先级', () => {
  assert.equal(resolvePort({ port: 9333 }), 9333);
  assert.equal(resolvePort({ port: '9222' }), 9222);
  assert.equal(resolvePort({ env: { ADG_BROWSER_PORT: '9400' } }), 9400);
  assert.equal(resolvePort({ port: 1, env: { ADG_BROWSER_PORT: '9400' } }), 1);
});

// ---------- I5：页面选择确定性 ----------

const TARGETS = [
  { id: 'a', type: 'page', url: 'https://site/login', title: '登录', webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/a' },
  { id: 'b', type: 'page', url: 'https://site/home', title: '首页', webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/b' },
  { id: 'c', type: 'page', url: 'devtools://devtools/bundled/inspector.html', title: 'DevTools', webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/c' },
  { id: 'd', type: 'page', url: 'https://nohook', title: '没有调试端点' },
  { id: 'e', type: 'service_worker', url: 'https://sw', title: 'SW', webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/e' },
];

test('I5 只认有 ws 端点、非 devtools:// 的 page 目标', () => {
  const picked = pickPage(TARGETS, {});
  assert.deepEqual(picked.pages.map((t) => t.id), ['a', 'b']);
  assert.equal(picked.page.id, 'a');
});

test('I5 --match 命中 url 或 title；未命中必须报错而不是随便挑一页', () => {
  assert.equal(pickPage(TARGETS, { match: 'home' }).page.id, 'b');
  assert.equal(pickPage(TARGETS, { match: '登录' }).page.id, 'a');
  const miss = pickPage(TARGETS, { match: 'nope' });
  assert.equal(miss.page, null);
  assert.match(miss.reason, /没有 url \/ title 匹配/);
});

test('I5 --tab 越界与负数必须报错', () => {
  assert.equal(pickPage(TARGETS, { index: 1 }).page.id, 'b');
  assert.match(pickPage(TARGETS, { index: 2 }).reason, /越界/);
  assert.match(pickPage(TARGETS, { index: -1 }).reason, />= 0 的整数/);
  assert.match(pickPage(TARGETS, { index: 1.5 }).reason, />= 0 的整数/);
});

test('I5 刚创建的标签按 id 定位（站内跳转也能找回来）', () => {
  assert.equal(pickPage(TARGETS, { id: 'b' }).page.id, 'b');
  assert.match(pickPage(TARGETS, { id: 'zzz' }).reason, /没有出现在 \/json\/list/);
});

test('I5 空目标列表报「没有可用页面目标」', () => {
  const picked = pickPage([], {});
  assert.equal(picked.page, null);
  assert.match(picked.reason, /没有可用页面目标/);
  assert.equal(pickPage(null, {}).pages.length, 0);
});

// ---------- I6：零依赖 + Chrome 探测 ----------

test('I6 只允许 node: 内建与相对路径的 import（零依赖）', () => {
  for (const file of ['cdp.mjs', 'target.mjs']) {
    const src = fs.readFileSync(path.join(LIB, file), 'utf8');
    const specs = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    assert.ok(specs.length > 0, `${file} 应当有 import 语句（否则这条断言是空的）`);
    for (const spec of specs) {
      assert.ok(
        spec.startsWith('node:') || spec.startsWith('.'),
        `${file} 只允许 node: 内建与相对路径，禁止依赖 ${spec}`,
      );
    }
    assert.ok(!/require\(\s*['"][^'"]*(playwright|puppeteer)/i.test(src), `${file} 禁止 require playwright / puppeteer`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'browser/ 必须是零依赖，不许有 dependencies');
});

test('I6 本机 Node 满足运行时要求（>= 22 的全局 WebSocket）', () => {
  assert.doesNotThrow(() => assertRuntime());
});

test('I6 ADG_CHROME 永远排第一，win32 候选含 Chrome / Brave / Edge 且 Brave 在 Edge 前', () => {
  const cands = chromeCandidates({ ADG_CHROME: 'D:\\my-chrome.exe', PROGRAMFILES: 'C:\\Program Files' }, 'win32');
  assert.equal(cands[0], 'D:\\my-chrome.exe');
  const at = (parts) => cands.findIndex((p) => p.endsWith(path.join(...parts)));
  const chrome = at(['Google', 'Chrome', 'Application', 'chrome.exe']);
  const brave = at(['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']);
  const edge = at(['Microsoft', 'Edge', 'Application', 'msedge.exe']);
  assert.ok(chrome > 0, 'win32 候选里应当有 Chrome');
  assert.ok(brave > 0, 'win32 候选里应当有 Brave');
  assert.ok(edge > 0, 'win32 候选里应当有 Edge');
  assert.ok(
    brave < edge,
    'Brave 必须排在 Edge 前面：Edge 随 Windows 出厂就在，排前面会让"只装了别的浏览器"的人被迫用它',
  );
});

test('I6 只有 Brave 与 Edge 时选中 Brave（不静默换成系统自带的 Edge）', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' };
  const brave = path.join('C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe');
  const edge = path.join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  assert.equal(findChrome({ env, platform: 'win32', exists: (p) => p === brave || p === edge }), brave);
});

test('I6 findChrome 取第一个真实存在的候选；都没有则 null', () => {
  const env = { ADG_CHROME: 'D:\\a.exe', PROGRAMFILES: 'C:\\PF' };
  const first = findChrome({ env, platform: 'win32', exists: (p) => p === 'D:\\a.exe' });
  assert.equal(first, 'D:\\a.exe');
  const none = findChrome({ env, platform: 'win32', exists: () => false });
  assert.equal(none, null);
});

// ---------- I7：CDP 客户端协议行为 ----------

test('I7 id 关联：乱序返回也能各归各位', async () => {
  const sockets = [];
  const cdp = await connect('ws://fake', { socketFactory: fakeFactory(sockets) });
  const s = sockets[0];
  const p1 = cdp.send('A.one', {});
  const p2 = cdp.send('B.two', {});
  await tick();
  assert.deepEqual(
    s.sent.map((m) => [m.id, m.method]),
    [[1, 'A.one'], [2, 'B.two']],
  );
  s.reply({ id: 2, result: { who: 'two' } });
  s.reply({ id: 1, result: { who: 'one' } });
  assert.deepEqual(await p2, { who: 'two' });
  assert.deepEqual(await p1, { who: 'one' });
  cdp.close();
});

test('I7 错误映射成 Error，并带上方法名', async () => {
  const sockets = [];
  const cdp = await connect('ws://fake', { socketFactory: fakeFactory(sockets) });
  const p = cdp.send('Page.navigate', { url: 'https://x' });
  await tick();
  sockets[0].reply({ id: 1, error: { message: 'boom' } });
  await assert.rejects(p, /Page\.navigate: boom/);
  cdp.close();
});

test('I7 事件通知与未知 id 被忽略，不炸掉连接', async () => {
  const sockets = [];
  const cdp = await connect('ws://fake', { socketFactory: fakeFactory(sockets) });
  const p = cdp.send('Runtime.evaluate', {});
  await tick();
  sockets[0].reply({ method: 'Runtime.executionContextCreated', params: {} });
  sockets[0].reply({ id: 999, result: {} });
  sockets[0].emit('message', { data: 'not json' });
  sockets[0].emit('message', { data: new Uint8Array([1, 2, 3]) });
  sockets[0].reply({ id: 1, result: { ok: true } });
  assert.deepEqual(await p, { ok: true });
  cdp.close();
});

test('I7 关闭后 send 拒绝，在途请求也被拒绝', async () => {
  const sockets = [];
  const cdp = await connect('ws://fake', { socketFactory: fakeFactory(sockets) });
  const inflight = cdp.send('A.slow', {});
  await tick();
  cdp.close();
  await assert.rejects(inflight, /CDP 连接已关闭/);
  await assert.rejects(cdp.send('A.after', {}), /CDP 连接已关闭/);
  assert.equal(sockets[0].closed, true);
});

test('I7 连不上时报错，不静默返回半个客户端', async () => {
  const factory = (url) => {
    const s = new FakeSocket(url);
    queueMicrotask(() => s.emit('error', { message: 'ECONNREFUSED' }));
    return s;
  };
  await assert.rejects(connect('ws://nobody', { socketFactory: factory }), /连不上 CDP/);
});

// ---------- I8：只有 close 能关浏览器 ----------

test('I8 关浏览器只有一个入口：closeBrowser 发 Browser.close', () => {
  const src = fs.readFileSync(path.join(LIB, 'cdp.mjs'), 'utf8');
  const hits = src.match(/Browser\.close/g) ?? [];
  assert.equal(hits.length, 1, 'Browser.close 只允许出现在 closeBrowser 里');
  assert.match(src, /export async function closeBrowser/);
  // pageSession 的 close 只断连：它必须是 `cdp.close()`，不是 closeBrowser。
  assert.match(src, /close: \(\) => cdp\.close\(\)/);
  assert.match(src, /调用方负责 `close\(\)` —— 它只断开 CDP，\*\*不关浏览器\*\*/);
});

// ---------- I9：标签页清理（不猜、不关别人的、不关到 0 个） ----------

// 三个可驱动的页；`match: 'example'` 会一次命中全部三个 —— 用来验「不许关到 0 个」。
const TABS = [
  { id: 't0', type: 'page', url: 'https://a.example/1', title: '甲', webSocketDebuggerUrl: 'ws://x/0' },
  { id: 't1', type: 'page', url: 'https://a.example/2', title: '乙', webSocketDebuggerUrl: 'ws://x/1' },
  { id: 't2', type: 'page', url: 'https://b.example/login', title: '登录页', webSocketDebuggerUrl: 'ws://x/2' },
];

test('I9 --match 关掉所有匹配的页，没命中必须报错', () => {
  assert.deepEqual(pickTabsToClose(TABS, { match: 'a.example' }).targets.map((t) => t.id), ['t0', 't1']);
  assert.deepEqual(pickTabsToClose(TABS, { match: '登录页' }).targets.map((t) => t.id), ['t2']);
  assert.match(pickTabsToClose(TABS, { match: 'nope' }).reason, /没有 url \/ title 匹配/);
  assert.match(pickTabsToClose(TABS, { match: true }).reason, /缺少子串/);
  assert.match(pickTabsToClose(TABS, { match: '' }).reason, /缺少子串/);
});

test('I9 --tab 关且只关一个；越界、负数、缺值都必须报错', () => {
  assert.deepEqual(pickTabsToClose(TABS, { tab: '1' }).targets.map((t) => t.id), ['t1']);
  assert.match(pickTabsToClose(TABS, { tab: '9' }).reason, /越界/);
  assert.match(pickTabsToClose(TABS, { tab: '-1' }).reason, />= 0 的整数/);
  assert.match(pickTabsToClose(TABS, { tab: '1.5' }).reason, />= 0 的整数/);
  assert.match(pickTabsToClose(TABS, { tab: true }).reason, /缺少序号/);
});

test('I9 不给选择器就不关：不猜要关哪个', () => {
  assert.match(pickTabsToClose(TABS, {}).reason, /不猜要关哪个/);
});

test('I9 拒绝关到 0 个页面（那等于关浏览器，绕过 close）', () => {
  // 全部三个都匹配 -> 一个都不许关
  assert.match(pickTabsToClose(TABS, { match: 'example' }).reason, /剩 0 个页面/);
  // 只剩一个页面时，关它同样被拒
  assert.match(pickTabsToClose([TABS[0]], { tab: '0' }).reason, /剩 0 个页面/);
  assert.match(pickTabsToClose([TABS[0]], { match: 'a.example' }).reason, /剩 0 个页面/);
  // 两个页面里关一个：允许
  assert.equal(pickTabsToClose(TABS.slice(0, 2), { tab: '0' }).targets.length, 1);
});

test('I9 关标签页只走 Target.closeTarget，且 closeBrowser 仍是唯一的 Browser.close', () => {
  const src = fs.readFileSync(path.join(LIB, 'cdp.mjs'), 'utf8');
  assert.equal((src.match(/Browser\.close/g) ?? []).length, 1);
  assert.equal((src.match(/Target\.closeTarget/g) ?? []).length, 1);
  assert.match(src, /export async function closeTarget\(/);
});

// ---------- I10：一次性读取不留标签页 ----------

test('I10 pageSession 标出「这一页是不是本命令自己开的」', () => {
  const src = fs.readFileSync(path.join(LIB, 'cdp.mjs'), 'utf8');
  assert.match(src, /let created = false/);
  assert.match(src, /created = true/, 'newUrl 分支必须把它标成 created');
  assert.match(src, /tabs: picked\.pages,\s*created,/, 'created 必须随会话一起返回');
});

test('I10 读取命令的收尾只关自己开的页，且受 --keep 控制', () => {
  const cli = fs.readFileSync(path.join(HERE, '..', 'cli.mjs'), 'utf8');
  assert.match(cli, /async function closeTempTab\(port, created, session, keep\)/);
  assert.match(cli, /if \(!created \|\| keep \|\| !id\) return/, '别人开的页与 --keep 都必须放行');
  // text / eval / shot 三个读取命令都要走这个收尾 —— 漏一个就重新开始堆标签页。
  const calls = cli.match(/await closeTempTab\(port, created, session, args\.keep\)/g) ?? [];
  assert.equal(calls.length, 3, 'text / eval / shot 三个读取命令都要收掉自己开的临时标签');
  // 三个命令都必须把 created 取出来（只 destructure session 就丢了这条信息）。
  const destructured = cli.match(/const \{ session, created \} = await sessionFor\(/g) ?? [];
  assert.equal(destructured.length, 3, 'text / eval / shot 都要拿到 created');
});

test('I10 新建临时页先开空白标签、attach 后再导航等可读状态（不许抢跑）', () => {
  const src = fs.readFileSync(path.join(LIB, 'cdp.mjs'), 'utf8');
  assert.match(src, /createTarget\(port, 'about:blank', \{ socketFactory \}\)/, '必须用空白标签建页');
  assert.ok(!/await sleep\(600\)/.test(src), '不许再用固定 600ms 赌页面加载完（实测三站点读到 0 字节）');
  assert.match(src, /const state = await goto\(cdp, newUrl, timeoutMs\)/, '必须复用 goto 的等可读状态逻辑');
  assert.match(src, /if \(state\.timeout\)/, '等不到可读状态必须报错，不许把空正文当成功返回');
});

test('I10 初始导航失败也要收走自己开的临时页（失败路径同样「谁开的谁收」）', () => {
  const src = fs.readFileSync(path.join(LIB, 'cdp.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export async function pageSession'));
  assert.match(body, /\} catch \(e\) \{/, 'pageSession 必须有失败清理分支');
  assert.match(
    body,
    /if \(created\) await closeTarget\(port, picked\.page\.id, \{ socketFactory \}\)/,
    '失败时要关掉自己刚开的那个临时页',
  );
});