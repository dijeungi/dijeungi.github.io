"use client";

import { useRef, useState, useEffect, useCallback } from "react";

import { isSafeContentUrl } from "@/app/shared/lib/content";
import { parseMarkdown, serializeMarkdown } from "@/app/shared/lib/markdown";
import { getMarkdownEdit, getMarkdownImageEdit, getMarkdownIndentEdit } from "../_lib/markdown-edits";

import type { KeyboardEvent } from "react";
import type { BlogDocument, RichDocument } from "@/app/shared/types/content";
import type { MarkdownEdit, MarkdownFormat, MarkdownSnapshot, WriterImage } from "../_types/writer";

// 마크다운 원문과 미리보기 본문 및 실행 취소 관리
export function useMarkdownInput(
  getContent: () => RichDocument,
  onChange: (source: string, content: RichDocument | null) => void,
  isBlocked: () => boolean,
  reportError: (message: string) => void,
) {
  const sourceRef = useRef("");
  const errorRef = useRef("");
  const frameRef = useRef(0);
  const selectionRef = useRef({ start: 0, end: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [markdown, setMarkdown] = useState("");
  const [bodyError, setBodyError] = useState("");
  const [history, setHistory] = useState<{ past: MarkdownSnapshot[]; future: MarkdownSnapshot[] }>({ past: [], future: [] });
  const historyRef = useRef(history);

  // 입력창의 현재 커서와 원문 스냅샷
  const snapshot = useCallback((): MarkdownSnapshot => ({
    value: sourceRef.current,
    content: getContent(),
    start: textareaRef.current?.selectionStart ?? selectionRef.current.start,
    end: textareaRef.current?.selectionEnd ?? selectionRef.current.end,
  }), [getContent]);

  // 실행 취소와 다시 실행 목록 동기화
  const storeHistory = useCallback((next: typeof history) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  // 원문 해석 결과를 본문 미리보기에 반영
  const applySource = useCallback((value: string, previous = getContent()) => {
    sourceRef.current = value;
    setMarkdown(value);
    try {
      const content = parseMarkdown(value, previous);
      errorRef.current = "";
      setBodyError("");
      onChange(value, content);
    } catch {
      const message = "본문을 해석하지 못했습니다. 마크다운 내용을 확인해 주세요.";
      errorRef.current = message;
      setBodyError(message);
      onChange(value, null);
    }
  }, [getContent, onChange]);

  // 서식 변경 후 입력창 커서 복원
  const restoreSelection = useCallback((edit: MarkdownEdit) => {
    selectionRef.current = { start: edit.start, end: edit.end };
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(edit.start, edit.end);
    });
  }, []);

  // 새 입력 전의 원문을 실행 취소 목록에 추가
  const applyEdit = useCallback((edit: MarkdownEdit, previous?: RichDocument) => {
    if (isBlocked() || edit.value === sourceRef.current) return;
    storeHistory({ past: [...historyRef.current.past.slice(-39), snapshot()], future: [] });
    applySource(edit.value, previous);
    restoreSelection(edit);
  }, [isBlocked, snapshot, storeHistory, applySource, restoreSelection]);

  // 저장한 원문 또는 기존 문서로 입력창 초기화
  const setDocument = useCallback((document: BlogDocument) => {
    const source = document.markdown ?? serializeMarkdown(document.content);
    sourceRef.current = source;
    errorRef.current = "";
    selectionRef.current = { start: 0, end: 0 };
    window.cancelAnimationFrame(frameRef.current);
    setMarkdown(source);
    setBodyError("");
    storeHistory({ past: [], future: [] });
  }, [storeHistory]);

  // 사용자가 입력한 원문과 커서 기록
  const changeMarkdown = useCallback((value: string) => {
    if (isBlocked() || value === sourceRef.current) return;
    const previous = { value: sourceRef.current, content: getContent(), ...selectionRef.current };
    storeHistory({ past: [...historyRef.current.past.slice(-39), previous], future: [] });
    applySource(value);
    selectionRef.current = {
      start: textareaRef.current?.selectionStart ?? value.length,
      end: textareaRef.current?.selectionEnd ?? value.length,
    };
  }, [isBlocked, getContent, storeHistory, applySource]);

  // 네이티브 선택 영역 기록
  const onMarkdownSelect = useCallback(() => {
    selectionRef.current = {
      start: textareaRef.current?.selectionStart ?? 0,
      end: textareaRef.current?.selectionEnd ?? 0,
    };
  }, []);

  // 도구 모음에서 선택한 마크다운 문법 삽입
  const insertMarkdown = useCallback((format: MarkdownFormat) => {
    if (isBlocked()) return;
    const current = snapshot();
    let href = "";
    if (format === "link") {
      const value = window.prompt("연결할 주소를 입력하세요.", "https://");
      if (value === null) return;
      href = value.trim();
      if (!isSafeContentUrl(href)) {
        reportError("http, https 또는 메일 주소 형식의 링크를 입력해 주세요.");
        return;
      }
    }
    reportError("");
    applyEdit(getMarkdownEdit(current.value, current.start, current.end, format, href));
  }, [isBlocked, snapshot, reportError, applyEdit]);

  // 업로드 치수를 보존하면서 본문에 이미지 삽입
  const insertImage = useCallback((image: WriterImage) => {
    if (isBlocked()) return;
    const current = snapshot();
    const content = getContent();
    const previous: RichDocument = { ...content, content: [...content.content, { type: "image", attrs: image }] };
    applyEdit(getMarkdownImageEdit(current.value, current.start, current.end, image.src, image.alt), previous);
  }, [isBlocked, snapshot, getContent, applyEdit]);

  // 직전 원문 변경 복원
  const undo = useCallback(() => {
    const previous = historyRef.current.past.at(-1);
    if (isBlocked() || !previous) return;
    storeHistory({ past: historyRef.current.past.slice(0, -1), future: [...historyRef.current.future, snapshot()] });
    applySource(previous.value, previous.content);
    restoreSelection(previous);
  }, [isBlocked, snapshot, storeHistory, applySource, restoreSelection]);

  // 실행 취소한 원문 변경 복원
  const redo = useCallback(() => {
    const next = historyRef.current.future.at(-1);
    if (isBlocked() || !next) return;
    storeHistory({ past: [...historyRef.current.past.slice(-39), snapshot()], future: historyRef.current.future.slice(0, -1) });
    applySource(next.value, next.content);
    restoreSelection(next);
  }, [isBlocked, snapshot, storeHistory, applySource, restoreSelection]);

  // 마크다운 입력 단축키 처리
  const onMarkdownKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || isBlocked()) return;
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      if (key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (key === "y") { event.preventDefault(); redo(); }
      else if (key === "b" || key === "i" || key === "k") {
        event.preventDefault();
        insertMarkdown(key === "b" ? "bold" : key === "i" ? "italic" : "link");
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
      const current = snapshot();
      applyEdit(getMarkdownIndentEdit(current.value, current.start, current.end, event.shiftKey));
    }
  }, [isBlocked, undo, redo, insertMarkdown, snapshot, applyEdit]);

  // 저장 전에 본문 해석 오류 확인
  const getBodyError = useCallback(() => errorRef.current, []);

  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), []);

  return {
    markdown, textareaRef, bodyError, changeMarkdown, insertMarkdown, insertImage,
    undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    onMarkdownKeyDown, onMarkdownSelect, setDocument, getBodyError,
  };
}
