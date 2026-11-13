/**
 * CCv3 规范核心 + 适配层注册表回归测试（0.13.0，不随插件发布，files 未含 tests）。
 *
 * 这一层是「CCv3 规范核心（lib/compat/core.js）+ 目标适配层（lib/compat/adapters/*）」
 * 的纯函数测试：不启动 dsh、不写盘、不需要隔离 HOME。
 *
 * 覆盖：
 * ① 装饰器解析/校验（CCv3 SPEC_V3「Decorators」；截图里的 @@position 1 / @@activate true 必须被判非法）
 * ② V2/V1 → CCv3 升级（从 lib/index.js 搬来，行为必须与 0.12.4 逐字一致）
 * ③ V2 回填投影（PNG chara 块）与装饰器摘除
 * ④ PNG 双块 / CHARX 容器往返
 * ⑤ 目标注册表：默认目标 = sillytavern；未知目标回退默认；renderBook 两种形态
 *
 * 运行：node tests/compat-core.test.mjs   （全绿退出码 0）
 */
import * as compat from '../lib/compat/index.js';

import { check, finish } from './harness.mjs';

// —— 样本：一张带 V3 独有字段、卡内世界书、装饰器的卡 ——
const CARD = {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: '锁天司·探针', nickname: 'NICK', description: '简介', personality: '性格', scenario: '场景',
    first_mes: '开场', mes_example: '示例', creator_notes: '注释', system_prompt: 'SYS', post_history_instructions: 'PHI',
    alternate_greetings: ['备选一'], group_only_greetings: ['群聊开场'], tags: ['a', 'b'], creator: 'tester',
    character_version: '1.0', creator_notes_multilingual: { zh: '中文注' }, source: ['https://example.com'],
    creation_date: 1700000000, modification_date: 1700000001,
    assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
    extensions: { cc_world: { timeline: 'T' } },
    character_book: {
      name: '卡内书', description: '', scan_depth: 4, token_budget: 1200, recursive_scanning: false, extensions: {},
      entries: [
        { keys: ['年表'], content: '@@position after_desc\n【三千年前】天门开。', enabled: true, insertion_order: 0, name: '年表', id: 1, extensions: {} },
        { keys: ['锁道'], content: '@@activate\n【锁道】以人之所有为一「锁」。', enabled: true, insertion_order: 1, constant: true, name: '锁道', id: 2, extensions: {} },
      ],
    },
  },
};

// ——————————————————————————————————————————————————————————————
// ① 装饰器解析 / 校验
// ——————————————————————————————————————————————————————————————
{
  const parsed = compat.parseDecorators('@@position 1\n@@depth 1\n@@activate true\n\n丹阁七进的规矩');
  check('① 截图内容：三行装饰器全部解析出来，正文从空行后开始',
    parsed.decorators.length === 3
    && parsed.decorators[0].name === 'position' && parsed.decorators[0].value === '1'
    && parsed.decorators[1].name === 'depth' && parsed.decorators[1].value === '1'
    && parsed.decorators[2].name === 'activate' && parsed.decorators[2].value === 'true'
    && parsed.body === '丹阁七进的规矩',
    JSON.stringify({ n: parsed.decorators.length, body: parsed.body }));

  check('①b 没有装饰器时原样返回、body 不动', (() => {
    const p = compat.parseDecorators('普通正文\n第二行');
    return p.decorators.length === 0 && p.body === '普通正文\n第二行' && !p.hasDecorators;
  })(), '');

  check('①c 装饰器后的空行被收掉（规范要求 trim）', compat.parseDecorators('@@activate\n\n正文').body === '正文', '');

  check('①d @@@ 前缀被标记为 fallback（规范里的 fallback 装饰器）', (() => {
    const p = compat.parseDecorators('@@@activate\n正文');
    return p.decorators.length === 1 && p.decorators[0].name === 'activate' && p.decorators[0].fallback === true;
  })(), '');

  const bad = compat.validateDecorators('@@position 1\n@@depth 1\n@@activate true');
  check('①e 截图写法被校验为非法：@@position 值非法 + @@activate 带值 + @@depth 合法',
    bad.ok === false
    && bad.issues.some(i => i.code === 'decorator-position-value')
    && bad.issues.some(i => i.code === 'decorator-value-not-allowed')
    && !bad.issues.some(i => i.code === 'decorator-number-value'),
    JSON.stringify(bad.issues.map(i => i.code)));

  const good = compat.validateDecorators('@@position after_desc\n@@depth 4\n@@activate\n@@role system');
  check('①f 合法装饰器全过（position after_desc / depth 4 / activate 无值 / role system）',
    good.ok === true && good.issues.length === 0, JSON.stringify(good.issues));

  const roleBad = compat.validateDecorators('@@role narrator');
  check('①g @@role 非法值被拦（narrator 不是 assistant/system/user）',
    roleBad.ok === false && roleBad.issues.some(i => i.code === 'decorator-role-value'), '');

  const numBad = compat.validateDecorators('@@depth -1');
  check('①h @@depth 负数被拦', numBad.ok === false && numBad.issues.some(i => i.code === 'decorator-number-value'), '');
}

// ——————————————————————————————————————————————————————————————
// ② V2/V1 → CCv3 升级（与 0.12.4 行为一致）
// ——————————————————————————————————————————————————————————————
{
  const v2 = {
    spec: 'chara_card_v2', spec_version: '2.0',
    name: 'V2 卡', description: '顶层描述', first_mes: '顶层开场', creatorcomment: '顶层注释', talkativeness: 0.7, fav: true, tags: 'a, b',
    data: { name: 'V2 卡', description: '', personality: 'p', scenario: 's', first_mes: '', mes_example: '', tags: ['x'], extensions: {} },
  };
  const up = compat.upgradeCardToV3(v2);
  check('② V2 → CCv3：spec/spec_version 改写、from 报出来',
    up.card.spec === 'chara_card_v3' && up.card.spec_version === '3.0' && up.from === 'chara_card_v2', up.from);
  check('②b 顶层 V1 平铺字段只在 data 缺值时补（不覆盖 data 已有值）',
    up.card.data.description === '' && up.card.data.first_mes === '' && up.card.data.creator_notes === '顶层注释', '');
  check('②c tags 逗号串变数组；talkativeness/fav 落进 extensions',
    up.card.data.tags.join(',') === 'x' && up.card.data.extensions.talkativeness === 0.7 && up.card.data.extensions.fav === true, '');
  check('②d 深拷贝：入参没被改', v2.spec === 'chara_card_v2' && v2.data.creator_notes === undefined, '');
  const v1 = compat.upgradeCardToV3({ name: 'V1 卡', description: 'd', creatorcomment: 'v1 注释' });
  check('②e 纯 V1 包成 data，from=chara_card_v1', v1.from === 'chara_card_v1' && v1.card.data.name === 'V1 卡', v1.from);
  check('②f 本来就是 V3 时原样放行（同一个对象、from=null）', (() => {
    const out = compat.upgradeCardToV3(CARD);
    return out.from === null && out.card === CARD;
  })(), '');
  let err = '';
  try { compat.upgradeCardToV3({ foo: 1 }); } catch (e) { err = e.message; }
  check('②g 无名称 → 可读错误', err.indexOf('没有名称') >= 0, err);
}

// ——————————————————————————————————————————————————————————————
// ③ V2 回填投影（PNG chara 块）与装饰器摘除
// ——————————————————————————————————————————————————————————————
{
  check('③ stripDecorators：开头连续 @@ 行与遗留空行一起摘掉', compat.stripDecorators('@@position after_desc\n@@depth 4\n\n正文') === '正文', '');
  check('③b 正文中间的 @@ 不动（只摘开头连续段）',
    compat.stripDecorators('正文\n@@activate\n第二行') === '正文\n@@activate\n第二行', '');

  const p = compat.stV2Projection(CARD);
  check('③c 投影是诚实的 V2 卡（spec/spec_version）', p.spec === 'chara_card_v2' && p.spec_version === '2.0', p.spec);
  const v3Only = ['nickname', 'creator_notes_multilingual', 'source', 'group_only_greetings', 'assets', 'creation_date', 'modification_date'];
  check('③d V3 独有字段一个都不进 V2 投影', v3Only.every(k => p.data[k] === undefined), v3Only.filter(k => p.data[k] !== undefined).join(','));
  check('③e 卡内世界书跟着走且装饰器被摘掉（规范：回填 V2 要移除装饰器）',
    p.data.character_book.entries[0].content === '【三千年前】天门开。' && p.data.character_book.entries[1].content.indexOf('@@') < 0, '');
  check('③f 投影不改入参', CARD.data.nickname === 'NICK' && CARD.data.character_book.entries[0].content.startsWith('@@'), '');
}

// ——————————————————————————————————————————————————————————————
// ④ PNG 双块 / CHARX 容器往返
// ——————————————————————————————————————————————————————————————
{
  const png = compat.buildPngWithCard(CARD);
  check('④ 是合法 PNG（签名 + IEND）',
    png[0] === 0x89 && png[1] === 0x50 && String.fromCharCode.apply(null, Array.from(png.slice(-8, -4))) === 'IEND', '');
  // 简易块扫描（测试自己解，不用被测代码）
  const chunks = [];
  let off = 8;
  while (off + 8 <= png.length) {
    const len = (png[off] << 24) | (png[off + 1] << 16) | (png[off + 2] << 8) | png[off + 3];
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    if (off + 8 + len + 4 > png.length) break;
    if (type === 'tEXt') {
      const data = png.slice(off + 8, off + 8 + len);
      const zero = data.indexOf(0);
      const kw = String.fromCharCode.apply(null, Array.from(data.slice(0, zero)));
      const b64 = String.fromCharCode.apply(null, Array.from(data.slice(zero + 1)));
      chunks.push({ keyword: kw, json: JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) });
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  check('④b 卡块恰好两个：chara（V2 回填）+ ccv3（规范 MUST），chara 在前',
    chunks.map(c => c.keyword).join(',') === 'chara,ccv3', chunks.map(c => c.keyword).join(','));
  const byKw = Object.fromEntries(chunks.map(c => [c.keyword, c.json]));
  check('④c ccv3 是原卡（V3 独有字段原样）', byKw.ccv3.spec === 'chara_card_v3' && byKw.ccv3.data.nickname === 'NICK', '');
  check('④d chara 是 V2 投影（V3 字段缺席、装饰器已摘）',
    byKw.chara.spec === 'chara_card_v2' && byKw.chara.data.nickname === undefined && byKw.chara.data.character_book.entries[0].content.indexOf('@@') < 0, '');
  check('④e 读回来按载荷 spec 判、优先 ccv3', compat.extractCardFromPngBytes(png).spec === 'chara_card_v3', '');

  const zip = compat.buildZipCharx(CARD);
  const entries = compat.parseZipEntries(zip);
  const cardEntry = entries.find(e => e.name === 'card.json');
  check('④f CHARX 往返：ZIP 里有 card.json，内容就是原卡',
    !!cardEntry && JSON.parse(new TextDecoder().decode(cardEntry.data)).data.name === '锁天司·探针', '');
}

// ——————————————————————————————————————————————————————————————
// ⑤ 目标注册表 / 适配器
// ——————————————————————————————————————————————————————————————
{
  const ids = compat.listTargets().map(t => t.id);
  check('⑤ 注册表含 sillytavern 与 ccv3（新增目标只需加文件 + 注册）',
    ids.indexOf('sillytavern') >= 0 && ids.indexOf('ccv3') >= 0, ids.join(','));
  check('⑤b 默认目标是 sillytavern（历史行为不变）', compat.DEFAULT_TARGET_ID === 'sillytavern', compat.DEFAULT_TARGET_ID);
  check('⑤c 未知目标回退默认（不抛错）', compat.getTarget('nope') === null && compat.renderBook('nope', { data: { name: 'x', entries: [] } }).filename === 'x.json', '');

  const stBook = compat.renderBook('sillytavern', { data: { name: '锁天司·共享设定', entries: [] } });
  check('⑤d ST 世界书：顶层只有 entries、文件名 = 书名 + .json',
    Object.keys(JSON.parse(stBook.content)).join(',') === 'entries' && stBook.filename === '锁天司·共享设定.json', stBook.filename);
  const ccv3Book = compat.renderBook('ccv3', { data: { name: '锁天司·共享设定', entries: [] } });
  check('⑤e CCv3 世界书：{spec:lorebook_v3,data}、文件名 .lorebook.json',
    JSON.parse(ccv3Book.content).spec === 'lorebook_v3' && ccv3Book.filename === '锁天司·共享设定.lorebook.json', ccv3Book.filename);

  const stCard = compat.renderCard('sillytavern', CARD, { world: '锁天司·共享设定' });
  check('⑤f ST 卡导出副本写 data.extensions.world，且不污染原卡',
    stCard.card.data.extensions.world === '锁天司·共享设定' && CARD.data.extensions.world === undefined, '');
  check('⑤g CCv3 卡导出副本不写平台绑定', compat.renderCard('ccv3', CARD, { world: 'x' }).card.data.extensions.world === undefined, '');
  check('⑤h 能力矩阵：ST 不认 lorebook_v3 / use_regex / priority；CCv3 认',
    compat.getTarget('sillytavern').capabilities.lorebookV3 === false
    && compat.getTarget('sillytavern').capabilities.useRegex === false
    && compat.getTarget('sillytavern').capabilities.priority === false
    && compat.getTarget('ccv3').capabilities.lorebookV3 === true, '');
}

// ——————————————————————————————————————————————————————————————
// ⑥ 工具：世界书文件名 sanitize / 换行归一
// ——————————————————————————————————————————————————————————————
{
  check('⑥ sanitizeWorldName 替换 ST 文件名非法字符', compat.sanitizeWorldName('a/b:c*?"<>|') === 'a_b_c______', JSON.stringify(compat.sanitizeWorldName('a/b:c*?"<>|')));
  check('⑥b 空书名回退 shared-lorebook', compat.sanitizeWorldName('   ') === 'shared-lorebook', '');
  check('⑥c normalizeNewlines 把 CRLF/CR 归一成 LF', compat.normalizeNewlines('a\r\nb\rc') === 'a\nb\nc', '');
}

finish();
