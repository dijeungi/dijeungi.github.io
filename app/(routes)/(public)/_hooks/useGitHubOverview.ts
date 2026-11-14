"use client";

import { useState, useEffect } from "react";

import { parseGitHubProfile, parseContributionResponse } from "../_lib/github-live";

import type { GitHubOverview, GitHubLiveUpdates } from "../_types/github";

const refreshInterval = 5 * 60 * 1000;
const recentUpdates = new Map<string, GitHubLiveUpdates>();

// 인증 정보 없이 공개 JSON 응답 조회
async function readPublicJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error("GitHub 공개 정보를 조회하지 못했습니다.");
  return response.json();
}

// 초기 공개 정보를 유지하면서 접속과 화면 복귀 및 주기별 변경 반영
export function useGitHubOverview(initial: GitHubOverview): GitHubOverview {
  const [updates, setUpdates] = useState<GitHubLiveUpdates | null>(null);
  const login = initial.profile.login;

  useEffect(() => {
    let active = true;
    let pending = false;
    let lastAttempt = 0;
    let controller: AbortController | null = null;
    let requestTimeout: number | undefined;

    // 보관한 응답을 재사용하고 필요한 공개 정보만 독립적으로 갱신
    async function refresh() {
      if (!active || pending || document.hidden || !navigator.onLine) return;
      const cached = recentUpdates.get(login);
      if (cached && Date.now() - cached.checkedAt < refreshInterval) {
        const saved = await Promise.resolve(cached);
        if (active) setUpdates(saved);
        return;
      }
      if (Date.now() - lastAttempt < refreshInterval) return;
      lastAttempt = Date.now();
      pending = true;
      const request = new AbortController();
      controller = request;
      const timeout = window.setTimeout(() => request.abort(), 10_000);
      requestTimeout = timeout;
      try {
        const updatedAt = new Date().toISOString();
        const [profile, calendar] = await Promise.allSettled([
          readPublicJson("https://api.github.com/users/" + encodeURIComponent(login), request.signal).then((value) => parseGitHubProfile(value, login)),
          readPublicJson("https://github-contributions-api.jogruber.de/v4/" + encodeURIComponent(login) + "?y=all", request.signal).then((value) => {
            const years = parseContributionResponse(value, updatedAt);
            if (initial.years.some((year) => !years.some((next) => next.year === year.year))) {
              throw new Error("GitHub 활동의 일부 연도가 누락되었습니다.");
            }
            return years;
          }),
        ]);
        if (!active) return;
        const checkedAt = Date.now();
        const next: GitHubLiveUpdates = {
          login,
          profile: profile.status === "fulfilled" ? profile.value : cached?.profile ?? null,
          years: calendar.status === "fulfilled" ? calendar.value : cached?.years ?? null,
          profileCheckedAt: profile.status === "fulfilled" ? checkedAt : cached?.profileCheckedAt ?? 0,
          calendarCheckedAt: calendar.status === "fulfilled" ? checkedAt : cached?.calendarCheckedAt ?? 0,
          checkedAt: lastAttempt,
        };
        recentUpdates.set(login, next);
        setUpdates(next);
      } finally {
        window.clearTimeout(timeout);
        requestTimeout = undefined;
        pending = false;
        controller = null;
      }
    }

    // 캐시 주기를 지키며 활성 화면의 변경 확인
    function resume() {
      void refresh();
    }

    resume();
    const interval = window.setInterval(resume, refreshInterval);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(requestTimeout);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [login, initial.years]);

  const current = updates?.login === login ? updates : null;
  const profile = current?.profile && current.profileCheckedAt >= Date.parse(initial.updatedAt) ? current.profile : initial.profile;
  const years = current?.years?.map((year) => {
    const original = initial.years.find((entry) => entry.year === year.year);
    return original && Date.parse(original.updatedAt) > current.calendarCheckedAt ? original : year;
  }) ?? initial.years;
  return { ...initial, profile, years, source: current?.profile || current?.years ? "public-api" : initial.source };
}
