import test from 'node:test';
import assert from 'node:assert/strict';

import type { AgentMessage, AgentQuestionBlock } from './agent-chat-contract.ts';
import { questionSignature, visibleQuestionBlocks } from './agent-question-blocks.ts';

function block(id: string, question: string): AgentQuestionBlock {
  return {
    id,
    question,
    examples: ['示例一'],
  };
}

test('questionSignature keeps Chinese question text', () => {
  assert.equal(questionSignature('你现在是什么身份或阶段？'), '你现在是什么身份或阶段');
});

test('visibleQuestionBlocks deduplicates repeated Chinese questions', () => {
  const blocks = [
    block('q1', '你现在是什么身份或阶段？'),
    block('q2', '你现在是什么身份或阶段?'),
    block('q3', '你平时最感兴趣、最愿意聊的是什么？'),
  ];

  const visible = visibleQuestionBlocks(blocks, [], 0);

  assert.deepEqual(visible.map((item) => item.id), ['q1', 'q3']);
});

test('visibleQuestionBlocks does not remove different Chinese questions', () => {
  const blocks = [
    block('q1', '你现在是什么身份或阶段？'),
    block('q2', '你平时最感兴趣、最愿意聊的是什么？'),
    block('q3', '你觉得自己比较擅长分享什么？'),
  ];

  const visible = visibleQuestionBlocks(blocks, [], 0);

  assert.deepEqual(visible.map((item) => item.id), ['q1', 'q2', 'q3']);
});

test('visibleQuestionBlocks keeps backend-provided layered follow-up questions after an answer', () => {
  const messages: AgentMessage[] = [
    {
      id: 'user_1',
      role: 'user',
      content: '身份/阶段: 刚入职的职场新人',
      created_at: '2026-07-22T10:00:00.000Z',
    },
  ];

  const visible = visibleQuestionBlocks(
    [
      block('q1', '你想让同龄人从你的校园内容里获得什么帮助或共鸣？'),
      block('q2', '你平时最方便拍上课、宿舍、社团，还是通勤路上的素材？'),
      block('q3', '你最不想把校园账号做成哪种感觉？'),
    ],
    messages,
    1,
  );

  assert.deepEqual(visible.map((item) => item.id), ['q1', 'q2', 'q3']);
});

test('visibleQuestionBlocks keeps old message cards clickable instead of hiding by prior messages', () => {
  const messages: AgentMessage[] = [
    {
      id: 'assistant_1',
      role: 'assistant',
      content: '先选一个问题回答。',
      question_blocks: [block('old_q1', '你平时最感兴趣、最愿意聊的是什么？')],
      created_at: '2026-07-22T10:00:00.000Z',
    },
  ];

  const visible = visibleQuestionBlocks(
    [block('q1', '你平时最感兴趣、最愿意聊的是什么？')],
    messages,
    1,
  );

  assert.deepEqual(visible.map((item) => item.id), ['q1']);
});
