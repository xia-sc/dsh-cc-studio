/**
 * CC 模式探测回归测试（不随插件发布，files 未包含 tests）。
 *
 * 背景（用户报告的 bug）：首次切到 CC 模式时胶囊不出现，只有刷新页面或切换会话才出现。
 * 根因是探测逻辑读错了字段，且 effect 依赖数组永不变化：
 *   · 会话的预设实际在 session.projectionValues.agentPreset（dsh 官方 UI 亦如此读取），
 *     而旧代码读 sess.preset / presetId / agentPreset / mode —— 全部取不到值；
 *   · 于是 presetOfCurrent 恒为 null，effect 只在 [currentId, presetOfCurrent] 变化时重跑，
 *     切换模式既不改变 currentId 也不改变（恒为 null 的）presetOfCurrent → 永不重新探测。
 *   · 旧代码里补偿用的 900ms 重试还走的是带 5s 节流的 checkIsCcMode，被节流直接吞掉。
 * 另：旧 DOM 兜底只扫 button，而运行中会话的预设标签渲染成 <span>，故对运行中会话完全失效。
 *
 * 运行：node tests/cc-detection.test.mjs   （全绿退出码 0）
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 从源码里摘出真实实现执行（client.js 是 window.__ModuleLoader__ 外壳，无法直接 import）
function grabFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码中找不到 function ${name}(`);
  let depth = 0;
  const open = src.indexOf('{', start);
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`function ${name} 括号不闭合`);
}
const CC_ID = (src.match(/var CC_PRESET_ID\s*=\s*"([^"]+)"/) || [])[1];
if (!CC_ID) { console.log('FAIL  源码中找不到 CC_PRESET_ID'); process.exit(1); }

// —— 1) ccPresetIdOf：必须从 projectionValues 读到预设，这正是旧代码的 bug ——
const ccPresetIdOf = new Function(`${grabFunction('ccPresetIdOf')}; return ccPresetIdOf;`)();
{
  check('读取 projectionValues.agentPreset（旧代码漏掉的字段）',
    ccPresetIdOf({ projectionValues: { agentPreset: 'cc' } }) === 'cc',
    String(ccPresetIdOf({ projectionValues: { agentPreset: 'cc' } })));
  check('非 CC 预设也如实返回', ccPresetIdOf({ projectionValues: { agentPreset: 'standard' } }) === 'standard', '');
  check('projectionValues 缺失 → null', ccPresetIdOf({}) === null, String(ccPresetIdOf({})));
  check('agentPreset 非字符串 → null', ccPresetIdOf({ projectionValues: { agentPreset: 42 } }) === null, '');
  check('空字符串 → null（不把空串当预设）', ccPresetIdOf({ projectionValues: { agentPreset: '' } }) === null, '');
  check('session 为 null/undefined 安全', ccPresetIdOf(null) === null && ccPresetIdOf(undefined) === null, '');
  check('兼容旧字段作为兜底', ccPresetIdOf({ preset: 'cc' }) === 'cc', String(ccPresetIdOf({ preset: 'cc' })));
}

// —— 2) ccModeFromDom：只认预设芯片，且排除自身 UI、忽略不可见元素 ——
// 注意：decideCcMode 依赖模块级常量 CC_PRESET_ID，摘出函数时需一并注入其作用域。
const decideCcMode = new Function(`var CC_PRESET_ID=${JSON.stringify(CC_ID)}; ${grabFunction('decideCcMode')}; return decideCcMode;`)();
function stubDom(buttons) {
  globalThis.document = {
    querySelectorAll(sel) {
      // 被测实现只用 button[aria-haspopup="menu"] 这一个选择器
      if (sel !== 'button[aria-haspopup="menu"]') return [];
      return buttons.filter((b) => b.menuTrigger !== false);
    },
  };
}
function btn(text, { visible = true, ours = false, menuTrigger = true } = {}) {
  return {
    textContent: text,
    offsetParent: visible ? {} : null,
    menuTrigger,
    closest(sel) { return ours && sel === '[data-dsh-cc-studio]' ? {} : null; },
  };
}
const ccModeFromDom = new Function(`${grabFunction('ccModeFromDom')}; return ccModeFromDom;`)();
{
  stubDom([btn('CC 模式')]);
  check('芯片显示 CC 模式 → true', ccModeFromDom('CC 模式') === true, '');
  stubDom([btn('Standard mode')]);
  check('芯片显示其它模式 → false', ccModeFromDom('CC 模式') === false, '');
  stubDom([btn('CC 模式', { visible: false })]);
  check('不可见元素不算 → false', ccModeFromDom('CC 模式') === false, '');
  stubDom([btn('CC 模式', { ours: true })]);
  check('排除本插件自身 UI → false', ccModeFromDom('CC 模式') === false, '');
  stubDom([btn('DeepSeek V4.1 Flash (CC) Default')]);
  check('模型选择器（含 "(CC)"）不误判', ccModeFromDom('CC 模式') === false, '');
  stubDom([]);
  check('无按钮 → false', ccModeFromDom('CC 模式') === false, '');
  check('label 为空 → false（避免空串匹配一切）', ccModeFromDom('') === false, '');
}

// —— 3) decideCcMode：判定表（含「未知」不发假结论） ——
{
  // 会话投影权威
  check('投影=cc → true', decideCcMode('cc', false, true, false) === true, '');
  check('投影=CC 大小写不敏感 → true', decideCcMode('CC', false, true, false) === true, '');
  check('投影=standard → false（即使 DOM 说 CC）', decideCcMode('standard', true, true, true) === false, '');
  // 无会话（新会话页）：芯片是权威
  check('无会话 + 芯片 CC → true', decideCcMode(null, true, false, false) === true, '');
  check('无会话 + 芯片非 CC → false', decideCcMode(null, false, false, true) === false, '');
  // 有会话但投影未到：未知，不能翻转
  check('有会话 + 投影未知 + 非 CC → null（交给 RPC，不误关）', decideCcMode(null, false, true, false) === null, '');
  check('有会话 + 投影未知 + 已是 CC → true（保持，不闪烁）', decideCcMode(null, false, true, true) === true, '');
  check('有会话 + 投影未知 + 芯片 CC → true', decideCcMode(null, true, true, false) === true, '');
}

// —— 4) 源码级守卫：这些回归必须被钉住 ——
{
  check('共享一个 hook（不再两份重复实现）',
    (src.match(/function useCcPreset\s*\(/g) || []).length === 1 &&
    (src.match(/= useCcPreset\(store, props, t\)/g) || []).length === 2,
    `def=${(src.match(/function useCcPreset\s*\(/g) || []).length} call=${(src.match(/= useCcPreset\(store, props, t\)/g) || []).length}`);

  // 旧的两份 detectCc 内联实现必须消失
  check('旧的 detectCc 内联实现已移除', !/function detectCc\s*\(/.test(src), '');
  check('不再有 presetOfCurrent 变量（错误字段的来源）', !/var presetOfCurrent/.test(src), '');

  // DOM 探测必须用精确选择器，而非全量 button 扫描
  check('DOM 探测使用 button[aria-haspopup="menu"]',
    /querySelectorAll\('button\[aria-haspopup="menu"\]'\)/.test(src), '');
  check('不再全量扫描 button', !/querySelectorAll\('button'\)/.test(src), '');

  // 补偿重试必须 force，否则被 5s 节流吞掉（这是旧实现失效的第二个原因）
  check('重试调用带 force 参数', /checkIsCcMode\(currentId, true\)/.test(src), '');
  check('存在多次延迟重试', /\[1200,3000\]/.test(src), '');

  // 新会话页切换芯片不会改变 current/preset，必须有轮询兜底
  check('存在本地轮询兜底（捕获芯片切换）', /setInterval\(function\(\)\{ try\{ evaluate\(\); \}/.test(src), '');

  // 预设名进词表（否则触发「UI 层无硬编码中文」守卫）
  check('preset.ccLabel 在 zh 词表', /"preset\.ccLabel":"CC 模式"/.test(src.slice(src.indexOf('var zh='), src.indexOf('var en='))), '');
  check('preset.ccLabel 在 en 词表', /"preset\.ccLabel":"CC 模式"/.test(src.slice(src.indexOf('var en='), src.indexOf('function h(type,props)'))), '');
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail === undefined || r.detail === '' ? '' : '— ' + String(r.detail).slice(0, 100)}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
