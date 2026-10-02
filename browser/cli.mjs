#!/usr/bin/env node
// `browser/` 的唯一命令行入口。
//
// 为什么只有一个入口：浏览器自动化最容易腐化的地方是「每个任务现写一个 CDP 脚本」——
// 旧形态在本机攒了 130+ 个一次性脚本，端口、profile、定位方式各不相同，登录态也就跟着丢。
// 这里把**可变的部分**收敛成参数，把**不可变的部分**收敛成默认行为：
//   · 规范 profile 固定在 `<DSH_HOME>/browser-profile`（不随工作区漂移）
//   · 默认**无头**（没有窗口、不抢焦点）；要人工介入才 `--headed` 开真窗口
//   · 实例活着就**复用**，绝不为了「干净」重启（重启会丢会话态、逼用户重新登录）；
//     唯一的例外是**显式要求**的换模式：调用方明说「要另一种模式」（`--headless` / `--headed` /
//     `ADG_BROWSER_MODE`）时，先 `closeBrowser`（优雅关、登录态落盘）再按目标模式起新的——
//     同一个 profile 同时只能有一个实例（第二个进程只会转发 URL 然后退 0）。**默认模式只决定
//     新起的实例长什么样**：不带旗标碰上活着的另一种模式实例，一律不动它。
//   · 只断开 CDP 不关浏览器；要关必须显式 `close`（那才是让登录态落盘的动作）
//
// 退出码：0 = 成功；1 = 运行期错误（浏览器没起来 / 端口不通 / 页面内抛错）；2 = 用法错误。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_PORT,
  chromeCandidates,
  detectMode,
  dshHome,
  findChrome,
  planLaunch,
  modeIsExplicit,
  resolveMode,
  resolvePort,
  resolveProfile,
} from './lib/target.mjs';
import * as cdp from './lib/cdp.mjs';

/** 换模式时等旧实例真的落下去的上限：`Browser.close` 一发就返回，进程还在退出时不能起新的。 */
const SWITCH_DOWN_WAIT_MS = 10000;

const USAGE = `用法：node cli.mjs <命令> [选项]

命令：
  launch     开浏览器（默认无头；实例活着就复用；**显式**要求另一种模式时才先优雅关掉再按目标模式重开）
  status     报端口是否活着、浏览器版本、模式、当前标签页
  tabs       只列标签页（序号 | 标题 | 地址）—— 清理前先看这个
  profile    报解析出来的 profile / 端口 / Chrome 路径 / 默认模式（排错用）
  open <url> 新开一个标签页（已有同地址则复用，不重复开）
  text       读当前页的标题 / 地址 / 可见文本
  eval       在页面里求值（--js "<表达式>" 或 --file <脚本路径>）
  shot       截图（--out <png 路径> [--full]）
  close-tab  关掉标签页：--match <子串> 关掉所有匹配的，--tab <n> 关那一个
  close      优雅关闭浏览器（登录态落盘的唯一可靠动作）

通用选项：
  --port <n>       调试端口（默认 ${DEFAULT_PORT}，或环境变量 ADG_BROWSER_PORT）
  --profile <dir>  profile 目录（默认 <DSH_HOME>/browser-profile，或 ADG_BROWSER_PROFILE）
  --headless       无头模式（**默认**）：没有窗口、不抢焦点，日常抓取与自动化用它
  --headed         有头模式：开一个真窗口，需要人工登录 / 过验证时才用
  --url <u>        launch/open 可重复；text/eval/shot 用来指定操作哪一页
  --match <子串>   按 url / title 子串选页；close-tab 用它关掉所有匹配的页
  --tab <n>        按序号选页（0 起）；close-tab 用它关那一个
  --out <file>     text 写正文到文件；shot 指定 png 路径
  --wait <秒>      launch 等待端口起来的秒数（默认 30）
  --full           shot 截整页
  --keep           text/eval/shot --url 为读新地址而开的**临时标签**默认读完就关，加这个保留它

模式：默认无头（"--headless=new"；也可用环境变量 ADG_BROWSER_MODE 全局指定，非法值直接报错）。
碰上登录墙 / 验证码 / 反爬挑战页才用 --headed 开真窗口 —— 人要进去操作。两种模式共用一个
profile：launch --headed 会先把无头实例**优雅关掉**（登录态落盘）再开有头窗口，端口与 profile
都不变；反过来也一样。**不带旗标时默认模式只决定新起的实例**：活着的实例是另一种模式也**不动它**
（输出 STATE=REUSED / MODE=<实际模式> + 一行说明），换模式必须显式要求（旗标或 ADG_BROWSER_MODE）
—— 否则专家最常打的那条 bare launch 会关掉用户正在登录的窗口。模式不用猜：status 的 MODE= 是从
活着那个实例的 CDP User-Agent 读出来的（headless / headed / unknown；没在跑时 MODE=none）。

标签页卫生：open / launch 开的页会留着（给用户看或后续继续用）；
text / eval / shot --url <新地址> 只是"来读一次"，读完整条命令自己开的临时标签会被收走，
所以一次性抓取不会留下页。存量清理用 close-tab（它拒绝关到只剩 0 个页面 —— 那等于关浏览器）。

例：
  node cli.mjs launch --url "https://example.com"
  node cli.mjs launch --headed --url "https://example.com/login"
  node cli.mjs text --url "https://example.com/a" --out "$env:TEMP\\page.txt"
  node cli.mjs eval --file .\\probe.js --match example.com
  node cli.mjs close-tab --match hotels.ctrip.com
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

/** 等端口真的落下去。优雅关闭是异步的：`Browser.close` 一发出就返回，进程还在退出中。 */
async function waitPortDown(port, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!(await cdp.isAlive(port, { timeoutMs: 1500 }))) return true;
    await sleep(400);
  }
  return !(await cdp.isAlive(port, { timeoutMs: 1500 }));
}

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
  let created = false;
  if (url) {
    const targets = await cdp.listTargets(port).catch(() => []);
    const hit = (Array.isArray(targets) ? targets : []).find(
      (t) => t.type === 'page' && String(t.url ?? '') === url,
    );
    opts = hit ? { match: hit.url } : { newUrl: url };
    created = !hit;
  }
  const session = await cdp.pageSession(port, opts);
  return { session, created: created || session.created === true };
}

/**
 * 一次性读取命令的收尾：断开 CDP，并且**只收走本命令自己开的临时标签**（design.md I10）。
 * 别人开的页一律不碰（那可能是用户正在登录的窗口）；`--keep` 明确要留就不关。
 */
async function closeTempTab(port, created, session, keep) {
  const id = session.target?.id;
  session.close();
  if (!created || keep || !id) return;
  try {
    await cdp.closeTarget(port, id);
    print(`TAB_CLOSED=${id}`);
    print('HINT=这是一次性读取自己开的临时标签，读完就收走了；要保留它加 --keep');
  } catch (e) {
    print(`TAB_CLOSE_FAILED=${e?.message ?? String(e)}`);
  }
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
    print(`DEFAULT_MODE=${resolveMode()}`);
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
    if (args.headless && args.headed) throw new UsageError('--headless 与 --headed 不能同时给');
    const modeFlag = args.headless === true ? 'headless' : args.headed === true ? 'headed' : undefined;
    const mode = resolveMode({ mode: modeFlag });
    // 换模式只认**显式**要求（旗标或 ADG_BROWSER_MODE）：默认值不许拿活着的实例开刀（I11 ③）。
    const modeExplicit = modeIsExplicit({ mode: modeFlag });
    const alive = await cdp.isAlive(port, { timeoutMs: 2500 });
    const chrome = findChrome();
    const version = alive ? await cdp.version(port).catch(() => null) : null;
    const aliveMode = alive ? detectMode(version) : null;
    const plan = planLaunch({ alive, aliveMode, chrome, profile, port, urls, mode, modeExplicit });

    if (plan.action === 'error') {
      throw new Error(
        `没找到可用的 Chrome / Edge。候选：${chromeCandidates().join(' | ')}；可用 ADG_CHROME 指定绝对路径`,
      );
    }

    if (plan.action === 'reuse') {
      print('STATE=REUSED');
      print(`MODE=${plan.aliveMode}`);
      print(`PORT=${port}`);
      print(`PROFILE=${profile}`);
      print(`BROWSER=${version?.Browser ?? 'unknown'}`);
      for (const u of urls) await ensureOpen(port, u);
      await printTabs(port);
      if (plan.modeUnverified) {
        print(`HINT=活着的实例没报出 User-Agent，无法确认它是 ${mode} 还是有头；**没有**动它。要强制换成 ${mode}：先 node cli.mjs close，再 launch`);
      } else if (plan.modeNotRequested) {
        print(`HINT=活着的是 ${plan.aliveMode} 实例；你没有显式要求模式，所以**没有**动它（默认模式只决定新起的实例长什么样）。要换成另一种模式：node cli.mjs launch --headed 或 --headless`);
      } else if (plan.aliveMode === 'headless') {
        print('HINT=复用了一个无头实例（没有窗口）；需要人工登录 / 过验证时用 node cli.mjs launch --headed —— 它会先优雅关掉这个实例再开有头窗口，端口与 profile 不变');
      } else {
        print('HINT=复用了既有实例；登录态在它内存与这个 profile 里，不要重启它');
      }
      return;
    }

    // 换模式：先优雅关掉另一种模式的实例（`Browser.close` 会让登录态落盘），再起目标模式。
    // 不在这里强杀进程 —— 强杀跳过落盘；也不静默换掉 unknown 的活实例（planLaunch 把它归为复用）。
    let switchedFrom = null;
    if (plan.action === 'switch') {
      await cdp.closeBrowser(port);
      if (!(await waitPortDown(port, SWITCH_DOWN_WAIT_MS))) {
        throw new Error(
          `端口 ${port} 上的 ${plan.aliveMode} 实例在 ${SWITCH_DOWN_WAIT_MS / 1000}s 内没有退出；` +
            '**没有**强杀进程（强杀会跳过登录态落盘）。稍后重试，或先 node cli.mjs status 看它是否还活着',
        );
      }
      switchedFrom = plan.aliveMode;
      print(`SWITCHED_FROM=${switchedFrom}`);
      print('CLOSED=true');
    }

    fs.mkdirSync(profile, { recursive: true });

    // 启动 + 有界重试。转交签名很明确：**exit=0 且端口从未起来** —— 同一个 profile 上还活着的
    // 实例接走了启动请求、新进程自己干净退出（同一个 profile 同时只能有一个实例）。只有这个
    // 签名才重试；退出码非 0（例如沙箱失败）立即如实报错，绝不重试掩盖。
    // 2026-10-03 事故记录：`switch` 曾经不带 args，`spawn(chrome, undefined)` 于是以**空参数**
    // 启动了浏览器 —— 那是用户自己的默认 profile，请求被转交给用户日常那个实例：端口永远不
    // 起来、每次都 exit=0，用户侧还多出一堆窗口。下面这道闸门不是装饰。
    if (!Array.isArray(plan.args) || plan.args.length === 0) {
      throw new Error('没有构造出启动参数；拒绝用空参数启动浏览器（那会去动用户自己的默认 profile）');
    }
    const maxStarts = 3;
    let up = false;
    let lastExit = null;
    for (let attempt = 1; attempt <= maxStarts && !up; attempt += 1) {
      const child = spawn(plan.chrome, plan.args, { detached: true, stdio: 'ignore' });
      let spawnError = null;
      let exitCode = null;
      child.on('error', (e) => {
        spawnError = e;
      });
      child.on('exit', (code) => {
        exitCode = code;
      });
      child.unref();

      const deadline = Date.now() + Math.max(1, waitSec) * 1000;
      while (Date.now() < deadline) {
        if (spawnError) throw new Error(`启动浏览器失败：${spawnError.message}`);
        up = await cdp.isAlive(port, { timeoutMs: 2000 });
        if (up || exitCode !== null) break;
        await sleep(700);
      }
      lastExit = exitCode;
      if (up) break;
      if (exitCode === 0 && attempt < maxStarts) {
        print('RETRY=1');
        print('HINT=新进程把启动请求转交给了同一个 profile 上还活着的实例（单例锁没放开），它自己退 0；等它退干净再试');
        await sleep(1200);
      } else {
        break;
      }
    }
    if (!up) {
      throw new Error(
        `启动后 127.0.0.1:${port} 没有起来（CHROME=${plan.chrome} PROFILE=${profile} exit=${lastExit}）；` +
          '先看 node cli.mjs status 确认没有旧实例捏着这个 profile，再重试',
      );
    }

    print(`STATE=${switchedFrom ? 'SWITCHED' : 'STARTED'}`);
    print(`MODE=${mode}`);
    print(`CHROME=${plan.chrome}`);
    print(`PORT=${port}`);
    print(`PROFILE=${profile}`);
    print(`BROWSER=${(await cdp.version(port).catch(() => ({}))).Browser ?? 'unknown'}`);
    await printTabs(port);
    if (mode === 'headless') {
      print('HINT=这是无头实例（没有窗口）；需要人工登录 / 过验证时用 node cli.mjs launch --headed —— 先优雅关掉它再开有头窗口，登录态留在同一个 profile');
    } else {
      print('HINT=这是有头窗口，用户可以直接在里面登录 / 过验证；不要关掉它');
    }
    if (switchedFrom) print(`HINT=上一个 ${switchedFrom} 实例已优雅关闭，登录态已落盘到 ${profile}`);
    return;
  }

  if (cmd === 'status') {
    const alive = await cdp.isAlive(port, { timeoutMs: 2500 });
    print(`ALIVE=${alive}`);
    print(`PORT=${port}`);
    print(`PROFILE=${profile}`);
    print(`DEFAULT_MODE=${resolveMode()}`);
    if (!alive) {
      print('MODE=none');
      print('HINT=浏览器没在跑；用 node cli.mjs launch 开一个（默认无头），需要人工登录 / 过验证时加 --headed');
      return;
    }
    const version = await cdp.version(port).catch(() => null);
    print(`BROWSER=${version?.Browser ?? 'unknown'}`);
    print(`MODE=${detectMode(version)}`);
    await printTabs(port);
    return;
  }

  if (cmd === 'tabs') {
    await requireAlive(port);
    await printTabs(port);
    print('HINT=清理存量用 node cli.mjs close-tab --match <子串>（或 --tab <n> 关一个）');
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

  if (cmd === 'close-tab') {
    await requireAlive(port);
    const picked = cdp.pickTabsToClose(await cdp.listTargets(port), {
      match: args.match,
      tab: args.tab,
    });
    if (picked.reason) throw new Error(picked.reason);
    for (const t of picked.targets) {
      await cdp.closeTarget(port, t.id);
      print(`TAB_CLOSED=${t.title ?? ''} | ${t.url ?? ''}`);
    }
    print(`CLOSED_TABS=${picked.targets.length}`);
    await sleep(300);
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
    const { session, created } = await sessionFor(port, args);
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
      await closeTempTab(port, created, session, args.keep);
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
    const { session, created } = await sessionFor(port, args);
    try {
      const value = await session.evalJs(expr);
      print(`RESULT=${value === undefined ? 'undefined' : JSON.stringify(value, null, 2)}`);
    } finally {
      await closeTempTab(port, created, session, args.keep);
    }
    return;
  }

  if (cmd === 'shot') {
    await requireAlive(port);
    if (!args.out) throw new UsageError('shot 需要 --out <png 路径>');
    const { session, created } = await sessionFor(port, args);
    try {
      const abs = await session.shot(String(args.out), { full: Boolean(args.full) });
      print(`SHOT=${abs}`);
      const t = await session.text().catch(() => ({}));
      print(`URL=${t.url ?? ''}`);
    } finally {
      await closeTempTab(port, created, session, args.keep);
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