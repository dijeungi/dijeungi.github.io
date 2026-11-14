import { HomePage } from "./_components/HomePage";
import { getGitHubOverview } from "./_lib/github.server";
import { getAllPosts } from "@/app/shared/data/published-posts";
import { siteName, siteDescription } from "@/app/shared/constants/site";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: siteName },
  description: siteDescription,
  openGraph: { type: "website", title: siteName, description: siteDescription },
};

// 발행 글과 기존 글을 모은 메인 페이지
export default async function BlogPage() {
  const [posts, github] = await Promise.all([getAllPosts(), getGitHubOverview()]);
  const previews = posts.map(({ slug, title, description, category, date, readingMinutes, heroImage }) => ({
    slug, title, description, category, date, readingMinutes, heroImage,
  }));

  return <HomePage posts={previews} github={github} />;
}
