import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

const promptFiles = {
  persona: {
    taskType: 'persona.follow_up',
    fileName: 'persona.prompt.md',
  },
  trending: {
    taskType: 'trend.track',
    fileName: 'trend-tracking.prompt.md',
  },
  content: {
    taskType: 'content.draft',
    fileName: 'xhs-content-writing.prompt.md',
  },
};

export async function GET() {
  const prompts: Record<string, { taskType: string; fileName: string; content: string }> = {};

  for (const [moduleId, config] of Object.entries(promptFiles)) {
    const promptPath = process.env.PROMPT_DIR
      ? path.join(/*turbopackIgnore: true*/ process.env.PROMPT_DIR, config.fileName)
      : path.join(process.cwd(), 'prompts', config.fileName);
    try {
      prompts[moduleId] = {
        ...config,
        content: await readFile(promptPath, 'utf8'),
      };
    } catch (error) {
      return NextResponse.json(
        {
          code: 500,
          message: `读取 Prompt 文件失败：${config.fileName}`,
          detail: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ code: 200, data: { prompts } });
}
