'use client';

import MarkdownText from '@/components/MarkdownText';
import { formatDebugSection, readString } from '@/components/prompt-debug/shared';
import { isRecord } from '@/lib/api';

interface AgentDebugDetailsProps {
  payload: unknown;
}

function buildSummary(payload: unknown) {
  const debug = isRecord(payload) ? payload : {};
  const metadata = isRecord(debug.metadata) ? debug.metadata : {};
  const requestedOptions = isRecord(debug.requestedOptions) ? debug.requestedOptions : {};
  const error = isRecord(debug.error) ? debug.error : {};
  const sourceCount = Array.isArray(debug.sources) ? debug.sources.length : 0;
  const toolCallCount = Array.isArray(debug.toolCalls) ? debug.toolCalls.length : 0;

  const lines = [
    '## Agent 调试详情',
    `- Agent 状态：${readString(debug.agentStatus) || '-'}`,
    `- 来源条数：${String(sourceCount)}`,
    `- 工具调用条数：${String(toolCallCount)}`,
    `- Retrieval Source：${readString(metadata.retrievalSource) || readString(metadata.researchSource) || '-'}`,
    `- Runtime Mode：${readString(metadata.runtimeMode) || '-'}`,
    `- Model：${readString(metadata.model) || '-'}`,
    '',
    '### 请求开关',
    '```json',
    formatDebugSection(requestedOptions),
    '```',
  ];

  if (Object.keys(error).length > 0) {
    lines.push('', '### Agent 错误', '```json', formatDebugSection(error), '```');
  }

  lines.push('', '### Sources', '```json', formatDebugSection(debug.sources || []), '```');
  lines.push('', '### Tool Calls', '```json', formatDebugSection(debug.toolCalls || []), '```');
  lines.push('', '### Metadata', '```json', formatDebugSection(metadata), '```');
  return lines.join('\n');
}

export default function AgentDebugDetails({ payload }: AgentDebugDetailsProps) {
  return (
    <div className="mt-3 rounded-[12px] bg-[#f4e9df] p-4 ring-1 ring-[#eadbcc]">
      <MarkdownText content={buildSummary(payload)} className="text-[13px] leading-6 text-[#3b2a21]" />
    </div>
  );
}
