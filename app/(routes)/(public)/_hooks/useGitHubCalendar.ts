"use client";

import { useState } from "react";

import type { GitHubCalendarYear } from "../_types/github";

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const millisecondsPerDay = 86400000;

// 연도 선택과 일요일 시작의 실제 GitHub 활동 달력 구성
export function useGitHubCalendar(years: GitHubCalendarYear[], updatedAt: string) {
  const [requestedYear, setRequestedYear] = useState<number | null>(null);
  const availableYears = [...years].sort((first, second) => second.year - first.year);
  const selectedYear = availableYears.find((entry) => entry.year === requestedYear) ?? availableYears[0] ?? null;
  const asOfDate = (selectedYear?.updatedAt ?? updatedAt).slice(0, 10);
  const firstDay = selectedYear === null ? 0 : Date.UTC(selectedYear.year, 0, 1);
  const leadingDays = selectedYear === null ? 0 : new Date(firstDay).getUTCDay();
  const weekCount = Math.max(1, Math.ceil((leadingDays + (selectedYear?.days.length ?? 0)) / 7));
  const cells = Array.from({ length: weekCount * 7 }, (_, index) => {
    const day = selectedYear?.days[index - leadingDays] ?? null;
    return { day, isFuture: day !== null && day.date > asOfDate };
  });
  const months = selectedYear === null ? [] : monthNames.map((label, month) => ({
    label,
    column: Math.floor((leadingDays + (Date.UTC(selectedYear.year, month, 1) - firstDay) / millisecondsPerDay) / 7) + 1,
  }));

  // 제공된 실제 데이터의 연도 선택
  function selectYear(year: number) {
    if (availableYears.some((entry) => entry.year === year)) setRequestedYear(year);
  }

  return { cells, months, asOfDate, weekCount, selectedYear, availableYears, selectYear };
}
