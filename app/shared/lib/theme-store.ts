"use client";

import { themeStorageKey, systemThemeQuery } from "@/app/shared/theme";

import type { Theme } from "@/app/shared/theme";

let preferencePending = false;
let preference: Theme | null = null;
let stopListening: (() => void) | null = null;
const listeners = new Set<() => void>();

// 저장된 테마 값의 유효성 확인
function parsePreference(value: string | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

// 현재 문서에 적용된 테마 조회
export function getResolvedTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

// 문서 테마 적용과 구독 화면 갱신
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  listeners.forEach((listener) => listener());
}

// 사용자 선택 저장과 즉시 반영
export function setTheme(theme: Theme) {
  preference = theme;
  try {
    localStorage.setItem(themeStorageKey, theme);
    preferencePending = false;
  } catch {
    preferencePending = true;
  }
  applyTheme(theme);
}

// 시스템 설정과 다른 탭의 테마 선택 동기화
function startThemeSync() {
  let storage: Storage | undefined;
  const media = window.matchMedia(systemThemeQuery);

  try {
    storage = window.localStorage;
    if (!preferencePending) {
      preference = parsePreference(storage.getItem(themeStorageKey));
    }
  } catch {}

  // 시스템 설정을 따르는 테마 갱신
  function syncSystemTheme() {
    if (!preference) {
      applyTheme(media.matches ? "dark" : "light");
    }
  }

  // 다른 탭에서 선택하거나 해제한 테마 반영
  function syncStoredTheme(event: StorageEvent) {
    if (
      event.storageArea !== storage ||
      (event.key !== themeStorageKey && event.key !== null)
    ) {
      return;
    }
    preferencePending = false;
    preference = parsePreference(event.newValue);
    applyTheme(preference ?? (media.matches ? "dark" : "light"));
  }

  media.addEventListener("change", syncSystemTheme);
  window.addEventListener("storage", syncStoredTheme);
  applyTheme(preference ?? (media.matches ? "dark" : "light"));

  return () => {
    media.removeEventListener("change", syncSystemTheme);
    window.removeEventListener("storage", syncStoredTheme);
  };
}

// 화면 구독 수에 맞춘 시스템 테마 연결과 정리
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    stopListening = startThemeSync();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopListening?.();
      stopListening = null;
    }
  };
}
