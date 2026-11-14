import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  parseContributionCalendar,
  expandContributionSnapshot,
} from "../app/(routes)/(public)/_lib/github-calendar.ts";

// 공개 GitHub 응답과 같은 날짜 및 툴팁을 가진 연간 검증 자료 생성
function calendarFixture(year, contributions = {}) {
  const start = Date.UTC(year, 0, 1);
  const length = (Date.UTC(year + 1, 0, 1) - start) / 86_400_000;
  return Array.from({ length }, (_, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const count = contributions[date] ?? 0;
    const label = count === 0 ? "No contributions" : `${count.toLocaleString("en-US")} contribution${count === 1 ? "" : "s"}`;
    return `<td id="day-${index}" data-date="${date}" data-level="${count ? 4 : 0}"></td><tool-tip for="day-${index}">${label} on ${date}.</tool-tip>`;
  }).join("");
}

test("툴팁의 실제 기여수를 읽고 윤년 날짜와 연간 합계를 보존한다", () => {
  const html = calendarFixture(2024, { "2024-02-29": 1234, "2024-12-31": 1 });
  const calendar = parseContributionCalendar(html, 2024);
  assert.equal(calendar.days.length, 366);
  assert.deepEqual(calendar.days[59], { date: "2024-02-29", count: 1234, level: 4 });
  assert.equal(calendar.days[365].count, 1);
  assert.equal(calendar.totalContributions, 1235);
  assert.equal(calendar.totalCommits, null);
});

test("달력 가장자리의 다른 연도는 현재 연도 집계에 포함하지 않는다", () => {
  const edge = '<td id="edge" data-date="2025-12-31" data-level="4"></td><tool-tip for="edge">99 contributions on December 31.</tool-tip>';
  const calendar = parseContributionCalendar(edge + calendarFixture(2026), 2026);
  assert.equal(calendar.days.length, 365);
  assert.equal(calendar.days[0].date, "2026-01-01");
  assert.equal(calendar.days.at(-1).date, "2026-12-31");
  assert.equal(calendar.totalContributions, 0);
});

test("일별 실제 숫자가 없거나 일부 날짜만 있는 응답을 거부한다", () => {
  const html = calendarFixture(2026);
  assert.throws(() => parseContributionCalendar(html.replace('<tool-tip for="day-0">No contributions on 2026-01-01.</tool-tip>', ""), 2026));
  assert.throws(() => parseContributionCalendar(html.replace('data-date="2026-01-01"', 'data-date="2025-12-31"'), 2026));
  assert.throws(() => parseContributionCalendar("", 2026));
});

test("중복 날짜나 실제 숫자와 맞지 않는 활동 단계를 거부한다", () => {
  const html = calendarFixture(2026);
  assert.throws(() => parseContributionCalendar(html + '<td id="day-0" data-date="2026-01-01" data-level="0"></td>', 2026));
  assert.throws(() => parseContributionCalendar(html.replace('data-level="0"', 'data-level="1"'), 2026));
  assert.throws(() => parseContributionCalendar(html.replace('data-level="0"', 'data-level="5"'), 2026));
});

test("보관한 공개 데이터의 일별 합계와 윤년을 원본 그대로 복원한다", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../app/(routes)/(public)/_data/github-snapshot.json", import.meta.url), "utf8"));
  const expected = new Map([[2024, 5], [2025, 2378], [2026, 3134]]);
  assert.equal(snapshot.profile.login, "dijeungi");
  for (const year of snapshot.years) {
    const calendar = expandContributionSnapshot(year);
    assert.equal(calendar.totalContributions, expected.get(year.year));
    assert.equal(calendar.days.length, year.year === 2024 ? 366 : 365);
    assert.equal(calendar.days[0].date, `${year.year}-01-01`);
    assert.equal(calendar.days.at(-1).date, `${year.year}-12-31`);
    assert.equal(calendar.totalCommits, null);
  }
});

test("보관 데이터의 손상된 합계와 날짜 수 및 빈 활동 단계를 거부한다", () => {
  const snapshot = { year: 2026, totalContributions: 0, counts: Array(365).fill(0), levels: "0".repeat(365) };
  assert.throws(() => expandContributionSnapshot({ ...snapshot, totalContributions: 1 }));
  assert.throws(() => expandContributionSnapshot({ ...snapshot, counts: [0] }));
  assert.throws(() => expandContributionSnapshot({ ...snapshot, levels: " " + snapshot.levels.slice(1) }));
  assert.throws(() => expandContributionSnapshot({ ...snapshot, year: 2024 }));
});
