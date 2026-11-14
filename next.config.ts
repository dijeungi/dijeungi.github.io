import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import type { NextConfig } from "next";

// 정적 배포와 로컬 글쓰기 API 경로 구성
export default function createNextConfig(phase: string): NextConfig {
  const isDevelopment = phase === PHASE_DEVELOPMENT_SERVER;
  const nextConfig: NextConfig = {
    output: isDevelopment ? undefined : "export",
    trailingSlash: true,
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
    reactCompiler: true,
  };

  if (isDevelopment) {
    const editorPort = Number(process.env.EDITOR_API_PORT || "4319");

    if (!Number.isInteger(editorPort) || editorPort < 1024 || editorPort > 65535) {
      throw new Error("EDITOR_API_PORT는 1024부터 65535 사이의 포트여야 합니다.");
    }

    // 개발 서버에서만 기기 내부의 글쓰기 API로 전달
    nextConfig.rewrites = async () => [
      {
        source: "/__editor/api/:path*",
        destination: "http://127.0.0.1:" + editorPort + "/:path*",
      },
    ];

    // 기기 내부 글쓰기 화면을 외부 페이지에 삽입하지 못하도록 설정
    nextConfig.headers = async () => [
      {
        source: "/write/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  }

  return nextConfig;
}
