import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import typescript from "typescript";

import { githubLogin } from "../app/shared/constants/site.ts";
import { parseGitHubProfile } from "../app/(routes)/(public)/_lib/github-live.ts";
import { parseContributionCalendar, expandContributionSnapshot } from "../app/(routes)/(public)/_lib/github-calendar.ts";

const checkedAt = "2026-11-15T10:00:00.000Z";
const snapshot = JSON.parse(await readFile(new URL("../app/(routes)/(public)/_data/github-snapshot.json", import.meta.url), "utf8"));
const hookSource = await readFile(new URL("../app/(routes)/(public)/_hooks/useGitHubOverview.ts", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../app/(routes)/(public)/_lib/github.server.ts", import.meta.url), "utf8");

// 실제 소스를 격리된 CommonJS 검증 모듈로 변환
function compile(source) {
  return typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
}

// 공개 응답과 네트워크 실패만 모의해 서버 fallback 경로 실행
async function loadOverview(profileAvailable = true) {
  const loaded = { exports: {} };
  const profile = {
    login: snapshot.profile.login,
    name: "갱신된 공개 프로필",
    bio: "새 공개 소개",
    avatar_url: snapshot.profile.avatarUrl,
    html_url: snapshot.profile.profileUrl,
    updated_at: checkedAt,
  };

  // 공개 프로필 성공과 달력 실패를 메모리에서 전달
  function request(url, options, callback) {
    assert.equal(options.method, "GET");
    const connection = new EventEmitter();
    connection.end = () => queueMicrotask(() => {
      if (!profileAvailable || !url.startsWith("https://api.github.com/users/")) {
        connection.emit("error", new Error("격리된 네트워크 실패"));
        return;
      }
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit("data", Buffer.from(JSON.stringify(profile)));
      response.emit("end");
    });
    return connection;
  }

  runInNewContext(compile(serverSource), {
    Buffer,
    AbortSignal,
    module: loaded,
    exports: loaded.exports,
    console: { warn() {} },
    process: { env: {} },
    Date: class extends Date {
      constructor(...values) { super(...(values.length ? values : [checkedAt])); }
    },
    require: (specifier) => {
      if (specifier === "node:https") return { request };
      if (specifier === "./github-live") return { parseGitHubProfile };
      if (specifier === "@/app/shared/constants/site") return { githubLogin };
      if (specifier === "./github-calendar") return { parseContributionCalendar, expandContributionSnapshot };
      if (specifier === "../_data/github-snapshot.json") return snapshot;
      throw new Error("검증에서 허용하지 않은 서버 의존성입니다: " + specifier);
    },
  }, { filename: "github.server.ts" });
  return loaded.exports.getGitHubOverview();
}

// 네트워크와 생명주기를 실행하지 않고 실제 훅의 캐시 병합 결과 확인
function mergeOverview(initial, updates) {
  const loaded = { exports: {} };
  runInNewContext(compile(hookSource), {
    module: loaded,
    exports: loaded.exports,
    require: (specifier) => {
      if (specifier === "react") return { useEffect() {}, useState: () => [updates, () => {}] };
      if (specifier === "../_lib/github-live") return { parseGitHubProfile };
      throw new Error("검증에서 허용하지 않은 훅 의존성입니다: " + specifier);
    },
  }, { filename: "useGitHubOverview.ts" });
  return loaded.exports.useGitHubOverview(initial);
}

// 이전 방문에서 성공한 공개 프로필 캐시 구성
function cachedProfile(overrides = {}) {
  const timestamp = Date.parse(checkedAt) - 60_000;
  return {
    login: snapshot.profile.login,
    profile: { ...snapshot.profile, name: "이전 방문의 공개 프로필" },
    years: null,
    checkedAt: timestamp,
    profileCheckedAt: timestamp,
    calendarCheckedAt: 0,
    ...overrides,
  };
}

test("달력 갱신이 실패해도 새 서버 프로필을 이전 방문 캐시로 되돌리지 않는다", async () => {
  const initial = await loadOverview();
  assert.equal(initial.source, "snapshot");
  assert.equal(initial.updatedAt, snapshot.updatedAt);
  assert.equal(initial.profileUpdatedAt, checkedAt);
  assert.equal(initial.profile.name, "갱신된 공개 프로필");
  assert.equal(mergeOverview(initial, cachedProfile()).profile.name, initial.profile.name);
});

test("서버 프로필도 실패하면 마지막으로 성공한 더 최신 공개 프로필 캐시를 유지한다", async () => {
  const initial = await loadOverview(false);
  const cached = cachedProfile();
  assert.equal(initial.profile.name, snapshot.profile.name);
  assert.equal(initial.profileUpdatedAt, snapshot.updatedAt);
  assert.equal(mergeOverview(initial, cached).profile.name, cached.profile.name);
});

test("프로필 전용 시각이 없는 이전 빌드도 기존 조회 시각으로 캐시 우선순위를 판단한다", () => {
  const initial = { profile: snapshot.profile, years: [], updatedAt: checkedAt, source: "github" };
  const cached = cachedProfile();
  assert.equal(mergeOverview(initial, cached).profile.name, initial.profile.name);
  const newer = cachedProfile({ profileCheckedAt: Date.parse(checkedAt) + 60_000 });
  assert.equal(mergeOverview(initial, newer).profile.name, newer.profile.name);
  assert.equal(mergeOverview(initial, { ...newer, login: "other" }).profile.name, initial.profile.name);
});

test("프로필 갱신 시각과 독립적으로 연도별 최신 달력을 선택한다", () => {
  const initial = {
    profile: snapshot.profile,
    years: [{ year: 2026, updatedAt: checkedAt }, { year: 2025, updatedAt: snapshot.updatedAt }],
    updatedAt: checkedAt,
    source: "github",
  };
  const cached = cachedProfile({
    years: [{ year: 2026, updatedAt: "2026-11-15T09:59:00.000Z" }, { year: 2025, updatedAt: "2026-11-15T09:59:00.000Z" }],
    calendarCheckedAt: Date.parse(checkedAt) - 60_000,
  });
  const merged = mergeOverview(initial, cached);
  assert.equal(merged.years[0], initial.years[0]);
  assert.equal(merged.years[1], cached.years[1]);
});
