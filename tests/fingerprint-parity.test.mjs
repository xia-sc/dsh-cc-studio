/**
 * 0.25.4：两半「草稿内容指纹」必须**逐字节同构**的回归测试。
 *
 * 背景（用户反馈）：新建会话 → 切 CC 模式 → 打开角色卡工坊 → 切换角色，什么都没改也必弹
 * 「当前角色卡还没保存到角色库」。根因有两条，缺一条都修不掉：
 *   ① 客户端只在「本次页面里载入 / 保存过」时才记 `savedFingerprint`，刷新页面 / 新开会话后它是空的
 *      —— 于是任何一次切卡都判「未保存」。修法：宿主 `cc_getDraft` 回传 `originFingerprint`
 *      （库卡内容指纹），客户端拿它当权威基线。
 *   ② 两半各算一份指纹：库卡文件与草稿槽是两次独立写入，字段顺序不保证一致 —— 用 JSON.stringify
 *      直接序列化会让同一份卡算出两个指纹。修法：`stableJson`（递归按键名排序）+ 忽略
 *      `data.modification_date`，两半逐字节同构。
 *
 * 这个文件钉两件事：算法同构（各种形状/键序/嵌套都要一致）、接线没被拆掉。
 *
 * 运行：node tests/fingerprint-parity.test.mjs   （全绿退出码 0）
 */
import { check, finish, readRepo } from './harness.mjs';

const clientSrc = readRepo('lib/client.js');
const hostSrc = readRepo('lib/index.js');

function grabFunction(name, text) {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码中找不到 function ${name}(`);
  let depth = 0;
  const open = text.indexOf('{', start);
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  throw new Error(`function ${name} 括号不闭合`);
}

// 客户端：stableJson + draftFingerprint
const clientStableJson = new Function(`${grabFunction('stableJson', clientSrc)}; return stableJson;`)();
const clientFingerprint = new Function(
  `${grabFunction('stableJson', clientSrc)}; ${grabFunction('draftFingerprint', clientSrc)}; return draftFingerprint;`,
)();
// 宿主：stableJson + draftContentFingerprint
const hostStableJson = new Function(`${grabFunction('stableJson', hostSrc)}; return stableJson;`)();
const hostFingerprint = new Function(
  `${grabFunction('stableJson', hostSrc)}; ${grabFunction('draftContentFingerprint', hostSrc)}; return draftContentFingerprint;`,
)();

const card = (name, ts = 111) => ({
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name,
    nickname: '',
    description: '设定',
    personality: '安静',
    first_mes: '[时间：2026-01-01 08:00]\n开场。',
    tags: ['甲', '乙'],
    modification_date: ts,
    creation_date: 100,
    character_book: { name: '', scan_depth: 4, entries: [{ name: '旧校舍', keys: ['校舍'] }] },
    extensions: { cc_world: { timeline: '', factions: '' } },
  },
});

// —— ① 两半的 stableJson 输出一致 ——
check('① 两半 stableJson 对同一份卡输出完全相同',
  clientStableJson(card('甲')) === hostStableJson(card('甲')), '');
check('①b 两半 stableJson 都把 undefined 值按「不存在」处理（不出现字面量 undefined）',
  clientStableJson({ a: 1, b: undefined }) === hostStableJson({ a: 1, b: undefined })
  && !clientStableJson({ a: 1, b: undefined }).includes('undefined'), '');

// —— ② 两半指纹输出一致（这是「同一张卡」判定的核心）——
check('② 两半指纹对同一份卡完全相同',
  clientFingerprint(card('甲')) === hostFingerprint(card('甲')), '');
check('②b 字段顺序不同（库卡 vs 草稿槽两次独立写入）→ 指纹仍然相同',
  clientFingerprint(card('甲')) === hostFingerprint(JSON.parse(JSON.stringify(card('甲'), ['data', 'name', 'nickname', 'description', 'personality', 'first_mes', 'tags', 'modification_date', 'creation_date', 'character_book', 'extensions', 'spec_version', 'spec', 'entries', 'keys', 'scan_depth', 'cc_world', 'timeline', 'factions']))), '');
check('②c 只差 data.modification_date → 两半都不变',
  clientFingerprint(card('甲', 111)) === clientFingerprint(card('甲', 999))
  && hostFingerprint(card('甲', 111)) === hostFingerprint(card('甲', 999)), '');
check('②d 内容真变了（description / name / 世界书条目）→ 两半都变',
  clientFingerprint(card('甲')) !== clientFingerprint(card('乙'))
  && hostFingerprint(card('甲')) !== hostFingerprint(card('乙'))
  && clientFingerprint(card('甲')) !== clientFingerprint({ ...card('甲'), data: { ...card('甲').data, description: '设定改' } })
  && hostFingerprint(card('甲')) !== hostFingerprint({ ...card('甲'), data: { ...card('甲').data, description: '设定改' } }), '');

// —— ③ 边界形状：null / 空草稿 / 数组顺序 ——
check('③ null 草稿：两半都给出同一个确定值',
  clientFingerprint(null) === hostFingerprint(null) && clientFingerprint(null) === 'null', '');
check('③b 只有 spec 没有 data：两半一致且不抛错',
  clientFingerprint({ spec: 'chara_card_v3' }) === hostFingerprint({ spec: 'chara_card_v3' }), '');
check('③c 数组顺序是内容（tags 换了顺序 → 指纹变，两半一致）',
  (() => {
    const a = card('甲'); const b = card('甲');
    b.data.tags = ['乙', '甲'];
    return clientFingerprint(a) !== clientFingerprint(b) && hostFingerprint(a) !== hostFingerprint(b);
  })(), '');
check('③d 对象键顺序不是内容（extensions 里两个键换序 → 指纹不变）',
  (() => {
    const a = card('甲'); const b = card('甲');
    b.data.extensions = { cc_world: { factions: '', timeline: '' } };
    return clientFingerprint(a) === clientFingerprint(b) && hostFingerprint(a) === hostFingerprint(b);
  })(), '');
check('③e 中文 / 换行 / 引号等字符两边序列化一致',
  clientFingerprint({ data: { name: '陆昭「测试」\n第二行', description: '含 \\ 反斜杠与\t制表符' } })
  === hostFingerprint({ data: { name: '陆昭「测试」\n第二行', description: '含 \\ 反斜杠与\t制表符' } }), '');

// —— ④ 接线守卫（这些一行被删就悄悄退回 0.25.3 的必弹状态）——
check('④ 宿主 cc_getDraft 回传 originFingerprint',
  /originFingerprint/.test(hostSrc)
  && /originFingerprint = await libraryContentFingerprint\(originId\)/.test(hostSrc), '');
check('④b 宿主算指纹只忽略 data.modification_date（没有整段忽略 data）',
  /delete copy\.data\.modification_date/.test(grabFunction('draftContentFingerprint', hostSrc))
  && !/delete copy\.data\b[^.]/.test(grabFunction('draftContentFingerprint', hostSrc)), '');
check('④c 客户端 pullDraft 把宿主的 originFingerprint 收进 store',
  /store\.setOriginFingerprint\(\(typeof res\.value\.originFingerprint==="string"/.test(clientSrc), '');
check('④d 客户端「未保存」判定会用到 originFingerprint 兜底',
  /function draftIsUnsaved\(draft, currentLibraryId, savedFingerprint, originFingerprint\)/.test(clientSrc)
  && /: String\(originFingerprint\|\|""\)/.test(clientSrc), '');
check('④e 载入 / 导入 / 删除 / 清空时都会把基线一并清掉（不留跨卡残留）',
  (clientSrc.match(/savedFingerprint:null, originFingerprint:null/g) || []).length >= 3, '');

finish();
