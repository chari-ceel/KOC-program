const BACKEND_API_BASE = (
  process.env.API_PROXY_TARGET ||
  process.env.NEXT_PUBLIC_API_URL ||
  ((process.env.HOSTNAME === 'koc-frontend-1' || process.env.HOSTNAME === 'frontend') ? 'http://backend:8000' : 'http://127.0.0.1:5001')
).replace(/\/$/, '');

const CONTENT_DRAFT_TIMEOUT_MS = 180_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.text();
  const requestHeaders: Record<string, string> = {
    'Content-Type': request.headers.get('content-type') || 'application/json',
  };
  const cookie = request.headers.get('cookie');
  if (cookie) {
    requestHeaders.cookie = cookie;
  }

  try {
    const response = await fetch(`${BACKEND_API_BASE}/api/content/draft`, {
      method: 'POST',
      headers: requestHeaders,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(CONTENT_DRAFT_TIMEOUT_MS),
    });

    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '内容生成请求连接中断';
    return Response.json(
      {
        code: 504,
        message: `内容生成请求超时或连接中断：${message}`,
        msg: `内容生成请求超时或连接中断：${message}`,
      },
      { status: 504 },
    );
  }
}
