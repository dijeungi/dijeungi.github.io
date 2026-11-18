import { request } from "node:https";

import { parseGitHubProfile } from "./github-live";
import { githubLogin } from "@/app/shared/constants/site";
import { parseContributionCalendar, expandContributionSnapshot } from "./github-calendar";

import snapshot from "../_data/github-snapshot.json";

import type { GitHubOverview } from "../_types/github";

// 빌드 서버에서만 GitHub 응답 읽기
function readGitHub(url: string, token?: string, body?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (compatible; JunHoTechBlog/1.0)",
      "Accept-Language": "en-US",
      Accept: url.includes("api.github.com") ? "application/vnd.github+json" : "text/html",
    };
    if (token) headers.Authorization = "Bearer " + token;
    if (body) headers["Content-Type"] = "application/json";
    const gitHubRequest = request(url, { headers, method: body ? "POST" : "GET", signal: AbortSignal.timeout(10_000) }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("GitHub 응답을 받지 못했습니다: " + response.statusCode));
        return;
      }
      let length = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 2_000_000) gitHubRequest.destroy(new Error("GitHub 응답이 너무 큽니다."));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("GitHub 응답이 중단되었습니다.")));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    gitHubRequest.on("error", reject);
    gitHubRequest.end(body);
  });
}

// GitHub 응답의 객체 여부 확인
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// CI에서 허용되는 경우 연간 실제 커밋 수 조회
async function getCommitCounts(years: number[], now: Date): Promise<Map<number, number>> {
  const token = process.env.GITHUB_TOKEN;
  const counts = new Map<number, number>();
  if (!token) return counts;
  const fields = years.map((year) => {
    const to = year === now.getUTCFullYear() ? now.toISOString() : year + "-12-31T23:59:59Z";
    return `year${year}: contributionsCollection(from: "${year}-01-01T00:00:00Z", to: "${to}") { totalCommitContributions }`;
  }).join("\n");
  try {
    const body = JSON.stringify({ query: `query { user(login: "${githubLogin}") { ${fields} } }` });
    const value: unknown = JSON.parse(await readGitHub("https://api.github.com/graphql", token, body));
    if (!isRecord(value) || value.errors || !isRecord(value.data) || !isRecord(value.data.user)) return counts;
    for (const year of years) {
      const result = value.data.user["year" + year];
      if (isRecord(result) && typeof result.totalCommitContributions === "number" && Number.isSafeInteger(result.totalCommitContributions) && result.totalCommitContributions >= 0) {
        counts.set(year, result.totalCommitContributions);
      }
    }
  } catch {
    console.warn("GitHub 커밋 수를 불러오지 못해 공개 기여수만 표시합니다.");
  }
  return counts;
}

// 메인 상단에 사용할 공개 GitHub 프로필과 연간 활동 구성
export async function getGitHubOverview(): Promise<GitHubOverview> {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const firstYear = new Date(snapshot.createdAt).getUTCFullYear();
  const years = Array.from({ length: currentYear - firstYear + 1 }, (_, index) => currentYear - index);
  const fallbackYears = new Map(snapshot.years.map((year) => [year.year, expandContributionSnapshot(year)]));
  const [profileResult, calendarResults, commitCounts] = await Promise.all([
    readGitHub("https://api.github.com/users/" + githubLogin).then((text) => parseGitHubProfile(JSON.parse(text), githubLogin)).then(
      (profile) => ({ profile, fresh: true }),
      () => ({ profile: snapshot.profile, fresh: false }),
    ),
    Promise.all(years.map(async (year) => {
      try {
        const html = await readGitHub("https://github.com/users/" + githubLogin + "/contributions?from=" + year + "-01-01&to=" + year + "-12-31");
        return { data: parseContributionCalendar(html, year), fresh: true };
      } catch {
        return { data: fallbackYears.get(year), fresh: false };
      }
    })),
    getCommitCounts(years, now),
  ]);
  const fresh = profileResult.fresh && calendarResults.every((result) => result.fresh);
  if (!fresh) console.warn("GitHub 공개 정보 일부를 갱신하지 못해 마지막으로 확인한 데이터를 사용합니다.");
  return {
    profile: profileResult.profile,
    profileUpdatedAt: profileResult.fresh ? now.toISOString() : snapshot.updatedAt,
    years: calendarResults.flatMap(({ data, fresh: calendarFresh }) => data ? [{
      ...data,
      totalCommits: commitCounts.get(data.year) ?? null,
      updatedAt: calendarFresh ? now.toISOString() : snapshot.updatedAt,
    }] : []),
    updatedAt: fresh ? now.toISOString() : snapshot.updatedAt,
    source: fresh ? "github" : "snapshot",
  };
}
