/**
 * 0.28.0：诊断日志（等级 / 脱敏 / 导出）的回归测试。
 *
 * 背景：前几轮排查「删不净」花了几小时，最后靠翻磁盘时间戳才定位到「客户端 RPC 一直在失败、
 * 插件把失败静默吞了」。用户要求：出问题能记日志、等级可调、能直接反馈日志。
 *
 * 这个文件钉三件事：
 *  ① 纯函数行为（等级过滤 / 脱敏 / 行格式 / 滚动 / 设置解析）—— 全部来自 lib/log.js；
 *  ② 两半等级表**逐字一致**（客户端是手写 bundle，不能 import 本仓模块，只能自己维护一份）；
 *  ③ **隐私**：埋点不许把卡名 / 正文塞进日志（源码守卫 + 长文本截断行为），
 *     并断言整条日志行有长度上限（防止误传大对象把文件撑爆）。
 *
 * 运行：node tests/log.test.mjs   （全绿退出码 0）
 */
import { check, finish, readRepo } from './harness.mjs';
import {
  LOG_LEVELS, LOG_MAX_BYTES, LOG_VALUE_MAX,
  normalizeLogLevel, levelRank, shouldLog, sanitizeLogData, formatLogLine, shouldRotate,
  parseLogSettings, serializeLogSettings,
} from '../lib/log.js';

// —— ① 等级 ——
check('① 五个等级按 off < error < warn < info < debug 排序',
  LOG_LEVELS.join(',') === 'off,error,warn,info,debug'
  && levelRank('off') < levelRank('error')
  && levelRank('error') < levelRank('warn')
  && levelRank('warn') < levelRank('info')
  && levelRank('info') < levelRank('debug'), '');
check('①b 未知 / 空 / null 等级回退（默认 info，size 计算按 off 兜底不放大）',
  normalizeLogLevel('nonsense') === 'info'
  && normalizeLogLevel(undefined) === 'info'
  && normalizeLogLevel(null, 'warn') === 'warn'
  && levelRank('nonsense') === 0, '');
check('①c off 在任何方向都不记（关掉就是关掉，不偷偷留 error）',
  shouldLog('off', 'error') === false && shouldLog('off', 'debug') === false, '');
check('①d 上限语义：error 只记 error，info 记 error/warn/info 不记 debug，debug 全记',
  shouldLog('error', 'error') === true && shouldLog('error', 'warn') === false
  && shouldLog('info', 'warn') === true && shouldLog('info', 'info') === true && shouldLog('info', 'debug') === false
  && shouldLog('debug', 'debug') === true && shouldLog('debug', 'off') === false, '');

// —— ② 脱敏 ——
check('② 只保留一层标量：对象 / 数组 / 函数 / null / undefined 一律丢弃',
  (() => {
    const out = sanitizeLogData({ a: 1, b: true, c: 'text', d: null, e: undefined, f: { nested: 1 }, g: [1, 2], h: () => 1 });
    return JSON.stringify(out) === JSON.stringify({ a: 1, b: true, c: 'text' });
  })(), '');
check('②b 非有限数字丢弃（NaN / Infinity 会污染日志）',
  (() => {
    const out = sanitizeLogData({ a: NaN, b: Infinity, c: 0 });
    return Object.keys(out).length === 1 && out.c === 0;
  })(), '');
check('②c 键名不合法直接丢（不把用户数据当键名）',
  Object.keys(sanitizeLogData({ '带空格 的键': 1, ok_key: 2 })).join(',') === 'ok_key', '');
check('②d 换行折成字面 \\n（一条日志永远只占一行）',
  sanitizeLogData({ m: 'a\nb\rc' }).m === 'a\\nb\\nc', '');
check('②e 超长字符串截断并标出原始长度（长正文即使误传也只留开头一段）',
  (() => {
    const long = 'x'.repeat(LOG_VALUE_MAX + 40);
    const out = sanitizeLogData({ m: long }).m;
    return out.startsWith('x'.repeat(LOG_VALUE_MAX)) && out.includes('(' + long.length + ')');
  })(), '');

// —— ③ 行格式 ——
check('③ 行格式固定：<ISO8601> [level] [src] event k=v',
  (() => {
    const line = formatLogLine({ at: Date.UTC(2026, 0, 2, 3, 4, 5), level: 'warn', src: 'client', event: 'rpc.transport', data: { ep: 'cc_listLibrary', status: 404 } });
    return line === '2026-01-02T03:04:05.000Z [warn] [client] rpc.transport ep=cc_listLibrary status=404';
  })(), '');
check('③b src 白名单外的值回退 host（不让客户端伪造来源）',
  formatLogLine({ level: 'info', src: 'evil', event: 'x' }).includes('[host]'), '');
check('③c event 只留安全字符，且单行长度有上限',
  (() => {
    const line = formatLogLine({ level: 'debug', event: 'a b\nc/../d', data: { k: 'v'.repeat(1000) } });
    return line.includes('[host] a_b_c_.._d ') && !/[\s/]/.test(line.split('[host] ')[1].split(' ')[0]) && line.length < 1024;
  })(), '');

// —— ④ 滚动与设置 ——
check('④ 超过 512KB 才滚动，未知值不滚',
  shouldRotate(LOG_MAX_BYTES + 1) === true && shouldRotate(LOG_MAX_BYTES) === false
  && shouldRotate('nonsense') === false && shouldRotate(undefined) === false, '');
check('④b 设置解析：坏 JSON / 非法等级都回退默认，不抛错',
  parseLogSettings('{not json').level === 'info'
  && parseLogSettings('{"level":"debug"}').level === 'debug'
  && parseLogSettings('{"level":"loud"}').level === 'info'
  && parseLogSettings(JSON.stringify({ level: 'error' })).level === 'error', '');
check('④c 序列化 → 解析往返稳定',
  parseLogSettings(serializeLogSettings('warn')).level === 'warn'
  && serializeLogSettings('loud').includes('"info"'), '');

// —— ⑤ 两半等级表逐字一致（客户端是手写 bundle，只能各维护一份）——
{
  const clientSrc = readRepo('lib/client.js');
  const m = clientSrc.match(/var LOG_RANK=\{([^}]*)\};/);
  const pair = m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
  const ranks = {};
  for (const p of pair) {
    const [k, v] = p.split(':').map((x) => x.trim());
    ranks[k] = Number(v);
  }
  check('⑤ 客户端 LOG_RANK 与宿主 lib/log.js 的等级值完全一致',
    JSON.stringify(Object.keys(ranks)) === JSON.stringify(LOG_LEVELS)
    && LOG_LEVELS.every((lv) => ranks[lv] === levelRank(lv)),
    JSON.stringify(ranks));
  check('⑤b 客户端真的按等级过滤（ccLog 里比较 rank 后早退）',
    /if\(LOG_RANK\[lv\] > LOG_RANK\[ccLogLevel\]\) return;/.test(clientSrc), '');
}

// —— ⑥ 接线守卫 ——
{
  const hostSrc = readRepo('lib/index.js');
  const clientSrc = readRepo('lib/client.js');
  check('⑥ 宿主有 4 个日志端点（上报 / 设等级 / 读状态 / 导出）',
    /case "cc_log":\{/.test(hostSrc) && /case "cc_setLogLevel":\{/.test(hostSrc)
    && /case "cc_getLogLevel":\{/.test(hostSrc) && /case "cc_logDump":\{/.test(hostSrc), '');
  check('⑥b 宿主 RPC 埋点：成功 debug / 失败 warn，且 cc_log 自身不记（防自激）',
    /message\.method !== "cc_log"/.test(hostSrc)
    && /appendLog\(failed \? "warn" : "debug", "host", "rpc"/.test(hostSrc), '');
  check('⑥c 客户端有队列 + flush（静默 RPC，失败不重试、不再产生日志）',
    /function flushLogs\(\)/.test(clientSrc)
    && /return rpc\("cc_log", \{ entries: batch \}, true\)\.catch\(function\(\)\{\}\);/.test(clientSrc), '');
  check('⑥d 客户端在页面隐藏时 flush（关窗口前那几条往往正是线索）',
    /visibilitychange/.test(clientSrc) && /flushLogsNow\(\)/.test(clientSrc), '');
  check('⑥e 设置页有日志卡片（等级下拉 + 导出按钮）',
    /settings\.log\.title/.test(clientSrc) && /store\.setLogLevel\(e\.target\.value\)/.test(clientSrc)
    && /store\.exportLogs\(\)/.test(clientSrc), '');
  check('⑥f 日志目录走 dataRoots（与草稿/角色库同一个落盘根）',
    /function logDir\(\)\{ return dataRoots\("cc-logs"\)\[0\]; \}/.test(hostSrc), '');
}

// —— ⑦ 隐私守卫：埋点不许把卡名 / 正文塞进日志 ——
{
  const clientSrc = readRepo('lib/client.js');
  const calls = [];
  const re = /ccLog\(/g;
  let m;
  while ((m = re.exec(clientSrc)) !== null) {
    const start = m.index;
    const end = clientSrc.indexOf('});', start);
    if (end < 0) continue;
    calls.push(clientSrc.slice(start, end));
  }
  const FORBIDDEN_KEYS = ['name:', 'description:', 'content:', 'first_mes', 'personality', 'scenario', 'draft:', 'card:', 'text:'];
  const bad = [];
  for (const call of calls) {
    for (const k of FORBIDDEN_KEYS) {
      if (call.includes(k)) bad.push(call.slice(0, 80).replace(/\s+/g, ' ') + ' ← ' + k);
    }
  }
  check('⑦ 没有任何 ccLog 调用把卡名 / 正文类字段带进日志',
    calls.length > 5 && bad.length === 0, bad.slice(0, 2).join(' | '));
  check('⑦b 埋点覆盖关键动作（RPC、草稿同步、增删改库、会话切换、日志等级）',
    ['"rpc"', '"rpc.transport"', '"rpc.network"', '"draft.pull"', '"draft.clear"', '"library.load"', '"library.delete"', '"library.save"', '"session.switch"', '"log.level"']
      .every((ev) => clientSrc.includes(ev)), '');
}

finish();
