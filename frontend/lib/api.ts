// 默认走同源 /api，由前端 rewrite 或外层反向代理转发到后端。
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(text.startsWith('<!DOCTYPE') ? '接口未启动或返回了页面 HTML' : text || response.statusText);
  }
  return response.json();
}

/**
 * 从API响应中提取文本内容
 */
export function extractTextFromResponse(data: unknown): string {
  // 优先返回 reply 字段
  if (isRecord(data) && data.reply && typeof data.reply === 'string') {
    return data.reply;
  }

  // 如果 data 本身是字符串
  if (typeof data === 'string') {
    return data;
  }

  // 从 data 对象中提取文本内容
  if (isRecord(data)) {
    // 尝试提取常见的文本字段
    const textFields = ['reply', 'text', 'message', 'content', 'answer', 'result'];
    for (const field of textFields) {
      if (data[field] && typeof data[field] === 'string') {
        return data[field];
      }
    }

    // 如果有 draft 对象，提取其中的主要内容
    if (isRecord(data.draft)) {
      const draftContent = data.draft;
      if (draftContent.selectedTitle || draftContent.intro || draftContent.hook || draftContent.body) {
        const parts = [];
        if (typeof draftContent.selectedTitle === 'string') parts.push(`标题：${draftContent.selectedTitle}`);
        if (typeof draftContent.intro === 'string') parts.push(`\n引入：${draftContent.intro}`);
        else if (typeof draftContent.hook === 'string') parts.push(`\n引入：${draftContent.hook}`);
        if (typeof draftContent.body === 'string') parts.push(`\n内容：${draftContent.body}`);
        return parts.join('');
      }
    }

    // 如果有其他对象类型的数据，尝试提取第一个字符串值
    for (const key in data) {
      if (typeof data[key] === 'string' && data[key].trim()) {
        return data[key];
      }
    }
  }

  return '暂无回复';
}
