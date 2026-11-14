"use client";

import { useTheme } from "@/app/shared/hooks/useTheme";

// 모든 페이지에서 시스템 테마 변경 구독 유지
export function ThemeController() {
  useTheme();
  return null;
}
