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

export type GitHubTooltipAnchor = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

export type GitHubTooltipPosition = {
  left: number;
  top: number;
  arrowLeft: number;
  placement: "top" | "bottom";
};

export type GitHubTooltipTarget = {
  date: string;
  rect: GitHubTooltipAnchor;
  source: "pointer" | "keyboard";
};

export type GitHubTooltipData = {
  date: string;
  count: number;
  position: GitHubTooltipPosition | null;
};
