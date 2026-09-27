#!/usr/bin/env node
// `browser/` 的唯一命令行入口。
//
// 为什么只有一个入口：浏览器自动化最容易腐化的地方是「每个任务现写一个 CDP 脚本」——
// 旧形态在本机攒了 130+ 个一次性脚本，端口、profile、定位方式各不相同，登录态也就跟着丢。
// 这里把**可变的部分**收敛成参数，把**不可变的部分**收敛成默认行为：
//   · 规范 profile 固定在 `<DSH_HOME>/browser-profile`（不随工作区漂移）
//   · 实例活着就**复用**，绝不为了「干净」重启（重启会丢会话态、逼用户重新登录）
//   · 只断开 CDP 不关浏览器；要关必须显式 `close`（那才是让登录态落盘的动作）
//
// 退出码：0 = 成功；1 = 运行期错误（浏览器没起来 / 端口不通 / 页面内抛错）；2 = 用法错误。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_PORT,
  chromeCandidates,
  dshHome,
  findChrome,
  planLaunch,
  resolvePort,
  resolveProfile,
} from './lib/target.mjs';
import * as cdp from './lib/cdp.mjs';

const USAGE = `用法：node cli.mjs <命令> [选项]

命令：
  launch     开一个有头窗口（实例已存活则直接复用，不重启）
  status     报端口是否活着、浏览器版本、当前标签页
  profile    报解析出来的 profile / 端口 / Chrome 路径（排错用）
  open <url> 新开一个标签页
  text       读当前页的标题 / 地址 / 可见文本
  eval       在页面里求值（--js "<表达式>" 或 --file <脚本路径>）
  shot       截图（--out <png 路径> [--full]）
  close      优雅关闭浏览器（登录态落盘的唯一可靠动作）

通用选项：
  --port <n>       调试端口（默认 ${DEFAULT_PORT}，或环境变量 ADG_BROWSER_PORT）
  --profile <dir>  profile 目录（默认 <DSH_HOME>/browser-profile，或 ADG_BROWSER_PROFILE）
  --url <u>        launch/open 可重复；text/eval/shot 用来指定操作哪一页
  --match <子串>   按 url / title 子串选页
  --tab <n>        按序号选页（0 起）
  --out <file>     text 写正文到文件；shot 指定 png 路径
  --wait <秒>      launch 等待端口起来的秒数（默认 30）
  --full           shot 截整页

例：
  node cli.mjs launch --url "https://example.com/login"
  node cli.mjs text --match example.com --out "$env:TEMP\\page.txt"
  node cli.mjs eval --file .\\probe.js --match example.com
  node cli.mjs close
`;

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { _: [], urls: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') {
      const v = argv[i + 1];
      if (v === undefined) throw new UsageError('--url 后面缺少值');
      out.urls.push(v);
      i += 1;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 2) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
      continue;
    }
    out._.push(a);
  }
  return out;
}

const print = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requireAlive(port) {
  if (!(await cdp.isAlive(port, { timeoutMs: 2500 }))) {
    throw new Error(`端口 ${port} 上没有运行中的浏览器；先跑 node cli.mjs launch`);
  }
}

async function printTabs(port) {
  const picked = cdp.pickPage(await cdp.listTargets(port), {});
  print(`TABS=${picked.pages.length}`);
  picked.pages.forEach((t, i) => print(`TAB ${i} | ${t.title ?? ''} | ${t.url ?? ''}`));
}

/** 已经有同地址的标签就复用，没有才新开——避免每次操作都堆一个重复标签页。 */
async function ensureOpen(port, url) {
  const targets = await cdp.listTargets(port).catch(() => []);
  const hit = (Array.isArray(targets) ? targets : []).find(
    (t) => t.type === 'page' && String(t.url ?? '') === url,
  );
  if (hit) {
    print(`TAB_EXISTS=${url}`);
    return;
  }
  await cdp.createTarget(port, url);
  print(`TAB_OPENED=${url}`);
  await sleep(600);
}

/** 解析出 text / eval / shot 要操作的那一页：--url 精确命中则复用，否则新开。 */
async function sessionFor(port, args) {
  const url = args.urls[0];
  let opts = { index: args.tab === undefined ? undefined : Number(args.tab), match: args.match };
  if (url) {
    const targets = await cdp.listTargets(port).catch(() => []);
    const hit = (Array.isArray(targets) ? targets : []).find(
      (t) => t.type === 'page' && String(t.url ?? '') === url,
    );
    opts = hit ? { match: hit.url } : { newUrl: url };
  }
  return cdp.pageSession(port, opts);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || args.help) {
    print(USAGE);
    return;
  }

  const port = resolvePort({ port: args.port });
  const profile = resolveProfile({ profile: args.profile });

  if (cmd === 'profile') {
    const chrome = findChrome();
    print(`DSH_HOME=${dshHome()}`);
    print(`PROFILE=${profile}`);
    print(`PROFILE_EXISTS=${fs.existsSync(profile)}`);
    print(`PORT=${port}`);
    print(`CHROME=${chrome ?? 'NOT_FOUND'}`);
    const legacy = path.resolve(process.cwd(), '.browser-profile');
    if (legacy !== path.resolve(profile) && !fs.existsSync(profile) && fs.existsSync(legacy)) {
      print(`HINT=本工作区里有旧 profile：${legacy}；想沿用它就加 --profile "${legacy}"（不要复制）`);
    }
    return;
  }

  if (cmd === 'launch') {
    const urls = args.urls.slice();
    const waitSec = Number(args.wait ?? 30);
    if (!Number.isFinite(waitSec) || waitSec <= 0) throw new UsageError('--wait 必须是正数秒');
    const alive = await cdp.isAlive(port, { timeoutMs: 2500 });
    const chrome = findChrome();
    const plan = planLaunch({ alive, chrome, profile, port, urls });

    if (plan.action === 'error') {
      throw new Error(
        `没找到可用的 Chrome / Edge。候选：${chromeCandidates().join(' | ')}；可用 ADG_CHROME 指定绝对路径`,
      );
    }

    if (plan.action === 'reuse') {
      print('STATE=REUSED');
      print(`PORT=${port}`);
      print(`PROFILE=${profile}`);
      print(`BROWSER=${(await cdp.version(port).catch(() => ({}))).Browser ?? 'unknown'}`);
      for (const u of urls) await ensureOpen(port, u);
      await printTabs(port);
      print('HINT=复用了既有实例；登录态在它内存与这个 profile 里，不要重启它');
      return;
    }

    fs.mkdirSync(profile, { recursive: true });
    const child = spawn(plan.chrome, plan.args, { detached: true, stdio: 'ignore' });
    let spawnError = null;
    child.on('error', (e) => {
      spawnError = e;
    });
    child.unref();

    const deadline = Date.now() + Math.max(1, waitSec) * 1000;
    let up = false;
    while (Date.now() < deadline) {
      if (spawnError) throw new Error(`启动浏览器失败：${spawnError.message}`);
      up = await cdp.isAlive(port, { timeoutMs: 2000 });
      if (up) break;
      await sleep(700);
    }
    if (!up) {
      throw new Error(`启动后 ${waitSec}s 内 127.0.0.1:${port} 没有起来（CHROME=${plan.chrome} PROFILE=${profile}）`);
    }

    print('STATE=STARTED');
    print(`CHROME=${plan.chrome}`);
    print(`PORT=${port}`);
    print(`PROFILE=${profile}`);
    print(`BROWSER=${(await cdp.version(port).catch(() => ({}))).Browser ?? 'unknown'}`);
    await printTabs(port);
    print('HINT=这是有头窗口，用户可以直接在里面登录 / 过验证；不要关掉它');
    return;
  }

  if (cmd === 'status') {
    const alive = await cdp.isAlive(port, { timeoutMs: 2500 });
    print(`ALIVE=${alive}`);
    print(`PORT=${port}`);
    print(`PROFILE=${profile}`);
    if (!alive) {
      print('HINT=浏览器没在跑；用 node cli.mjs launch 开一个有头窗口');
      return;
    }
    print(`BROWSER=${(await cdp.version(port).catch(() => ({}))).Browser ?? 'unknown'}`);
    await printTabs(port);
    return;
  }

  if (cmd === 'open') {
    const url = args._[1] ?? args.urls[0];
    if (!url) throw new UsageError('open 需要 URL：node cli.mjs open <url>');
    await requireAlive(port);
    await ensureOpen(port, url);
    await printTabs(port);
    return;
  }

  if (cmd === 'close') {
    if (!(await cdp.isAlive(port, { timeoutMs: 2500 }))) {
      print('ALIVE=false');
      print('CLOSED=already');
      return;
    }
    await cdp.closeBrowser(port);
    for (let i = 0; i < 20; i += 1) {
      if (!(await cdp.isAlive(port, { timeoutMs: 1500 }))) break;
      await sleep(500);
    }
    print(`ALIVE=${await cdp.isAlive(port, { timeoutMs: 1500 })}`);
    print('CLOSED=true');
    print(`HINT=优雅关闭，登录态已落盘到 ${profile}；下次 launch 会带着它回来`);
    return;
  }

  if (cmd === 'text') {
    await requireAlive(port);
    const session = await sessionFor(port, args);
    try {
      const t = await session.text();
      const body = String(t.body ?? '');
      print(`TITLE=${t.title ?? ''}`);
      print(`URL=${t.url ?? ''}`);
      print(`BYTES=${Buffer.byteLength(body, 'utf8')}`);
      if (args.out) {
        const abs = path.resolve(String(args.out));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body, 'utf8');
        print(`OUT=${abs}`);
      } else {
        print('---BODY---');
        process.stdout.write(`${body}\n`);
      }
    } finally {
      session.close();
    }
    return;
  }

  if (cmd === 'eval') {
    await requireAlive(port);
    let expr = args.js;
    if (args.file) expr = fs.readFileSync(path.resolve(String(args.file)), 'utf8');
    if (typeof expr !== 'string' || expr.trim() === '') {
      throw new UsageError('eval 需要 --js "<表达式>" 或 --file <脚本路径>');
    }
    const session = await sessionFor(port, args);
    try {
      const value = await session.evalJs(expr);
      print(`RESULT=${value === undefined ? 'undefined' : JSON.stringify(value, null, 2)}`);
    } finally {
      session.close();
    }
    return;
  }

  if (cmd === 'shot') {
    await requireAlive(port);
    if (!args.out) throw new UsageError('shot 需要 --out <png 路径>');
    const session = await sessionFor(port, args);
    try {
      const abs = await session.shot(String(args.out), { full: Boolean(args.full) });
      print(`SHOT=${abs}`);
      const t = await session.text().catch(() => ({}));
      print(`URL=${t.url ?? ''}`);
    } finally {
      session.close();
    }
    return;
  }

  throw new UsageError(`不认识命令：${cmd}`);
}

main().catch((err) => {
  if (err instanceof UsageError) {
    process.stderr.write(`ERROR=${err.message}\n\n${USAGE}\n`);
    process.exit(2);
  }
  process.stderr.write(`ERROR=${err?.message ?? String(err)}\n`);
  process.exit(1);
});