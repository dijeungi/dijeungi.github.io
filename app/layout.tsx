import { themeInitScript } from "@/app/shared/theme";
import { siteName, siteDescription } from "@/app/shared/constants/site";
import { ThemeController } from "@/app/shared/components/ThemeController";

import "./styles/reset.css";
import "./styles/layout.css";
import "./styles/theme.css";
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

// 블로그 공통 문서와 테마 초기화 구성
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeController />
        {children}
      </body>
    </html>
  );
}
