"use client";

import { useRef, useState, useEffect } from "react";

import { useCodeCopy } from "@/app/shared/hooks/useCodeCopy";
import { copyToClipboard } from "@/app/shared/lib/clipboard";

// 본문 읽기 상태와 공유 링크 복사 관리
export function useArticleReader() {
  const mountedRef = useRef(false);
  const contentRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [{ progress, isReading }, setReadingPosition] = useState({
    progress: 0,
    isReading: false,
  });
  const shareTimerRef = useRef<number | null>(null);
  const [shareStatus, setShareStatus] = useState<
    "idle" | "copying" | "success" | "error"
  >("idle");
  const { copyCode, codeStatuses } = useCodeCopy();

  useEffect(() => {
    let frameId: number | null = null;
    const content = contentRef.current;
    mountedRef.current = true;

    if (!content) {
      return () => {
        mountedRef.current = false;
      };
    }

    // 본문이 헤더 아래에 닿는 공통 위치에서 제목 전환과 진행률 갱신
    function updateReadingPosition() {
      frameId = null;
      const article = contentRef.current;

      if (!article) {
        return;
      }

      const scrollTop = window.scrollY;
      const articleTop = article.getBoundingClientRect().top + scrollTop;
      const readingOffset = headerRef.current?.offsetHeight ?? 0;
      const readingStart = Math.max(0, articleTop - readingOffset);
      const readingEnd = Math.max(
        readingStart + 1,
        articleTop + article.offsetHeight - window.innerHeight,
      );
      const readingDistance = Math.max(0, scrollTop - readingStart);
      const nextProgress = Math.min(
        100,
        (readingDistance / (readingEnd - readingStart)) * 100,
      );
      const nextIsReading = readingDistance > 0;

      setReadingPosition((current) =>
        current.progress === nextProgress && current.isReading === nextIsReading
          ? current
          : { progress: nextProgress, isReading: nextIsReading },
      );
    }

    // 스크롤과 크기 변경의 읽기 위치 갱신 예약
    function scheduleReadingPosition() {
      if (frameId === null) {
        frameId = window.requestAnimationFrame(updateReadingPosition);
      }
    }

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleReadingPosition);

    scheduleReadingPosition();
    resizeObserver?.observe(content);

    if (headerRef.current) {
      resizeObserver?.observe(headerRef.current);
    }

    window.addEventListener("resize", scheduleReadingPosition);
    window.addEventListener("scroll", scheduleReadingPosition, { passive: true });

    return () => {
      mountedRef.current = false;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleReadingPosition);
      window.removeEventListener("scroll", scheduleReadingPosition);

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      if (shareTimerRef.current !== null) {
        window.clearTimeout(shareTimerRef.current);
      }
    };
  }, []);

  // 동작 줄이기 설정을 반영한 페이지 최상단 이동
  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  // 현재 글 주소 복사와 결과 안내
  async function copyLink() {
    if (shareTimerRef.current !== null) {
      window.clearTimeout(shareTimerRef.current);
    }

    setShareStatus("copying");
    const copied = await copyToClipboard(window.location.href);

    if (!mountedRef.current) {
      return;
    }

    setShareStatus(copied ? "success" : "error");
    shareTimerRef.current = window.setTimeout(() => {
      setShareStatus("idle");
      shareTimerRef.current = null;
    }, 3500);
  }

  return {
    progress,
    isReading,
    copyCode,
    copyLink,
    scrollToTop,
    headerRef,
    contentRef,
    shareStatus,
    codeStatuses,
  };
}
