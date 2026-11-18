"use client";

import { LuMoon, LuSun } from "react-icons/lu";

import { useTheme } from "@/app/shared/hooks/useTheme";

import styles from "./ThemeToggle.module.css";

// 라이트 모드와 다크 모드를 전환하는 헤더 버튼
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환";

  return (
    <button
      className={styles.button}
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      <LuMoon className={styles.moon} size={20} strokeWidth={1.6} aria-hidden="true" focusable="false" />
      <LuSun className={styles.sun} size={20} strokeWidth={1.6} aria-hidden="true" focusable="false" />
    </button>
  );
}
