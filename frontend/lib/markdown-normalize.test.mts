import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAiMarkdown } from './markdown-normalize.ts';

test('normalizeAiMarkdown fixes bold labels with trailing spaces before closing marker', () => {
  const normalized = normalizeAiMarkdown('**人设标题： **宅家娱乐资深玩家\n**内容方向： **日常娱乐分享');

  assert.equal(normalized.includes('**人设标题： **'), false);
  assert.equal(normalized.includes('**内容方向： **'), false);
  assert.equal(normalized.includes('**人设标题：** 宅家娱乐资深玩家'), true);
  assert.equal(normalized.includes('**内容方向：** 日常娱乐分享'), true);
});

test('normalizeAiMarkdown fixes trending labels and splits recommendation topics', () => {
  const normalized = normalizeAiMarkdown(
    '**趋势维度： **7d / xiaohongshu / 高中校园生活涨粉赛道\n**推荐选题： **1. 和同桌的日常打闹有多好笑；2. 高中同桌才懂的暗语合集；3. 上课和同桌传过的小纸条',
  );

  assert.equal(normalized.includes('**趋势维度： **'), false);
  assert.equal(normalized.includes('**推荐选题： **'), false);
  assert.equal(normalized.includes('**趋势维度：** 7d / xiaohongshu / 高中校园生活涨粉赛道'), true);
  assert.equal(normalized.includes('**推荐选题：**\n1. 和同桌的日常打闹有多好笑\n2. 高中同桌才懂的暗语合集\n3. 上课和同桌传过的小纸条'), true);
});
