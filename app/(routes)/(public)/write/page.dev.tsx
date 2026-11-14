import { PostWriter } from "./_components/PostWriter";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "글쓰기",
  robots: { index: false, follow: false },
};

// 로컬 글쓰기 화면 진입
export default function WritePage() {
  return <PostWriter />;
}
