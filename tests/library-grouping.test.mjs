/**
 * 角色库分组展示回归测试（0.23.1）。
 *
 * 背景：0.22.0 把左栏改成平铺卡片后，分组只剩卡片副标题末尾一句「· 锁天司」，
 *   几组卡混在一列里看不出谁和谁是一组（用户："原本卡分组关系没法直观体现了"）。
 *
 * 修法：列表按分组分节 —— 组首一行小字（组名 + 张数 + 细线），组内卡片照常平铺；
 *   它只是视觉分隔，不可折叠、不带按钮；库里有卡但没有任何分组时仍然是纯平铺；
 *   卡片副标题不再重复组名（组名由组首统一交代），只在 hover 提示里带一次。
 *
 * 本文件把 lib/client.js 装进假 React harness，直接断言渲染出来的节点顺序与文案。
 *
 * 运行：node tests/library-grouping.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

import { check, finish, loadClient } from './harness.mjs';

// —— 假 React ——
const { registration, React, effectQueue, hooks, storage } = loadClient({ timers: 'drop' });

// 4 张卡：g1 两张、g2 一张、未分组一张
const FAKE_LIB = [
  { id: 'lib-a', name: '陆昭', loreCount: 5, groupId: 'g1', tags: [] },
  { id: 'lib-b', name: '白十三', loreCount: 3, groupId: 'g1', tags: [] },
  { id: 'lib-c', name: '谢无咎', loreCount: 3, groupId: 'g2', tags: [] },
  { id: 'lib-d', name: '沈照雪', loreCount: 9, groupId: '', tags: [] },
];
const FAKE_GROUPS = [
  { id: 'g1', name: '锁天司', hasBook: true, bookEntries: 2 },
  { id: 'g2', name: '测试', hasBook: false },
];

let groupsResponse = FAKE_GROUPS;
const calls = [];
const fakeCtx = {
  effect(fn) { try { fn(); } catch (e) { console.log('FAIL  effect 抛错: ' + e.message); } return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (k) => k; } },
  slots: {
    inject(name, cb) { cb(); return () => {}; },
    register(opts, comp) { registered[opts.name] = { opts, comp }; return () => {}; },
  },
  connection: { rpc: { call(channel, endpoint, payload) {
    calls.push({ endpoint, payload });
    if (endpoint === 'cc_listLibrary') return Promise.resolve({ ok: true, value: { entries: FAKE_LIB } });
    if (endpoint === 'cc_listGroups') return Promise.resolve({ ok: true, value: { groups: groupsResponse } });
    return Promise.resolve({ ok: false, error: { code: 'internal', message: 'no handler' } });
  } } },
};
const registered = {};

const mod = registration.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});
await mod.apply(fakeCtx);

const overlay = registered['shell.overlay'];
const store = registered['conversation.input.dock'].opts.inject('warmup').store;
const t = (k) => k;

function render() {
  hooks.idx = 0;
  effectQueue.length = 0;
  const tree = overlay.comp({ store, t });
  const effects = effectQueue.slice();
  effectQueue.length = 0;
  return { tree, effects };
}
function redraw() {
  hooks.idx = 0;
  effectQueue.length = 0;
  return overlay.comp({ store, t });
}
function flatten(node, out) {
  out = out || [];
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((c) => flatten(c, out));
  return out;
}

// 组首那行：padding 固定 "8px 2px 0"（唯一）
const heads = (tree) => flatten(tree).filter((n) => n.type === 'div' && n.props && n.props.style && n.props.style.padding === '8px 2px 0');
const headName = (head) => String(head.children[0].children[0]);
const headCount = (head) => String(head.children[head.children.length - 1].children[0]);
// 卡片：可点的 div + title（title 形如「名字 · 组名」）
const cards = (tree) => flatten(tree).filter((n) => n.type === 'div' && n.props && typeof n.props.title === 'string' && n.props.style && n.props.style.cursor === 'pointer' && n.props.style.padding === '8px' && n.props.style.gap === 9);
const cardName = (card) => String(card.props.title).split(' · ')[0];

// 打开工坊并订阅 store
store.setPanel(true);
render().effects.forEach((fn) => { try { fn(); } catch (e) {} });
await store.refreshGroups();
await store.refreshLibrary();
let tree = redraw();

check('① 卡片按分组分节：组首小字出现「锁天司」「测试」与「未分组」',
  heads(tree).map(headName).join(',') === ['锁天司', '测试', 'workshop.group.none'].join(','),
  heads(tree).map(headName).join(','));
check('② 组首张数 = 该组命中的卡数（锁天司 2 / 测试 1 / 未分组 1）',
  heads(tree).map(headCount).join(',') === '2,1,1', heads(tree).map(headCount).join(','));
check('③ 组首只是视觉分隔：不可点击、不折叠（没有 onClick / onMouseDown）',
  heads(tree).every((head) => !head.props.onClick && !head.props.onMouseDown),
  String(heads(tree).length) + ' heads');

// 节点顺序：组标题与卡片的相对位置
{
  const seq = flatten(tree)
    .filter((n) => (n.props && n.props.style && n.props.style.padding === '8px 2px 0') || (n.props && typeof n.props.title === 'string' && n.props.style && n.props.style.cursor === 'pointer' && n.props.style.padding === '8px' && n.props.style.gap === 9))
    .map((n) => (n.props.style.padding === '8px 2px 0' ? 'H:' + headName(n) : 'C:' + cardName(n)));
  check('④ 组内卡片紧跟自己的组首（锁天司 2 张 → 测试 1 张 → 未分组 1 张）',
    seq.join('|') === ['H:锁天司', 'C:白十三', 'C:陆昭', 'H:测试', 'C:谢无咎', 'H:workshop.group.none', 'C:沈照雪'].join('|'),
    seq.join('|'));
}

check('⑤ 卡片副标题不再重复组名（组名由组首统一交代）',
  flatten(tree).every((n) => !(n.children && typeof n.children[0] === 'string' && n.children[0].indexOf('· 锁天司') > 0)),
  '');
check('⑥ 组名仍留在卡片 hover 提示里（title = 名字 · 组名）',
  cards(tree).map((c) => c.props.title).join('|') === '白十三 · 锁天司|陆昭 · 锁天司|谢无咎 · 测试|沈照雪',
  cards(tree).map((c) => c.props.title).join('|'));
check('⑦ 有共享世界书的组在组首挂 📖（点卡片能看出这组有共享设定）',
  (function () {
    const h1 = heads(tree)[0];
    return h1.children.some((c) => c && c.children && c.children[0] === '📖');
  })(), '');

// —— 搜索：只渲染命中的组，空组不占位置 ——
store.setLibraryQuery('白十三');
tree = redraw();
check('⑧ 搜索命中只剩一个组，组首张数是命中数（1）',
  heads(tree).length === 1 && headName(heads(tree)[0]) === '锁天司' && headCount(heads(tree)[0]) === '1',
  heads(tree).map((h) => headName(h) + ':' + headCount(h)).join(','));
check('⑨ 搜索时其他组的卡不渲染', cards(tree).map(cardName).join(',') === '白十三', cards(tree).map(cardName).join(','));
store.setLibraryQuery('');

// —— 库里没有分组：纯平铺，不为「未分组」画标题 ——
groupsResponse = [];
await store.refreshGroups();
tree = redraw();
check('⑩ 库里没有分组时不给「未分组」画标题（纯平铺）',
  heads(tree).length === 0 && cards(tree).length === FAKE_LIB.length,
  'heads=' + heads(tree).length + ' cards=' + cards(tree).length);

// —— 折叠态（56px 头像条）：组与组之间插一条短横线 ——
// 56px 放不下组名，但「这条线以上是一组」仍然看得出来（用户要求）。
{
  groupsResponse = FAKE_GROUPS;
  await store.refreshGroups();
  store.toggleLibraryCollapsed();
  tree = redraw();
  const avatars = flatten(tree).filter((n) => n.props && n.props.style && String(n.props.style.background || '').indexOf('linear-gradient(135deg') === 0);
  const seps = flatten(tree).filter((n) => n.props && n.props.style && n.props.style.width === 20 && n.props.style.height === 1);
  check('⑪ 折叠态组间插短横线：3 组 → 2 条', seps.length === 2, 'seps=' + seps.length);
  check('⑪b 折叠态头像仍是 4 个，title 带组名（hover 能看出属于哪组）',
    avatars.length === 4 && avatars.some((a) => String(a.props.title).indexOf('锁天司') > 0),
    avatars.map((a) => a.props.title).join('|'));
  const seq = flatten(tree)
    .filter((n) => n.props && n.props.style && ((n.props.style.width === 20 && n.props.style.height === 1) || String(n.props.style.background || '').indexOf('linear-gradient(135deg') === 0))
    .map((n) => (n.props.style.width === 20 ? 'SEP' : 'A:' + String(n.props.title).split(' · ')[0]));
  check('⑪c 分隔线落在组与组之间，不夹在同一组内部',
    seq.join('|') === 'A:白十三|A:陆昭|SEP|A:谢无咎|SEP|A:沈照雪', seq.join('|'));
  store.toggleLibraryCollapsed();
  tree = redraw();
}

finish();
