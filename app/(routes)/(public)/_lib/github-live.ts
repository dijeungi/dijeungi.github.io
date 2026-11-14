import type { GitHubProfile, GitHubCalendarYear, GitHubContributionDay } from "../_types/github";

// 공개 응답의 객체 여부 확인
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 실제 달력에 존재하는 ISO 날짜 확인
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// 날짜와 시간대가 명시된 ISO 시각 확인
function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && isIsoDate(value.slice(0, 10))
    && Number.isFinite(Date.parse(value));
}

// 공개 프로필 검증과 프로필 사진 갱신 주소 구성
export function parseGitHubProfile(value: unknown, login: string): GitHubProfile {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login) || !isRecord(value) || value.login !== login || value.html_url !== "https://github.com/" + login || typeof value.avatar_url !== "string" || (value.name !== null && typeof value.name !== "string") || (value.bio !== null && typeof value.bio !== "string")) {
    throw new Error("GitHub 공개 프로필을 읽지 못했습니다.");
  }
  let avatar: URL;
  try {
    avatar = new URL(value.avatar_url);
  } catch {
    throw new Error("GitHub 프로필 사진 주소가 올바르지 않습니다.");
  }
  if (avatar.protocol !== "https:" || avatar.hostname !== "avatars.githubusercontent.com" || avatar.username || avatar.password || avatar.port) {
    throw new Error("GitHub 프로필 사진 주소가 올바르지 않습니다.");
  }
  if (isIsoTimestamp(value.updated_at)) avatar.searchParams.set("updated", value.updated_at);
  return { login, name: value.name, bio: value.bio, avatarUrl: avatar.href, profileUrl: value.html_url };
}

// 공개 기여 API의 완전한 연간 날짜와 실제 기여수 검증
export function parseContributionResponse(value: unknown, updatedAt: string): GitHubCalendarYear[] {
  if (!isIsoTimestamp(updatedAt) || !isRecord(value) || !isRecord(value.total) || !Array.isArray(value.contributions)) {
    throw new Error("GitHub 공개 활동 응답을 읽지 못했습니다.");
  }
  const currentYear = new Date(updatedAt).getUTCFullYear();
  const calendars = new Map<number, { totalContributions: number; days: Map<string, GitHubContributionDay> }>();
  for (const [key, total] of Object.entries(value.total)) {
    const year = Number(key);
    if (!/^\d{4}$/.test(key) || year < 2000 || year > currentYear || typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) {
      throw new Error("GitHub 활동 연도나 합계가 올바르지 않습니다.");
    }
    calendars.set(year, { totalContributions: total, days: new Map() });
  }
  if (calendars.size === 0 || value.contributions.length === 0) {
    throw new Error("GitHub 연간 활동 데이터가 없습니다.");
  }
  for (const entry of value.contributions) {
    if (!isRecord(entry) || !isIsoDate(entry.date) || typeof entry.count !== "number" || !Number.isSafeInteger(entry.count) || entry.count < 0 || (entry.level !== 0 && entry.level !== 1 && entry.level !== 2 && entry.level !== 3 && entry.level !== 4) || (entry.count === 0) !== (entry.level === 0)) {
      throw new Error("GitHub 활동 날짜나 기여수와 단계가 올바르지 않습니다.");
    }
    const calendar = calendars.get(Number(entry.date.slice(0, 4)));
    if (!calendar || calendar.days.has(entry.date)) {
      throw new Error("GitHub 활동 날짜가 중복되거나 연도 범위가 다릅니다.");
    }
    calendar.days.set(entry.date, { date: entry.date, count: entry.count, level: entry.level });
  }
  return Array.from(calendars, ([year, calendar]) => {
    const start = Date.UTC(year, 0, 1);
    const length = (Date.UTC(year + 1, 0, 1) - start) / 86_400_000;
    const days = Array.from(calendar.days.values()).sort((first, second) => first.date.localeCompare(second.date));
    if (days.length !== length || days.reduce((sum, day) => sum + day.count, 0) !== calendar.totalContributions) {
      throw new Error("GitHub 연간 활동의 날짜가 누락되거나 합계가 다릅니다.");
    }
    return { year, days, updatedAt, totalCommits: null, totalContributions: calendar.totalContributions };
  }).sort((first, second) => second.year - first.year);
}
