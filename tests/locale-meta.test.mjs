/**
 * locale 元数据回归测试（不随插件发布，files 未含 tests）。
 *
 * 背景：插件管理器与设置页的插件行只从**导出的** `locale/*.json` 读 `meta.title` /
 * `meta.description`（宿主 readPluginMeta，不需要激活插件）。缺这两份文件时，英文界面会
 * 回退到 package.json 的中文 description，中文行也拿不到「角色卡工坊」这个标题。
 *
 * 这里的守卫钉三件事：
 * 1. 两份 locale 都是合法 JSON，`meta.title` / `meta.description` 非空，且中英不互相复制；
 * 2. `package.json` 的 `exports` 与 `files` 都带上 `locale/*.json`（漏一个 = 本地看着正常、发布后回退）；
 * 3. locale 文件**只放 meta**：UI 词表的唯一真源是 `lib/client.js` 的 `zh` / `en`（经
 *    `ctx.locale.register` 生效），往 locale 里再抄一份就会漂移成第三份词表。
 *
 * 运行：node tests/locale-meta.test.mjs   （全绿退出码 0）
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

import { check, finish } from './harness.mjs';

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function readLocale(lang) {
  const file = join(root, 'locale', `${lang}.json`);
  if (!existsSync(file)) return { file, data: null, error: 'missing file' };
  try {
    return { file, data: JSON.parse(readFileSync(file, 'utf8')), error: null };
  } catch (error) {
    return { file, data: null, error: error && error.message ? error.message : String(error) };
  }
}

const zh = readLocale('zh');
const en = readLocale('en');

check('locale/zh.json 存在且是合法 JSON', zh.data !== null, zh.error || '');
check('locale/en.json 存在且是合法 JSON', en.data !== null, en.error || '');

for (const [lang, entry] of [['zh', zh], ['en', en]]) {
  const meta = entry.data && typeof entry.data.meta === 'object' && entry.data.meta !== null ? entry.data.meta : null;
  const title = meta ? meta.title : undefined;
  const description = meta ? meta.description : undefined;
  check(`locale/${lang}.json 有非空 meta.title`, typeof title === 'string' && title.trim().length > 0, String(title));
  check(`locale/${lang}.json 有非空 meta.description`, typeof description === 'string' && description.trim().length > 0, String(description));
  // 插件行是单行展示：标题过长会被截断，这里给个上限提醒（不是硬性展示规则）。
  check(`locale/${lang}.json 的 meta.title 不超过 40 字符`, typeof title === 'string' && title.length <= 40, typeof title === 'string' ? title.length : '');
  // 详情页只认 .md / .markdown；声明了 detail 就必须真的存在（缺文件是报错，不是回退 README）。
  if (meta && meta.detail !== undefined) {
    check(`locale/${lang}.json 的 meta.detail 指向包内 .md 文件`,
      typeof meta.detail === 'string' && /\.(md|markdown)$/i.test(meta.detail) && existsSync(resolve(root, meta.detail)),
      String(meta.detail));
  }
}

if (zh.data && en.data) {
  const zhMeta = zh.data.meta || {};
  const enMeta = en.data.meta || {};
  check('中英标题不相同（防止复制粘贴后两边都显示中文）', zhMeta.title !== enMeta.title, `${zhMeta.title} / ${enMeta.title}`);
  check('中英描述不相同（防止复制粘贴后两边都显示中文）', zhMeta.description !== enMeta.description, '');
  // 英文标题按 sentence case：首字母大写即可，不要求强制小写其余词（专有名词必须保留）。
  const enTitle = typeof enMeta.title === 'string' ? enMeta.title : '';
  check('英文 meta.title 以大写字母开头（sentence case）', /^[A-Z]/.test(enTitle), enTitle);
  check('中文 meta.title 含中文字符（不是英文兜底）', /[\u4e00-\u9fff]/.test(typeof zhMeta.title === 'string' ? zhMeta.title : ''), '');
}

// —— 单一真源：locale 文件只放 meta，UI 词表留在 lib/client.js ——
for (const [lang, entry] of [['zh', zh], ['en', en]]) {
  if (!entry.data) continue;
  const extra = Object.keys(entry.data).filter((key) => key !== 'meta');
  check(`locale/${lang}.json 顶层只有 meta（UI 词表在 lib/client.js，避免第三份真源）`, extra.length === 0, extra.join(', '));
}

// —— 打包：exports 与 files 都漏不得 ——
check('package.json exports 导出 ./locale/*.json', manifest.exports && manifest.exports['./locale/*.json'] === './locale/*.json', '');
check('package.json files 包含 locale/*.json', Array.isArray(manifest.files) && manifest.files.includes('locale/*.json'), '');

finish();
