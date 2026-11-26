/**
 * 「DeepSeek 专项优化」（0.29.0）回归：ST 正则脚本的唯一真源 + 客户端开关 + i18n。
 *
 * 为什么不测 UI 渲染：设置面板是手写 bundle（`React.createElement`），
 * 这里的价值在「规则本身对不对」与「有没有人在客户端再抄一份词表」这两个守卫上。
 *
 * 运行：node tests/yubagu.test.mjs
 */
import { check, finish, readRepo } from './harness.mjs';
import { buildYubaguScripts, yubaguJson, yubaguFileName, auditYubaguCard, YUBAGU_SCRIPTS, ST_AI_OUTPUT } from '../lib/yubagu.js';

// —— 1) 脚本结构：ST 的 Import 只认这个形状 ——
{
  const scripts = buildYubaguScripts();
  check('①a 恰好 3 条脚本', scripts.length === 3, String(scripts.length));

  const REQUIRED = ['id', 'scriptName', 'findRegex', 'replaceString', 'trimStrings', 'placement',
    'disabled', 'markdownOnly', 'promptOnly', 'runOnEdit', 'substituteRegex', 'minDepth', 'maxDepth'];
  const missing = scripts.flatMap((s) => REQUIRED.filter((k) => !(k in s)).map((k) => `${s.id}.${k}`));
  check('①b 字段齐全（与 ST engine.js 的脚本形状一致）', missing.length === 0, missing.join(', '));

  const badLiteral = scripts.filter((s) => !/^\/.*\/[gm]*$/s.test(s.findRegex)).map((s) => s.id);
  check('①c findRegex 是 /…/flags 字面量', badLiteral.length === 0, badLiteral.join(', '));

  const badReg = [];
  for (const s of scripts) {
    const m = s.findRegex.match(/^\/(.*)\/([a-z]*)$/s);
    try { new RegExp(m[1], m[2]); } catch (e) { badReg.push(`${s.id}: ${e.message}`); }
  }
  check('①d 每条正则都能被 JS 解析', badReg.length === 0, badReg.join(' | '));

  const badPlace = scripts.filter((s) => !Array.isArray(s.placement) || !s.placement.includes(ST_AI_OUTPUT)).map((s) => s.id);
  check('①e placement 都含 AI 输出（2）', badPlace.length === 0, badPlace.join(', '));

  const badFlags = scripts.filter((s) => s.disabled || !s.markdownOnly || !s.promptOnly).map((s) => s.id);
  check('①f 启用且预设安全档位（两个 only 都为 true → 不改聊天记录）', badFlags.length === 0, badFlags.join(', '));

  const ids = scripts.map((s) => s.id);
  check('①g id 唯一', new Set(ids).size === ids.length, ids.join(', '));
}

// —— 2) 命中 / 误伤：宁漏不误 ——
{
  const run = (text) => {
    const hits = [];
    for (const s of buildYubaguScripts()) {
      const m = s.findRegex.match(/^\/(.*)\/([a-z]*)$/s);
      const re = new RegExp(m[1], m[2]);
      if (re.test(text)) hits.push(s.id);
    }
    return hits;
  };

  const mustHit = [
    '我记下了', '行，我认', '认得实', '这话我收下了', '你自己掂量', '收不回去',
    '这句话稳', '没接你那句话', '他的声音比刚才稳',
  ];
  const missed = mustHit.filter((s) => run(s).length === 0);
  check('②a 清单里的核心短语能命中', missed.length === 0, missed.join(' | '));

  const mustMiss = [
    '我跟他一起去',        // 「我跟」不是「你去，我跟」
    '这杯水放得很稳',      // 「稳」单独成词会误伤
    '他稳住了',
    '他比昨天轻了两斤',    // 裸比较属于客观描述
    '我认错人了',
    '他接住了话头',
    '声音很轻',
  ];
  const falsePositives = mustMiss.filter((s) => run(s).length > 0).map((s) => `${s} → ${run(s).join(',')}`);
  check('②b 正常句子不误伤', falsePositives.length === 0, falsePositives.join(' | '));
}

// —— 3) 幂等性：决定「正则会不会打断 DeepSeek 的上下文缓存」——
// DeepSeek 的硬盘缓存按**前缀单元**完整匹配（官方《上下文硬盘缓存》）。ST 每轮重建 prompt 时
// 对整段历史重跑一遍正则；只有「同一条历史消息每轮被改成同一个结果」时，前缀才逐 token 稳定，
// 缓存单元才能继续命中。所以这里钉的就是 f(f(x)) === f(x)。
{
  const apply = (script, text) => {
    const m = script.findRegex.match(/^\/(.*)\/([a-z]*)$/s);
    return text.replace(new RegExp(m[1], m[2]), script.replaceString || '');
  };
  const samples = [
    ['他点头。我记下了', '还行，我认。声音比刚才稳了点', '这句话稳'],
    ['Nothing to clean here.', '他推门进来，把伞放在门口。', '她笑了，笑得很轻。'],
    ['我记住了。你别催。', '', '没接你那句话，他把杯子放下。'],
  ];
  const unstable = [];
  for (const script of buildYubaguScripts()) {
    for (const s of samples.flat()) {
      const once = apply(script, s);
      const twice = apply(script, once);
      if (once !== twice) unstable.push(`${script.id}: ${JSON.stringify(s).slice(0, 40)}`);
    }
  }
  check('③e 替换是幂等的（同一历史每轮改成同一个结果 → 前缀稳定）', unstable.length === 0, unstable.join(' | '));

  // 替换字符串里不许出现任何会变的宏/占位（那才会每轮不同 → 前缀全变 → 缓存大面积失效）。
  const VOLATILE = ['{{random', '{{pick', '{{time', '{{date', '{{idle', '{{newline}}'];
  const volatile = buildYubaguScripts()
    .filter((s) => typeof s.replaceString === 'string' && VOLATILE.some((v) => s.replaceString.includes(v)))
    .map((s) => s.id);
  check('③f replaceString 不含随机/时间类宏（否则每轮结果不同，缓存必失效）', volatile.length === 0, volatile.join(', '));

  // 深度限制对缓存是**持续**破坏：同一条历史消息的 depth 每轮 +1，越过 maxDepth 时清理状态翻转，
  // 那一轮起该消息之后的前缀全变。所以导出必须不设 maxDepth（null = 全部范围、与深度无关）。
  const depthLimited = buildYubaguScripts().filter((s) => s.maxDepth !== null && s.maxDepth !== undefined).map((s) => s.id);
  check('③g 不设 maxDepth（否则每条消息跨过边界时都会翻转一次，反复打掉缓存）', depthLimited.length === 0, depthLimited.join(', '));
}

// —— 4) 导出物：JSON 可解析、深拷贝不串味 ——
{
  let parsed = null;
  let err = '';
  try { parsed = JSON.parse(yubaguJson()); } catch (e) { err = e.message; }
  check('③a 导出 JSON 可被 JSON.parse', !!parsed && err === '', err);
  check('③b 导出内容与真源条数一致', Array.isArray(parsed) && parsed.length === YUBAGU_SCRIPTS.length, '');

  const a = buildYubaguScripts();
  a[0].scriptName = '手滑改掉';
  check('③c buildYubaguScripts 是深拷贝（改返回值不动真源）', buildYubaguScripts()[0].scriptName !== '手滑改掉', '');

  const name = yubaguFileName(new Date('2026-01-02T03:04:05Z'));
  check('③d 文件名带日期、以 .json 结尾', name === 'cc-studio-yubagu-2026-01-02.json', name);
}

// —— 4) 源码守卫：一份真源、开关默认关、双语键齐全 ——
{
  const host = readRepo('lib/index.js');
  check('④a 宿主注册了 cc_yubaguScripts 端点', /case "cc_yubaguScripts":\{/.test(host), '');
  check('④b 宿主从 lib/yubagu.js 取规则（不手抄）', /from "\.\/yubagu\.js"/.test(host) && /yubaguJson\(\)/.test(host), '');

  const client = readRepo('lib/client.js');
  check('④c 客户端走宿主端点导出', /rpc\("cc_yubaguScripts"/.test(client), '');
  check('④d 客户端暴露 setDeepseekTuning / exportYubaguScripts',
    /setDeepseekTuning:setDeepseekTuning/.test(client) && /exportYubaguScripts:exportYubaguScripts/.test(client), '');
  check('④e 默认关（读取时只在显式 true 才开）', /deepseekTuning:\s*s\.deepseekTuning===true/.test(client), '');
  check('④f 默认值写进空设置', /deepseekTuning:false/.test(client), '');
  check('④g 设置持久化包含该键', /deepseekTuning:\s*!!state\.deepseekTuning/.test(client), '');
  check('④h 导出弹层按开关渲染', /s\.deepseekTuning \? h\(/.test(client), '');

  // 客户端不能有第二份词表：手写 bundle 不能 import 本仓模块，一旦有人图省事内联，两边就会漂。
  const INLINED = ['我记下了', '我认了', '这话我收下了', '比之前的都'];
  const leaked = INLINED.filter((s) => client.includes(s));
  check('④i 客户端未内联鱼八股词表（真源只在 lib/yubagu.js）', leaked.length === 0, leaked.join(', '));

  const zhKeys = ['settings.deepseek.title', 'settings.deepseek.param1', 'settings.deepseek.export',
    'export.yubagu.title', 'export.yubagu.hint'];
  const enKeys = zhKeys;
  const zhBlock = client.slice(client.indexOf('var zh='), client.indexOf('var en='));
  const enBlock = client.slice(client.indexOf('var en='), client.indexOf('function h(type,props)'));
  const missZh = zhKeys.filter((k) => !zhBlock.includes(`"${k}":`));
  const missEn = enKeys.filter((k) => !enBlock.includes(`"${k}":`));
  check('④j 中文词表键齐全', missZh.length === 0, missZh.join(', '));
  check('④k 英文词表键齐全', missEn.length === 0, missEn.join(', '));

  const pkg = JSON.parse(readRepo('package.json'));
  check('④l 测试已挂进 npm test', String(pkg.scripts.test).includes('tests/yubagu.test.mjs'), '');
}

// —— 5) 制卡期体检：扫哪些字段、报什么等级、哪些刻意不扫 ——
{
  const mk = (data) => ({ spec: 'chara_card_v3', spec_version: '3.0', data: Object.assign({ name: 't' }, data) });

  const dirty = mk({
    first_mes: '他点了下头。我记下了。',
    mes_example: '<START>\n{{user}}: 你听见了吗\n{{char}}: 还行，我认。他的声音比刚才稳。',
  });
  const r1 = auditYubaguCard(dirty);
  check('⑤a 开场里的自我标记能命中', r1.count >= 1 && r1.hits.some((h) => h.where === 'first_mes'), JSON.stringify(r1.hits));
  check('⑤b 示例里的鱼八股也能命中（与 unsettled-hook 相反，这里必须扫 mes_example）',
    r1.hits.some((h) => h.where === 'mes_example'), r1.hits.map((h) => h.where).join(','));
  check('⑤c 产出的 issue 是 warning + code=yubagu', r1.issues.length === 1
    && r1.issues[0].level === 'warning' && r1.issues[0].code === 'yubagu', JSON.stringify(r1.issues[0] || {}));
  check('⑤d 文案里写清了「不阻塞导出」', /不阻塞导出/.test(r1.message), '');

  const clean = mk({ first_mes: '他推门进来，把伞放在门口。', mes_example: '<START>\n{{char}}: 坐吧。' });
  check('⑤e 干净卡不报', auditYubaguCard(clean).count === 0, '');

  // description 是设定文档：出现「我记下了」可能是在引用别人的话，刻意不扫（误报高）。
  const inDesc = mk({ description: '他常说「我记下了」。', first_mes: '他推门进来。' });
  check('⑤f 不扫 description（设定文档误报高）', auditYubaguCard(inDesc).count === 0, '');

  // 2 字短语不进体检：否则「我认错人」「不催促」会被报成问题。
  const shortWords = mk({ mes_example: '{{char}}: 我认错人了，不催促你。' });
  check('⑤g 2 字短语不做包含匹配（我认错人 / 不催促 不误报）', auditYubaguCard(shortWords).count === 0, '');

  // 宿主接线：默认不跑，只有客户端显式传 true 才动态加载。
  const host = readRepo('lib/index.js');
  check('⑤h 宿主按开关动态加载（关着时不 import）',
    /if\(args\.deepseekTuning === true\)\{/.test(host) && /await import\("\.\/yubagu\.js"\)/.test(host), '');
  check('⑤i validateCard 接受可选体检函数并在没有时跳过',
    /function validateCard\(card, extras\)/.test(host) && /extras\.auditYubagu/.test(host), '');
  check('⑤j 客户端校验时把开关一起发上去',
    /rpc\("validate", \{ card: state\.draft, deepseekTuning: !!state\.deepseekTuning \}\)/.test(readRepo('lib/client.js')), '');
  check('⑤k 报告里有独立的「文风」分组', /workshop\.audit\.style/.test(readRepo('lib/client.js')), '');
}

// —— 6) 可删除性：标记成对、清单在、日后能安全整块移除 ——
{
  const src = readRepo('lib/yubagu.js');
  check('⑥a 真源文件头带 DEEPSEEK-TUNING 标记', src.includes('DEEPSEEK-TUNING'), '');
  check('⑥b 真源文件里有「安全删除」清单', src.includes('【安全删除】'), '');

  const MUST_LIST = ['lib/index.js', 'lib/client.js', 'tests/yubagu.test.mjs',
    'scripts/e2e-smoke.mjs', 'docs/deepseek-yubagu-tuning.md'];
  const notListed = MUST_LIST.filter((f) => !src.includes(f));
  check('⑥c 删除清单覆盖所有落点', notListed.length === 0, notListed.join(', '));

  // 主干文件里必须留标记，否则日后 grep 不到就没法安全删。
  const marked = ['lib/index.js', 'lib/client.js', 'scripts/e2e-smoke.mjs', 'package.json'];
  const unmarked = marked.filter((f) => {
    const text = f === 'package.json' ? readRepo(f) : readRepo(f);
    // package.json 不能写注释：它的「标记」是测试链里的文件名本身。
    return f === 'package.json'
      ? !text.includes('tests/yubagu.test.mjs')
      : !text.includes('DEEPSEEK-TUNING');
  });
  check('⑥d 主干落点都带标记（package.json 以测试链文件名作标记）', unmarked.length === 0, unmarked.join(', '));

  // e2e 的那条断言也要带标记，否则删功能时会留下一条必然失败的 smoke。
  check('⑥e e2e 断言带标记', readRepo('scripts/e2e-smoke.mjs').includes('[DEEPSEEK-TUNING]'), '');
}

finish();
