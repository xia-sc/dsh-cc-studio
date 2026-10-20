/**
 * 草稿锁（0.11.0）回归测试 —— 纯函数 + 工具半真实调用。不随插件发布，files 未含 tests。
 *
 * 事故：LLM 正在工坊草稿里创作 A 卡时，用户点「载入」B 卡，同一会话槽的草稿被整份替换 ——
 * LLM 已写入但未保存的内容被覆盖，只能从历史对话里捞。修法分三段：
 *   ① 判定与常量收在 lib/draft-lock.js（两半共用一份，「锁算不算 active」不许两半各写）；
 *   ② 工具半每次写草稿都建立 <safeDraftFile>.lock.json（本文件验证）；
 *   ③ 宿主侧看到 active 锁就只读/预览、LLM 调 cc_release_draft 交还（宿主/客户端的测试在各自文件）。
 *
 * 运行：node tests/draft-lock.test.mjs   （全绿退出码 0）
 * 隔离：DSH_HOME / HOME / USERPROFILE 全部指向临时目录，跑完删除（见 AGENTS.md §2.6）
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCK_TTL_SEC, LOCK_OWNER_LLM, normalizeLock, isLockStale, lockSummary, lockBlocksDraftWrite } from '../lib/draft-lock.js';

// —— 先隔离落盘根，再 import 工具半（静态 import 会被提升执行，所以 lib/agent.js 必须动态 import）——
const tmpHome = mkdtempSync(join(tmpdir(), 'cc-draft-lock-'));
process.env.DSH_HOME = tmpHome;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const mod = await import('../lib/agent.js');

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

// ——————————————————————————————————————————————————————————————
// ① 纯函数（lib/draft-lock.js，两半共用）
// ——————————————————————————————————————————————————————————————
const NOW = 1800000000;

check('① normalizeLock：空 / 非对象 → 无锁',
  normalizeLock(null, 'k') === null && normalizeLock('nope', 'k') === null, '');
check('①a normalizeLock：owner 不是 llm → 无锁（用户侧没有「接管锁」这种状态，权限只在 LLM 手里）',
  normalizeLock({ owner: 'user', updatedAt: NOW }, 'k') === null
    && normalizeLock({ owner: 'LLM', updatedAt: NOW }, 'k') === null, '');
check('①b normalizeLock：key 对不上 → 无锁（防 hash 碰撞 / 手工拷贝 / 改名后的残文件挡住别人）',
  normalizeLock({ owner: 'llm', key: 'other', updatedAt: NOW }, 'k') === null, '');
check('①c normalizeLock：没有 updatedAt / 时间非法 → 无锁（算不出超时的锁不可信，降级方向必须是「能编辑」）',
  normalizeLock({ owner: 'llm' }, 'k') === null
    && normalizeLock({ owner: 'llm', updatedAt: 0 }, 'k') === null
    && normalizeLock({ owner: 'llm', updatedAt: 'x' }, 'k') === null, '');

const nl = normalizeLock({ owner: 'llm', key: 'k', updatedAt: NOW, since: NOW - 100, rev: 3, cardName: '  卡A  ', extra: 1 }, 'k');
check('①d normalizeLock：合法锁归一成固定形状（since 保留、cardName 原样截断、未知字段丢掉）',
  !!nl && nl.key === 'k' && nl.owner === LOCK_OWNER_LLM && nl.since === NOW - 100
    && nl.updatedAt === NOW && nl.rev === 3 && nl.cardName === '  卡A  ' && nl.extra === undefined,
  JSON.stringify(nl));
check('①e normalizeLock：缺 since 时用 updatedAt 顶上（摘要里 since 不允许是 undefined）',
  (normalizeLock({ owner: 'llm', updatedAt: NOW }, 'k') || {}).since === NOW, '');
check('①f normalizeLock：锁文件没带 key 时按调用方给的 key 归属（读侧认槽，不认文件里可能过期的 key）',
  (normalizeLock({ owner: 'llm', updatedAt: NOW }, 'session-x') || {}).key === 'session-x', '');

const activeLock = { updatedAt: NOW };
check('①g isLockStale：边界是「> TTL」，刚好等于 TTL 仍算 active（不会在心跳间隔上误判）',
  isLockStale(activeLock, NOW + LOCK_TTL_SEC) === false
    && isLockStale(activeLock, NOW + LOCK_TTL_SEC + 1) === true, '');
check('①h isLockStale：无锁恒 false', isLockStale(null, NOW) === false, '');

const sum = lockSummary({ owner: 'llm', cardName: '卡A', since: NOW - 100, updatedAt: NOW, rev: 2 }, NOW + 30);
check('①i lockSummary：active / ageSec / ttlSec / stale 齐全（客户端只渲染摘要，不自己算超时）',
  !!sum && sum.owner === 'llm' && sum.cardName === '卡A' && sum.since === NOW - 100
    && sum.updatedAt === NOW && sum.ageSec === 30 && sum.ttlSec === LOCK_TTL_SEC
    && sum.stale === false && sum.active === true, JSON.stringify(sum));
const sumStale = lockSummary({ owner: 'llm', cardName: '卡A', updatedAt: NOW }, NOW + LOCK_TTL_SEC + 1);
check('①j lockSummary：超时 → stale=true 且 active=false（这是「用户现在可以编辑了」的信号）',
  sumStale.stale === true && sumStale.active === false, JSON.stringify(sumStale));
check('①k lockSummary：无锁显式 null（不是 undefined —— B1 的 lossless-JSON 教训）',
  lockSummary(null, NOW) === null, '');

const blocked = lockBlocksDraftWrite(activeLock, NOW, false);
check('①l lockBlocksDraftWrite：锁 active → 拦下（reason=llm-locked，宿主据此回 draft-locked）',
  blocked.blocked === true && blocked.reason === 'llm-locked' && blocked.stale === false, JSON.stringify(blocked));
const forced = lockBlocksDraftWrite(activeLock, NOW, true);
check('①m lockBlocksDraftWrite：force:true → 放行（设置页关掉创作保护 = 旧行为），并如实报 stale',
  forced.blocked === false && forced.reason === 'force' && forced.stale === false, JSON.stringify(forced));
const noLock = lockBlocksDraftWrite(null, NOW, false);
check('①n lockBlocksDraftWrite：无锁放行（reason=none）',
  noLock.blocked === false && noLock.reason === 'none', JSON.stringify(noLock));
const staleBlocked = lockBlocksDraftWrite(activeLock, NOW + LOCK_TTL_SEC + 1, false);
check('①o lockBlocksDraftWrite：锁超时放行（reason=stale —— 安全阀，不是用户抢权）',
  staleBlocked.blocked === false && staleBlocked.reason === 'stale' && staleBlocked.stale === true,
  JSON.stringify(staleBlocked));

// ——————————————————————————————————————————————————————————————
// ② 工具半真实调用：写草稿即上锁、交还即解锁、空写续期、损坏即降级
// ——————————————————————————————————————————————————————————————
const tools = new Map();
mod.apply({ get() { return null; }, tools: { register(def) { tools.set(def.name, def); } } });
const KEY = 'session-draft-lock-test';
const exec = { agent: { session: { id: KEY } } };
const call = (n, a) => tools.get(n).execute(a || {}, exec);

const draftsRoot = mod.draftDirs()[0];
const lockPath = () => join(draftsRoot, mod.safeDraftFile(KEY).replace(/\.json$/, '.lock.json'));
const draftPath = () => join(draftsRoot, mod.safeDraftFile(KEY));
const readLockFile = () => JSON.parse(readFileSync(lockPath(), 'utf8'));

check('② 测试前置：cc_release_draft 已注册（工具半的第 33 个工具）',
  tools.has('cc_release_draft') && tools.size === 33, 'tools=' + tools.size);

let w = await call('cc_patch_character', { name: '锁测试卡', description: 'LLM 正在写' });
check('②a 写类工具跑完后草稿目录出现 .lock.json（每次写草稿都上锁）',
  existsSync(lockPath()), lockPath());
const first = readLockFile();
check('②b 锁文件字段：owner=llm / key=会话槽 / cardName=卡名 / rev=草稿版本 / since=updatedAt（首次上锁）',
  first.owner === LOCK_OWNER_LLM && first.key === KEY && first.cardName === '锁测试卡'
    && first.rev === w.draftStatus.rev && typeof first.updatedAt === 'number'
    && first.since === first.updatedAt, JSON.stringify(first));
check('②c 写类工具的返回里 draftStatus.lock 直接可读（active / ttlSec / 卡名）',
  !!w.draftStatus.lock && w.draftStatus.lock.active === true
    && w.draftStatus.lock.owner === LOCK_OWNER_LLM && w.draftStatus.lock.cardName === '锁测试卡'
    && w.draftStatus.lock.ttlSec === LOCK_TTL_SEC, JSON.stringify(w.draftStatus.lock));
check('②d 锁不写进草稿 JSON（草稿 rev 仍然只反映内容变化；只读与交还不重写草稿）',
  JSON.parse(readFileSync(draftPath(), 'utf8')).lock === undefined, '');
check('②e draftLockPath 的路径与测试自己算的一致（两半同构的表达式）',
  mod.draftLockPath(KEY) === lockPath(), mod.draftLockPath(KEY));

const since0 = first.since;
w = await call('cc_patch_character', { personality: '安静' });
const second = readLockFile();
check('②f 再次写入续期：since 保留（「从什么时候开始创作」不重置）、rev 跟上本次落盘',
  second.since === since0 && second.rev === w.draftStatus.rev && second.updatedAt >= first.updatedAt,
  JSON.stringify({ before: { since: since0, updatedAt: first.updatedAt }, after: { since: second.since, updatedAt: second.updatedAt } }));

const rel = await call('cc_release_draft', {});
check('②g cc_release_draft：锁文件被删、released=true、sessionKey / 卡名 / rev 齐全',
  rel.ok === true && rel.released === true && rel.sessionKey === KEY
    && rel.cardName === '锁测试卡' && typeof rel.rev === 'number'
    && !existsSync(lockPath()) && /释放/.test(String(rel.message)),
  JSON.stringify({ released: rel.released, cardName: rel.cardName, rev: rel.rev, exists: existsSync(lockPath()) }));
check('②h 释放后 draftStatus.lock 显式 null（客户端据此恢复可编辑）',
  rel.draftStatus.lock === null, JSON.stringify(rel.draftStatus.lock));

const rel2 = await call('cc_release_draft', {});
check('②i 无锁时再释放：幂等成功（released=false，不报错）',
  rel2.ok === true && rel2.released === false && rel2.draftStatus.lock === null
    && /没有草稿锁/.test(String(rel2.message)), JSON.stringify(rel2));

w = await call('cc_patch_character', { nickname: '重新锁' });
const third = readLockFile();
check('②j 释放后再写会重新上锁（权限仍在 LLM 手里，用户不会因此永久失去保护）',
  existsSync(lockPath()) && w.draftStatus.lock.active === true
    && third.since === third.updatedAt, JSON.stringify(third));

// 把 updatedAt 拨回 5 秒前，再打一次**同值**写入 —— 内容没变，但锁心跳必须前进
const older = Math.max(1, Math.floor(Date.now() / 1000) - 5);
writeFileSync(lockPath(), JSON.stringify(Object.assign({}, third, { updatedAt: older }), null, 2), 'utf8');
const idle = await call('cc_patch_character', { nickname: '重新锁' });   // 同值 → 走 setDraft 的「无变化提前 return」
const renewed = readLockFile();
check('②k 同值写入也续期：changed 为空（内容没变），但锁 updatedAt 前进（心跳不是「改了吗」）',
  Array.isArray(idle.changed) && idle.changed.length === 0
    && renewed.updatedAt > older && renewed.updatedAt >= Math.floor(Date.now() / 1000) - 1
    && renewed.since === third.since,
  JSON.stringify({ changed: idle.changed, before: older, after: renewed.updatedAt, since: renewed.since }));
check('②l 空写不涨草稿 rev（N4 家规没被锁续期破坏）',
  idle.draftStatus.rev === w.draftStatus.rev, idle.draftStatus.rev + ' vs ' + w.draftStatus.rev);
check('②m 续期写下的 rev 是数字（绝不写 undefined，否则 lossless-JSON 会让整次调用报错）',
  typeof renewed.rev === 'number' && renewed.rev > 0, String(renewed.rev));

// 锁文件损坏：一律视为无锁（降级方向必须是「能编辑」，而不是把用户永久挡在门外）
writeFileSync(lockPath(), '{ 这不是 JSON', 'utf8');
const gc = await call('cc_get_card');
check('②n 锁文件损坏 → 视为无锁（cc_get_card 的 draftStatus.lock 为 null）',
  gc.draftStatus.lock === null, JSON.stringify(gc.draftStatus.lock));
check('②o draftLockSummaryFor 读损坏文件同样返回 null（宿主/客户端拿到的是同一结论）',
  mod.draftLockSummaryFor(KEY) === null, '');

// TTL 超时：摘要报 stale，且不置 active；LLM 再写时锁继续有效（since 沿用，仍是同一次创作）
const nowSec = Math.floor(Date.now() / 1000);
const staleLock = {
  key: KEY, owner: LOCK_OWNER_LLM,
  since: nowSec - LOCK_TTL_SEC - 30, updatedAt: nowSec - LOCK_TTL_SEC - 10,
  rev: renewed.rev, cardName: '锁测试卡',
};
writeFileSync(lockPath(), JSON.stringify(staleLock, null, 2), 'utf8');
const staleSum = mod.draftLockSummaryFor(KEY);
check('②p 超时锁：摘要 stale=true / active=false（LLM 崩溃后工坊不会被永久锁死）',
  !!staleSum && staleSum.stale === true && staleSum.active === false && staleSum.ageSec > LOCK_TTL_SEC,
  JSON.stringify(staleSum));
w = await call('cc_patch_character', { nickname: '超时后再写' });
const afterStale = readLockFile();
check('②q 超时后 LLM 再写：锁重新 active，since 沿用旧锁（同一次创作的时长不要被一次超时重置）',
  w.draftStatus.lock.active === true && afterStale.since === staleLock.since,
  JSON.stringify(afterStale));

// 收尾：清掉临时落盘根（锁目录也在里面，别留在真实 ~/.dsh）
rmSync(tmpHome, { recursive: true, force: true });

const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 170)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
