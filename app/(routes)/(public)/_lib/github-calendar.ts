import type { GitHubContributionDay, GitHubContributionYear, GitHubSnapshotYear } from "../_types/github";

// 공개 캘린더 속성에서 날짜와 툴팁 식별자 추출
function readAttributes(markup: string): Record<string, string> {
  return Object.fromEntries(Array.from(markup.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g), (match) => [match[1], match[3]]));
}

// GitHub가 제공한 잔디 단계 검증
function parseLevel(value: number): GitHubContributionDay["level"] {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) return value;
  throw new Error("GitHub 활동 단계가 올바르지 않습니다.");
}

// 연도별 날짜 수 계산
function daysInYear(year: number): number {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error("GitHub 활동 연도가 올바르지 않습니다.");
  }
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
}

// 공개 캘린더의 실제 일별 기여수와 단계 읽기
export function parseContributionCalendar(html: string, year: number): GitHubContributionYear {
  const length = daysInYear(year);
  const counts = new Map<string, number>();
  const dates = new Map<string, GitHubContributionDay>();

  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi)) {
    const attributes = readAttributes(match[1]);
    const text = match[2].replace(/<[^>]*>/g, " ");
    const count = text.match(/\b([\d,]+) contributions?\b/i);
    if (attributes.for && (count || /\bNo contributions\b/i.test(text))) {
      counts.set(attributes.for, count ? Number(count[1].replaceAll(",", "")) : 0);
    }
  }

  for (const match of html.matchAll(/<td\b([^>]*)>/gi)) {
    const attributes = readAttributes(match[1]);
    const date = attributes["data-date"];
    if (!date?.startsWith(year + "-")) continue;
    const count = counts.get(attributes.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || count === undefined || !Number.isSafeInteger(count) || count < 0 || !/^[0-4]$/.test(attributes["data-level"] ?? "")) {
      throw new Error("GitHub 활동 날짜나 기여수를 읽지 못했습니다.");
    }
    const level = parseLevel(Number(attributes["data-level"]));
    if ((count === 0) !== (level === 0) || dates.has(date)) {
      throw new Error("GitHub 활동 날짜가 중복되거나 기여수와 단계가 다릅니다.");
    }
    dates.set(date, { date, count, level });
  }

  const days: GitHubContributionDay[] = [];
  for (let index = 0; index < length; index++) {
    const date = new Date(Date.UTC(year, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
    const day = dates.get(date);
    if (!day) throw new Error("GitHub 연간 활동의 일부 날짜가 누락되었습니다.");
    days.push(day);
  }
  if (dates.size !== length) throw new Error("GitHub 연간 활동의 날짜 범위가 올바르지 않습니다.");
  return { year, days, totalCommits: null, totalContributions: days.reduce((sum, day) => sum + day.count, 0) };
}

// 마지막으로 확인한 공개 활동 데이터를 날짜별로 복원
export function expandContributionSnapshot(snapshot: GitHubSnapshotYear): GitHubContributionYear {
  const length = daysInYear(snapshot.year);
  if (snapshot.counts.length !== length || snapshot.levels.length !== length || !/^[0-4]+$/.test(snapshot.levels)) {
    throw new Error("보관된 GitHub 활동의 날짜 수가 올바르지 않습니다.");
  }
  const days = snapshot.counts.map((count, index) => {
    const level = parseLevel(Number(snapshot.levels[index]));
    if (!Number.isSafeInteger(count) || count < 0 || (count === 0) !== (level === 0)) {
      throw new Error("보관된 GitHub 활동의 기여수가 올바르지 않습니다.");
    }
    return { count, level, date: new Date(Date.UTC(snapshot.year, 0, 1) + index * 86_400_000).toISOString().slice(0, 10) };
  });
  if (days.reduce((sum, day) => sum + day.count, 0) !== snapshot.totalContributions) {
    throw new Error("보관된 GitHub 활동의 합계가 올바르지 않습니다.");
  }
  return { year: snapshot.year, days, totalCommits: null, totalContributions: snapshot.totalContributions };
}
