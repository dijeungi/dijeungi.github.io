import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  parseGitHubProfile,
  parseContributionResponse,
} from "../app/(routes)/(public)/_lib/github-live.ts";

const updatedAt = "2026-11-14T16:00:00.000Z";

// 연간 날짜와 숫자가 완전한 공개 API 검증 자료 생성
function contributionFixture(years = [2026], activeDays = {}) {
  const contributions = years.flatMap((year) => {
    const start = Date.UTC(year, 0, 1);
    const length = (Date.UTC(year + 1, 0, 1) - start) / 86_400_000;
    return Array.from({ length }, (_, index) => {
      const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
      const count = activeDays[date] ?? 0;
      return { date, count, level: count ? 4 : 0 };
    });
  });
  const total = Object.fromEntries(years.map((year) => [year, contributions.filter((day) => day.date.startsWith(year + "-")).reduce((sum, day) => sum + day.count, 0)]));
  return { total, contributions };
}

// 공개 GitHub 프로필의 필요한 필드 검증 자료 생성
function profileFixture(overrides = {}) {
  return { login: "dijeungi", name: "JunHo Choi", bio: "Software Engineer", avatar_url: "https://avatars.githubusercontent.com/u/181299652?v=4", html_url: "https://github.com/dijeungi", updated_at: "2026-11-14T10:20:30Z", ...overrides };
}

test("섞인 날짜를 정렬하고 윤년 및 연도별 기여 합계를 보존한다", () => {
  const response = contributionFixture([2024, 2026], { "2024-02-29": 12, "2026-01-01": 1 });
  response.contributions.reverse();
  const original = JSON.stringify(response);
  const years = parseContributionResponse(response, updatedAt);
  assert.deepEqual(years.map((year) => year.year), [2026, 2024]);
  assert.equal(years[0].days.length, 365);
  assert.equal(years[1].days.length, 366);
  assert.deepEqual(years[1].days[59], { date: "2024-02-29", count: 12, level: 4 });
  assert.equal(years[1].totalContributions, 12);
  assert.equal(years[1].days.at(-1).date, "2024-12-31");
  assert.ok(years.every((year) => year.updatedAt === updatedAt && year.totalCommits === null));
  assert.equal(JSON.stringify(response), original);
});

test("실제 공개 snapshot의 모든 일별 숫자와 단계를 API 형식에서도 보존한다", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../app/(routes)/(public)/_data/github-snapshot.json", import.meta.url), "utf8"));
  const response = {
    total: Object.fromEntries(snapshot.years.map((year) => [year.year, year.totalContributions])),
    contributions: snapshot.years.flatMap((year) => year.counts.map((count, index) => ({
      date: new Date(Date.UTC(year.year, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
      count, level: Number(year.levels[index]),
    }))),
  };
  const years = parseContributionResponse(response, snapshot.updatedAt);
  for (const year of years) {
    const source = snapshot.years.find((entry) => entry.year === year.year);
    assert.deepEqual(year.days.map((day) => day.count), source.counts);
    assert.equal(year.days.map((day) => day.level).join(""), source.levels);
    assert.equal(year.totalContributions, source.totalContributions);
    assert.equal(year.totalCommits, null);
  }
});

test("누락된 날짜와 중복 날짜 및 합계에 없는 연도를 거부한다", () => {
  const missing = contributionFixture();
  missing.contributions.splice(1, 1);
  assert.throws(() => parseContributionResponse(missing, updatedAt));
  const duplicate = contributionFixture();
  duplicate.contributions[1] = { ...duplicate.contributions[0] };
  assert.throws(() => parseContributionResponse(duplicate, updatedAt));
  const extraYear = contributionFixture();
  extraYear.contributions[0].date = "2025-01-01";
  assert.throws(() => parseContributionResponse(extraYear, updatedAt));
});

test("존재하지 않는 날짜와 잘못된 숫자 및 활동 단계를 거부한다", () => {
  const invalidDays = [
    { date: "2026-02-29" }, { date: "2026-01-32" }, { date: "2026-1-01" },
    { count: -1 }, { count: 1.5 }, { count: "1" }, { count: NaN }, { count: Number.MAX_SAFE_INTEGER + 1 },
    { level: 5 }, { level: "0" }, { count: 0, level: 1 }, { count: 1, level: 0 },
  ];
  for (const invalid of invalidDays) {
    const response = contributionFixture();
    Object.assign(response.contributions[0], invalid);
    assert.throws(() => parseContributionResponse(response, updatedAt));
  }
});

test("손상된 합계와 비어 있거나 오류인 응답을 거부한다", () => {
  for (const total of [-1, 0.5, "0", NaN, Number.MAX_SAFE_INTEGER + 1, 1]) {
    const response = contributionFixture();
    response.total[2026] = total;
    assert.throws(() => parseContributionResponse(response, updatedAt));
  }
  for (const value of [null, [], {}, { error: "rate limit exceeded" }, { total: {}, contributions: [] }, { total: [], contributions: [] }, { total: { 2026: 0 }, contributions: {} }]) {
    assert.throws(() => parseContributionResponse(value, updatedAt));
  }
});

test("조회 시각과 미래 연도를 검증하고 새해에는 새 연도를 허용한다", () => {
  for (const invalid of ["", "2026-11-14", "2026-02-30T00:00:00Z", "2026-11-14T25:00:00Z", "not-a-date"]) {
    assert.throws(() => parseContributionResponse(contributionFixture(), invalid));
  }
  assert.throws(() => parseContributionResponse(contributionFixture([2027]), updatedAt));
  assert.throws(() => parseContributionResponse({ total: { lastYear: 0 }, contributions: contributionFixture().contributions }, updatedAt));
  const [newYear] = parseContributionResponse(contributionFixture([2027]), "2027-01-01T00:00:00Z");
  assert.equal(newYear.year, 2027);
  assert.equal(newYear.days.length, 365);
  assert.equal(newYear.totalCommits, null);
});

test("시간대와 높은 소수점 정밀도를 가진 유효 ISO 조회 시각을 보존한다", () => {
  const timestamp = "2026-11-14T15:55:41.396718+00:00";
  const [year] = parseContributionResponse(contributionFixture(), timestamp);
  assert.equal(year.updatedAt, timestamp);
});

test("nullable 이름과 소개를 보존하고 갱신 시각으로 아바타 주소를 버전 지정한다", () => {
  const profile = parseGitHubProfile(profileFixture({ name: null, bio: null }), "dijeungi");
  const avatar = new URL(profile.avatarUrl);
  assert.equal(profile.name, null);
  assert.equal(profile.bio, null);
  assert.equal(profile.profileUrl, "https://github.com/dijeungi");
  assert.equal(avatar.searchParams.get("v"), "4");
  assert.equal(avatar.searchParams.get("updated"), "2026-11-14T10:20:30Z");
  assert.equal(new URL(parseGitHubProfile(profileFixture({ updated_at: "2026-11-15T10:20:30Z" }), "dijeungi").avatarUrl).searchParams.get("updated"), "2026-11-15T10:20:30Z");
});

test("유효하지 않은 선택적 프로필 갱신 시각은 사진 주소에 넣지 않는다", () => {
  for (const updated_at of [undefined, null, "invalid", "2026-02-30T00:00:00Z"]) {
    const profile = parseGitHubProfile(profileFixture({ updated_at }), "dijeungi");
    assert.equal(profile.avatarUrl, profileFixture().avatar_url);
  }
});

test("프로필 로그인과 공식 URL 및 문자열 필드의 변조를 거부한다", () => {
  const invalidProfiles = [
    { login: "other" }, { html_url: "http://github.com/dijeungi" },
    { html_url: "https://github.com.evil.example/dijeungi" }, { html_url: "https://github.com/other" },
    { avatar_url: "http://avatars.githubusercontent.com/u/1" },
    { avatar_url: "https://avatars.githubusercontent.com.evil.example/u/1" },
    { avatar_url: "https://user:password@avatars.githubusercontent.com/u/1" },
    { avatar_url: "https://avatars.githubusercontent.com:8443/u/1" },
    { avatar_url: "not-a-url" }, { avatar_url: null }, { name: undefined }, { bio: false },
  ];
  for (const invalid of invalidProfiles) {
    assert.throws(() => parseGitHubProfile(profileFixture(invalid), "dijeungi"));
  }
  for (const value of [null, [], {}, { error: "API rate limit exceeded" }]) {
    assert.throws(() => parseGitHubProfile(value, "dijeungi"));
  }
  assert.throws(() => parseGitHubProfile(profileFixture(), "other"));
  assert.throws(() => parseGitHubProfile(profileFixture(), ""));
});
