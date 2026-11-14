export type GitHubProfile = {
  login: string;
  name: string | null;
  bio: string | null;
  avatarUrl: string;
  profileUrl: string;
};

export type GitHubContributionDay = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type GitHubContributionYear = {
  year: number;
  totalContributions: number;
  totalCommits: number | null;
  days: GitHubContributionDay[];
};

export type GitHubCalendarYear = GitHubContributionYear & { updatedAt: string };

export type GitHubOverview = {
  profile: GitHubProfile;
  years: GitHubCalendarYear[];
  updatedAt: string;
  source: "github" | "snapshot" | "public-api";
};

export type GitHubLiveUpdates = {
  login: string;
  profile: GitHubProfile | null;
  years: GitHubCalendarYear[] | null;
  profileCheckedAt: number;
  calendarCheckedAt: number;
  checkedAt: number;
};

export type GitHubSnapshotYear = {
  year: number;
  totalContributions: number;
  counts: number[];
  levels: string;
};
