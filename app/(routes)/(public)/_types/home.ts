import type { RefObject } from "react";

import type { Post } from "@/app/shared/types/post";
import type { GitHubOverview, GitHubTooltipData } from "./github";

export type HomePost = Pick<
  Post,
  "slug" | "title" | "description" | "category" | "date" | "readingMinutes" | "heroImage"
>;

export type HomePageProps = { posts: HomePost[]; github: GitHubOverview };

export type GitHubOverviewProps = Pick<HomePageProps, "github">;

export type GitHubYearSelectProps = {
  years: number[];
  selectedYear: number | null;
  onSelect: (year: number) => void;
};

export type GitHubCalendarTooltipProps = {
  tooltip: GitHubTooltipData | null;
  tooltipRef: RefObject<HTMLDivElement | null>;
  tooltipId: string;
  onEnter: () => void;
  onLeave: () => void;
};

export type HomeCategory = { name: string; count: number };

export type HomeSelection = { category: string | null; page: number };
