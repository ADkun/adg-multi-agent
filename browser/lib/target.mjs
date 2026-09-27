// `browser/` 的纯函数层：把「这次要驱动哪个浏览器」解析成确定的值 ——
// profile 目录、调试端口、Chrome 可执行文件、启动参数，以及「该复用还是该启动」的决策。
//
// 本文件不 spawn、不联网、不读真实文件系统（`exists` / `fsImpl` 都是可注入的），
// 所以 `test/browser.test.mjs` 能零依赖、零副作用地钉住 design.md 的 I1..I6。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** 固定的调试端口。换端口等于换一个「浏览器实例」的身份，见 design.md I7。 */
export const DEFAULT_PORT = 9333;

/** 规范 profile 的目录名（固定在 DSH 用户根下，与任何工作区无关）。 */
export const PROFILE_DIRNAME = 'browser-profile';

/** Windows 的 env 键大小写不敏感，这里统一按小写名查找。 */
export function envGet(env, name) {
  if (env == null) return undefined;
  const want = name.toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === want && env[key] != null && env[key] !== '') return env[key];
  }
  return undefined;
}

/** DSH 用户根：`DSH_HOME` 优先，缺省 `~/.dsh`。 */
export function dshHome(env = process.env, home = os.homedir()) {
  const raw = envGet(env, 'DSH_HOME');
  if (raw) return path.resolve(raw);
  return path.join(home, '.dsh');
}

/**
 * 规范 profile 路径。优先级：显式 `--profile` > `ADG_BROWSER_PROFILE` > `<DSH_HOME>/browser-profile`。
 * 从不回落成「工作区里的相对目录」—— 那会让登录态随工作区漂移（design.md I1）。
 */
export function resolveProfile(opts = {}) {
  const { profile, env = process.env, home = os.homedir(), cwd = process.cwd() } = opts;
  if (typeof profile === 'string' && profile.trim()) return path.resolve(cwd, profile.trim());
  const fromEnv = envGet(env, 'ADG_BROWSER_PROFILE');
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(dshHome(env, home), PROFILE_DIRNAME);
}

/** 调试端口：显式 > `ADG_BROWSER_PORT` > 默认。非法值直接抛（不要静默回落）。 */
export function resolvePort(opts = {}) {
  const { port, env = process.env } = opts;
  const raw = port == null || port === '' ? (envGet(env, 'ADG_BROWSER_PORT') ?? DEFAULT_PORT) : port;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`调试端口不合法：${String(raw)}`);
  return n;
}

/**
 * 启动参数。**刻意不传** `--no-sandbox` / `--disable-blink-features=AutomationControlled` /
 * `--user-agent=` —— 对 connect-only 驱动零收益，却会让浏览器行为与用户日常浏览器不一致
 * （design.md I2，来源：本机 D:\dsh\.browser-tools\start-chrome-headed.ps1 的实测形态）。
 */
export function launchArgs(opts = {}) {
  const { profile, port, urls = [], windowSize = '1500,980', lang = 'zh-CN' } = opts;
  if (!profile) throw new Error('launchArgs 需要 profile');
  const args = [
    `--remote-debugging-port=${resolvePort({ port })}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--lang=${lang}`,
  ];
  if (windowSize) args.push(`--window-size=${windowSize}`);
  args.push('--new-window');
  for (const u of urls) if (u) args.push(u);
  return args;
}

/** 候选 Chrome/Edge 路径，按优先级。`ADG_CHROME` 永远排第一。 */
export function chromeCandidates(env = process.env, platform = process.platform) {
  const out = [];
  const override = envGet(env, 'ADG_CHROME');
  if (override) out.push(override);
  if (platform === 'win32') {
    for (const key of ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA']) {
      const base = envGet(env, key);
      if (!base) continue;
      out.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      out.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (platform === 'darwin') {
    out.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    out.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    out.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    );
  }
  return out;
}

/** 第一个真实存在的候选；都没有就返回 null（由调用方决定报错口径）。 */
export function findChrome(opts = {}) {
  const {
    env = process.env,
    platform = process.platform,
    exists = (p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    },
  } = opts;
  for (const p of chromeCandidates(env, platform)) if (exists(p)) return p;
  return null;
}

/**
 * 「复用还是启动」的决策（纯函数）。**复用优先**：实例还活着时绝不重启 ——
 * 重启会丢掉内存里的会话态，也让用户不得不重新登录（design.md I3）。
 */
export function planLaunch(opts = {}) {
  const { alive, chrome, profile, port, urls = [] } = opts;
  const p = resolvePort({ port });
  if (!profile) throw new Error('planLaunch 需要 profile');
  if (alive) return { action: 'reuse', profile, port: p, chrome: chrome ?? null };
  if (!chrome) return { action: 'error', reason: 'CHROME_NOT_FOUND', profile, port: p };
  return { action: 'start', profile, port: p, chrome, args: launchArgs({ profile, port: p, urls }) };
}