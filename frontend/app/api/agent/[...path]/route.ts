const BACKEND_API_BASE = (
  process.env.API_PROXY_TARGET ||
  process.env.NEXT_PUBLIC_API_URL ||
  ((process.env.HOSTNAME === 'koc-frontend-1' || process.env.HOSTNAME === 'frontend') ? 'http://backend:8000' : 'http://127.0.0.1:5001')
).replace(/\/$/, '');

const AGENT_CHAT_TIMEOUT_MS = 180_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ path?: string[] }> | { path?: string[] };
};

async function proxyAgentRequest(request: Request, context: RouteContext) {
  const params = await context.params;
  const path = (params.path || []).join('/');
  const url = new URL(request.url);
  const targetUrl = `${BACKEND_API_BASE}/api/agent/${path}${url.search}`;
  const headers: Record<string, string> = {};

  const contentType = request.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;
  const cookie = request.headers.get('cookie');
  if (cookie) headers.cookie = cookie;

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.text() : undefined;

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(AGENT_CHAT_TIMEOUT_MS),
    });

    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '统一对话请求连接中断';
    return Response.json(
      {
        detail: `统一对话请求超时或连接中断：${message}`,
        msg: `统一对话请求超时或连接中断：${message}`,
      },
      { status: 504 },
    );
  }
}

export function GET(request: Request, context: RouteContext) {
  return proxyAgentRequest(request, context);
}

export function POST(request: Request, context: RouteContext) {
  return proxyAgentRequest(request, context);
}

export function DELETE(request: Request, context: RouteContext) {
  return proxyAgentRequest(request, context);
}
