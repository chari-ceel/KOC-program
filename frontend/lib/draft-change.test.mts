import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDraftFingerprint, hasUnsavedDraftChanges, type DraftFingerprintItem } from './draft-change.ts';

function createDraft(overrides: Partial<DraftFingerprintItem> = {}): DraftFingerprintItem {
  return {
    id: 'default-student-growth',
    title: '大学四年的好习惯养成',
    body: '',
    createdAt: '2026-04-26T10:00:00.000Z',
    status: '已完成',
    source: '赛道生成 | 大学生成长赛道',
    draftSource: {
      sourceType: 'track',
      trackName: '大学生成长赛道',
      topicTitle: '大学生成长赛道',
    },
    tags: ['时间规划', '经验分享', '学生成长'],
    updatedAt: '2026/04/26',
    structured: {
      noteTitle: '大学四年的好习惯养成：比突然努力更重要的5件小事',
      hook: '大学生活节奏很快，很多时候不是我们不想变好，而是容易被琐碎事情打乱。',
      body: ['第一件事是每天给自己留一个简单的开始。'],
      ending: '如果你也在慢慢摸索自己的大学节奏，可以先从其中一个小习惯开始试试。',
      tags: ['大学生成长', '好习惯养成', '时间管理'],
      cardPreview: {
        keywords: ['好习惯养成', '时间管理', '校园生活'],
      },
    },
    cardPreview: {
      keywords: ['好习惯养成', '时间管理', '校园生活'],
    },
    ...overrides,
  };
}

test('buildDraftFingerprint is stable for equivalent drafts', () => {
  const first = createDraft();
  const second = createDraft();

  assert.equal(buildDraftFingerprint(first), buildDraftFingerprint(second));
});

test('default built-in draft is treated as unchanged when baseline matches', () => {
  const draft = createDraft();

  assert.equal(hasUnsavedDraftChanges(draft, [createDraft()]), false);
});

test('saved draft is treated as unchanged when baseline matches', () => {
  const savedDraft = createDraft({ id: 'saved-1', title: '我的已保存草稿' });

  assert.equal(hasUnsavedDraftChanges(savedDraft, [createDraft({ id: 'saved-1', title: '我的已保存草稿' })]), false);
});

test('new draft without baseline is treated as unsaved', () => {
  const newDraft = createDraft({ id: 'new-1' });

  assert.equal(hasUnsavedDraftChanges(newDraft, []), true);
});

test('editing an existing draft is treated as unsaved', () => {
  const baseline = createDraft({ id: 'saved-2' });
  const edited = createDraft({
    id: 'saved-2',
    structured: {
      ...baseline.structured!,
      ending: '我已经把这份草稿改过了。',
    },
  });

  assert.equal(hasUnsavedDraftChanges(edited, [baseline]), true);
});
