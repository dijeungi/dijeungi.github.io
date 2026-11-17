"use client";

import { useRef, useState, useEffect } from "react";

import { copyToClipboard } from "@/app/shared/lib/clipboard";

// 코드 복사 상태와 결과 표시 타이머 관리
export function useCodeCopy() {
  const mountedRef = useRef(false);
  const codeTimersRef = useRef<Record<string, number>>({});
  const [codeStatuses, setCodeStatuses] = useState<
    Record<string, "idle" | "copying" | "success" | "error">
  >({});

  useEffect(() => {
    const codeTimers = codeTimersRef.current;
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      Object.values(codeTimers).forEach((timerId) =>
        window.clearTimeout(timerId),
      );
    };
  }, []);

  // 코드 예제 복사와 섹션별 결과 안내
  async function copyCode(sectionId: string, value: string) {
    window.clearTimeout(codeTimersRef.current[sectionId]);
    setCodeStatuses((current) => ({ ...current, [sectionId]: "copying" }));
    const copied = await copyToClipboard(value);

    if (!mountedRef.current) {
      return;
    }

    setCodeStatuses((current) => ({
      ...current,
      [sectionId]: copied ? "success" : "error",
    }));
    codeTimersRef.current[sectionId] = window.setTimeout(() => {
      setCodeStatuses((current) => ({ ...current, [sectionId]: "idle" }));
      delete codeTimersRef.current[sectionId];
    }, 3500);
  }

  return { copyCode, codeStatuses };
}
