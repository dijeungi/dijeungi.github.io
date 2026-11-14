"use client";

import { useSyncExternalStore } from "react";

import { setTheme, subscribeTheme, getResolvedTheme } from "@/app/shared/lib/theme-store";

import type { Theme } from "@/app/shared/theme";

// 서버 렌더링과 수화의 동일한 초기 스냅샷
function getServerTheme(): Theme {
  return "light";
}

// 현재 테마와 반대 모드 전환 동작 제공
export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getResolvedTheme, getServerTheme);

  // 현재 화면과 반대 테마 선택
  function toggleTheme() {
    setTheme(getResolvedTheme() === "dark" ? "light" : "dark");
  }

  return { theme, toggleTheme };
}
