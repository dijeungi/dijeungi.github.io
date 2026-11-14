import { siteName, siteDescription } from "@/app/shared/constants/site";

import "./styles/reset.css";
import "./styles/layout.css";
import "./styles/typography.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: siteName, template: "%s | " + siteName },
  description: siteDescription,
  applicationName: siteName,
  openGraph: {
    title: siteName,
    description: siteDescription,
    type: "website",
    locale: "ko_KR",
  },
};

// 글 상세 공통 문서 구성
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
