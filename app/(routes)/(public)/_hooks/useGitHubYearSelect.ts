"use client";

import { useId, useRef, useState, useEffect } from "react";

import type { KeyboardEvent } from "react";

// 연도 선택의 열림과 키보드 탐색 및 외부 클릭 정리
export function useGitHubYearSelect(years: number[], selectedYear: number | null, onSelect: (year: number) => void) {
  const [open, setOpen] = useState(false);
  const [requestedYear, setRequestedYear] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef({ value: "", updatedAt: 0 });
  const listboxId = useId();
  const isOpen = open && years.length > 0;
  const activeYear = years.find((year) => year === requestedYear) ?? years.find((year) => year === selectedYear) ?? years[0] ?? null;

  useEffect(() => {
    if (!isOpen) return;

    // 선택 영역을 벗어난 포인터와 포커스 확인
    function onOutside(event: Event) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [isOpen]);

  // 키보드 탐색에서 참조할 연도 항목 식별자 구성
  function optionId(year: number) {
    return listboxId + "-" + year;
  }

  // 현재 선택 연도를 기준으로 목록 열림 전환
  function toggleMenu() {
    if (years.length === 0) return;
    setRequestedYear(years.find((year) => year === selectedYear) ?? years[0]);
    searchRef.current = { value: "", updatedAt: 0 };
    setOpen(!isOpen);
  }

  // 유효한 연도 선택 후 버튼으로 포커스 복귀
  function chooseYear(year: number) {
    if (!years.includes(year)) return;
    onSelect(year);
    setRequestedYear(year);
    setOpen(false);
    triggerRef.current?.focus();
  }

  // 선택 변경 없이 탐색 중인 연도 강조
  function activateYear(year: number) {
    if (years.includes(year)) setRequestedYear(year);
  }

  // 방향키와 확인 및 취소와 연도 숫자 검색 처리
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (years.length === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!/^\d$/.test(event.key)) searchRef.current = { value: "", updatedAt: 0 };
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = activeYear === null ? 0 : years.indexOf(activeYear);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.max(0, Math.min(years.length - 1, index + direction));
      const openingYear = years.find((year) => year === selectedYear) ?? years[0];
      setRequestedYear(isOpen ? years[nextIndex] : openingYear);
      setOpen(true);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setRequestedYear(event.key === "Home" ? years[0] : years[years.length - 1]);
      setOpen(true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen && activeYear !== null) chooseYear(activeYear);
      else toggleMenu();
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "Tab" && isOpen) {
      if (activeYear !== null) onSelect(activeYear);
      setOpen(false);
    } else if (/^\d$/.test(event.key)) {
      const now = Date.now();
      const query = (isOpen && now - searchRef.current.updatedAt < 1000 ? searchRef.current.value : "") + event.key;
      const match = years.find((year) => String(year).startsWith(query));
      searchRef.current = { value: query, updatedAt: now };
      if (match !== undefined) {
        event.preventDefault();
        setRequestedYear(match);
        setOpen(true);
      }
    }
  }

  return { isOpen, activeYear, rootRef, triggerRef, listboxId, optionId, toggleMenu, chooseYear, activateYear, onKeyDown };
}
