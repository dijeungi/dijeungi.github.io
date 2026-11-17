"use client";

import { useRef, useState, useEffect, useCallback } from "react";

import type { WriterConfirmation } from "../_types/writer";

// 저장하지 않은 입력과 삭제를 확인하는 모달 수명 관리
export function useWriterDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const resolveRef = useRef<((answer: boolean) => void) | null>(null);
  const [confirmation, setConfirmation] = useState<WriterConfirmation | null>(null);

  // 중복 확인창을 만들지 않는 사용자 선택 요청
  const requestConfirmation = useCallback((options: WriterConfirmation): Promise<boolean> => {
    if (resolveRef.current) return Promise.resolve(false);
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setConfirmation(options);
    });
  }, []);

  // 확인창 선택 전달과 상태 해제
  const respondToConfirmation = useCallback((answer: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setConfirmation(null);
    resolve?.(answer);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmation) {
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-cancel-confirmation]")?.focus();
    } else {
      if (dialog.open) dialog.close();
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [confirmation]);

  useEffect(() => () => {
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return { confirmation, dialogRef, requestConfirmation, respondToConfirmation };
}
