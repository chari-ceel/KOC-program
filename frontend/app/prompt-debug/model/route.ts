const AGENT_DEBUG_PROXY_TARGET = (
  process.env.AGENT_PROXY_TARGET ||
  process.env.NEXT_PUBLIC_AGENT_URL ||
  (process.env.API_PROXY_TARGET?.includes('backend') ? 'http://agent:8010' : 'http://127.0.0.1:8010')
).replace(/\/$/, '');

const MODEL_DEBUG_TIMEOUT_MS = 60_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.text();

  try {
    const response = await fetch(`${AGENT_DEBUG_PROXY_TARGET}/debug/model/prompt-lab`, {
      method: 'POST',
      headers: {
        'Content-Type': request.headers.get('content-type') || 'application/json',
      },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(MODEL_DEBUG_TIMEOUT_MS),
    });

    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '模型调试请求连接中断';
    return Response.json(
      {
        status: 'failed',
        httpStatus: 504,
        error: {
          code: 'PROMPT_DEBUG_PROXY_ERROR',
          message: `模型调试请求超时或连接中断：${message}`,
        },
      },
      { status: 504 },
    );
  }
}
