import type { NextConfig } from "next";

const isDockerRuntime =
  process.env.HOSTNAME === "koc-frontend-1" ||
  process.env.HOSTNAME === "frontend" ||
  process.env.API_PROXY_TARGET?.includes("backend") === true ||
  process.env.AGENT_PROXY_TARGET?.includes("agent") === true;

const apiProxyTarget = process.env.API_PROXY_TARGET ?? (isDockerRuntime ? "http://backend:8000" : "http://127.0.0.1:5001");

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  async rewrites() {
    return [
      {
        source: "/api/:path((?!agent(?:/|$)).*)",
        destination: `${apiProxyTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
