/**
 * 测试共享骨架（ROADMAP 4.1 L1）。
 *
 * 背景：37 个测试文件各自抄了一份 `const results = []` + `function check()` + 尾部汇总，
 * 十几个客户端测试还各抄一份假 React / 假 localStorage / 假 window / bundle 装载（约 700 行
 * 重复，改一次假 API 要改十几处）。这里只保留一份。
 *
 * 三条边界（别把这些搬进来）：
 * - **不启动 dsh、不开端口**：需要真宿主的验证属于 L3（`scripts/e2e-smoke.mjs`），不是这里。
 * - **不设置 document / Blob / URL**：各测试对 DOM 的需求不同（有的要 `a.click()` 记下载，
 *   有的要 `querySelectorAll` 返回芯片），这些留在测试文件里自己 stub。
 * - **不替测试决定 setTimeout 语义**：`timers: "queue"` 收集、`"drop"` 丢弃，由调用方选。
 *
 * 运行方式不变：`node tests/<file>.test.mjs`，结尾调 `finish()`。
 */
import { readFileSync } from 'node:fs';

const results = [];

/** 记录一条断言（原来每个文件里的同名函数）。 */
export function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}

/** 打印 PASS/FAIL 清单与汇总，并以退出码收尾（全绿 0，有失败 1）。 */
export function finish() {
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    const detail = r.detail === undefined || r.detail === ''
      ? ''
      : '  — ' + String(r.detail).slice(0, 160);
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

/** 读仓库文件（相对 tests/），统一成 LF —— 测试里的 `includes('…\n…')` 不该被 CRLF 绊倒。 */
export function readRepo(rel) {
  return readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * 假 React（hook 槽位按渲染顺序保留）：只读源码的测试也能用，不必自己抄一份。
 * 返回的 `effectQueue` / `hooks` 供测试手动跑 effect、重置槽位。
 */
export function createFakeReact() {
  const effectQueue = [];
  const hooks = { slots: [], idx: 0 };
  const React = {
    createElement(type, props) {
      return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) };
    },
    useState(init) {
      const i = hooks.idx++;
      if (!(i in hooks.slots)) hooks.slots[i] = typeof init === 'function' ? init() : init;
      return [hooks.slots[i], function (v) {
        hooks.slots[i] = typeof v === 'function' ? v(hooks.slots[i]) : v;
      }];
    },
    useRef(init) {
      const i = hooks.idx++;
      if (!(i in hooks.slots)) hooks.slots[i] = { current: init };
      return hooks.slots[i];
    },
    useCallback(fn) { return fn; },
    useEffect(fn) { effectQueue.push(fn); },
    useMemo(fn) { return fn(); },
  };
  return { React, effectQueue, hooks };
}

/**
 * 把 `lib/client.js` 装进假 React / 假 window / 假 localStorage，返回可断言的运行时。
 *
 * 参数：
 * - `timers: "drop" | "queue"` —— 默认 `"drop"`：setTimeout/setInterval 只返回 id 不执行
 *   （客户端有 1s 轮询，真跑会把断言搅乱）；`"queue"` 收集到返回的 `timers` 数组里，
 *   由测试手动 `timers[i].fn()` 触发（草稿推送这类延迟调用要这样验）。
 * - `windowExtra` —— 装到假 window 上的额外成员（`confirm` / `matchMedia` 之类）。
 *
 * 返回 `{ src, registration, React, effectQueue, hooks, storage, timers }`：
 * 测试用 `registration.factory(require)` 拿模块并 `await mod.apply(fakeCtx)`，
 * `effectQueue` / `hooks` 用来手动跑 effect、重置 hook 槽位。
 */
export function loadClient({ timers = 'drop', windowExtra = {} } = {}) {
  const src = readRepo('lib/client.js');

  // —— 假 React：hook 槽位按渲染顺序保留（setHover/setFocus 之后重渲染能看到新值）——
  const { React, effectQueue, hooks } = createFakeReact();

  // —— 假定时器：默认只返回 id、不执行 ——
  const timerQueue = [];
  if (timers === 'queue') {
    globalThis.setTimeout = function (fn, ms) { timerQueue.push({ fn, ms }); return timerQueue.length; };
  } else {
    globalThis.setTimeout = function () { return 0; };
  }
  globalThis.clearTimeout = function () {};
  globalThis.setInterval = function () { return 1; };
  globalThis.clearInterval = function () {};

  // —— 假 localStorage（每个测试一份新 Map）——
  const storage = new Map();
  globalThis.localStorage = {
    getItem(k) { return storage.has(k) ? storage.get(k) : null; },
    setItem(k, v) { storage.set(k, String(v)); },
    removeItem(k) { storage.delete(k); },
  };

  // —— 假 window + 装载 bundle（client.js 是 window.__ModuleLoader__ 外壳）——
  let registration = null;
  globalThis.window = {
    __ModuleLoader__: { load(def) { registration = def; } },
    ...windowExtra,
  };
  new Function('window', src)(globalThis.window);
  if (!registration) {
    console.log('FAIL  bundle 没有调用 window.__ModuleLoader__.load');
    process.exit(1);
  }

  return { src, registration, React, effectQueue, hooks, storage, timers: timerQueue };
}
