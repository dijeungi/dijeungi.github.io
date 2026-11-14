"use client";

import { useId, useRef, useState, useEffect, useCallback, useLayoutEffect } from "react";

import { getGitHubTooltipPosition } from "../_lib/github-tooltip";

import type { KeyboardEvent, PointerEvent } from "react";
import type { GitHubProfile, GitHubCalendarYear, GitHubTooltipData, GitHubTooltipAnchor, GitHubTooltipTarget, GitHubTooltipPosition } from "../_types/github";

// 잔디 칸의 화면 기준 좌표 추출
function readAnchor(element: HTMLElement): GitHubTooltipAnchor {
  const { left, right, top, bottom } = element.getBoundingClientRect();
  return { left, right, top, bottom };
}

// 실제 날짜의 기여 말풍선과 포인터 및 키보드 탐색 관리
export function useGitHubCalendarTooltip(year: GitHubCalendarYear | null, profile: GitHubProfile) {
  const [target, setTarget] = useState<GitHubTooltipTarget | null>(null);
  const [position, setPosition] = useState<GitHubTooltipPosition | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const sourceRef = useRef<GitHubTooltipTarget["source"]>("pointer");
  const closeTimer = useRef<number | undefined>(undefined);
  const tooltipId = useId();
  const day = year?.days.find((entry) => entry.date === target?.date) ?? null;
  const count = day === null ? 0 : day.date > (year?.updatedAt ?? "").slice(0, 10) ? 0 : day.count;

  // 말풍선 닫힘 예약 취소
  const keepTooltip = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  // 열린 말풍선과 화면 좌표 정리
  const hideTooltip = useCallback(() => {
    keepTooltip();
    anchorRef.current = null;
    setTarget(null);
    setPosition(null);
  }, [keepTooltip]);

  // 말풍선으로 포인터를 이동할 시간을 둔 닫힘 예약
  const scheduleHide = useCallback(() => {
    keepTooltip();
    closeTimer.current = window.setTimeout(hideTooltip, 100);
  }, [hideTooltip, keepTooltip]);

  // 실제 잔디 칸에 말풍선 연결
  function activateTooltip(element: HTMLElement, source: GitHubTooltipTarget["source"]) {
    keepTooltip();
    if (anchorRef.current === element && target?.source === source) return;
    anchorRef.current = element;
    sourceRef.current = source;
    setPosition(null);
    setTarget({ date: element.dataset.date!, rect: readAnchor(element), source });
  }

  // 정렬용 빈칸을 제외한 포인터 진입 처리
  function onPointerOver(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-date]") : null;
    if (!element || !event.currentTarget.contains(element) || !year?.days.some((entry) => entry.date === element.dataset.date)) {
      scheduleHide();
      return;
    }
    activateTooltip(element, "pointer");
  }

  // 하나의 탭 진입점에서 날짜별 활동 탐색
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      hideTooltip();
      return;
    }
    const steps: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    if (!year?.days.length || event.altKey || event.ctrlKey || event.metaKey || (!(event.key in steps) && event.key !== "Home" && event.key !== "End")) return;
    event.preventDefault();
    const current = year.days.findIndex((entry) => entry.date === target?.date);
    const today = year.days.findIndex((entry) => entry.date === year.updatedAt.slice(0, 10));
    const start = current >= 0 ? current : today >= 0 ? today : year.days.length - 1;
    const index = event.key === "Home" ? 0 : event.key === "End" ? year.days.length - 1 : Math.max(0, Math.min(year.days.length - 1, start + steps[event.key]));
    const element = event.currentTarget.querySelector<HTMLElement>('[data-date="' + year.days[index].date + '"]');
    if (!element) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const cell = element.getBoundingClientRect();
    sourceRef.current = "keyboard";
    if (cell.left < bounds.left) event.currentTarget.scrollLeft -= bounds.left - cell.left + 8;
    else if (cell.right > bounds.right) event.currentTarget.scrollLeft += cell.right - bounds.right + 8;
    activateTooltip(element, "keyboard");
  }

  useLayoutEffect(() => {
    if (!target || !day || !tooltipRef.current) return;
    const { width, height } = tooltipRef.current.getBoundingClientRect();
    const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: document.documentElement.clientHeight || window.innerHeight };
    const anchor = anchorRef.current ? readAnchor(anchorRef.current) : target.rect;
    const next = getGitHubTooltipPosition(anchor, { width, height }, viewport);
    if (position?.left !== next.left || position.top !== next.top || position.arrowLeft !== next.arrowLeft || position.placement !== next.placement) setPosition(next);
  }, [target, day, position, profile]);

  useEffect(() => {
    if (!target || !day) return;

    // 포인터 탐색 중 스크롤이나 화면 이동 시 말풍선 해제
    function onScroll() {
      const element = anchorRef.current;
      if (sourceRef.current !== "keyboard" || !element?.isConnected) {
        hideTooltip();
        return;
      }
      const rect = readAnchor(element);
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight || (bounds && (rect.right < bounds.left || rect.left > bounds.right))) hideTooltip();
      else setTarget((current) => current ? { ...current, rect } : null);
    }

    // 포커스 위치와 관계없는 말풍선 취소
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") hideTooltip();
    }

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", hideTooltip);
    window.addEventListener("blur", hideTooltip);
    document.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", hideTooltip);
      window.removeEventListener("blur", hideTooltip);
      document.removeEventListener("keydown", onEscape);
    };
  }, [target, day, hideTooltip]);

  useEffect(() => keepTooltip, [keepTooltip]);

  const tooltip: GitHubTooltipData | null = day ? { date: day.date, count, position } : null;
  return { tooltip, tooltipRef, viewportRef, tooltipId, onPointerOver, onKeyDown, keepTooltip, hideTooltip, scheduleHide };
}
