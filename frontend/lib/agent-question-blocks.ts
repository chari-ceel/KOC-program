import type { AgentMessage, AgentQuestionBlock } from './agent-chat-contract.ts';

export function questionSignature(question: string) {
  return (question.toLowerCase().normalize('NFKC').match(/[\p{Letter}\p{Number}]+/gu) || []).join('').slice(0, 36);
}

export function visibleQuestionBlocks(blocks: AgentQuestionBlock[], _messages: AgentMessage[], _messageIndex: number) {
  void _messages;
  void _messageIndex;
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const signature = questionSignature(block.question);
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}
