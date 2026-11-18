export const postSlugMigrations = [
  {
    previous: "codex-computer-use가-내-작업을-방해한다면-ccuh-개발기",
    current: "1",
    retainDiscussion: true,
  },
  { previous: "ccuh-development", current: "1", retainDiscussion: false },
] as const;

// 이전 주소에 대응하는 현재 글 슬러그
export function canonicalPostSlug(slug: string): string {
  const normalizedSlug = slug.normalize("NFC");
  return postSlugMigrations.find(({ previous }) => previous === normalizedSlug)?.current ?? normalizedSlug;
}

// 글 주소 변경 전 생성된 댓글 토론의 식별자
export function postDiscussionSlug(slug: string): string {
  return postSlugMigrations.find(({ current, retainDiscussion }) => (
    current === slug && retainDiscussion
  ))?.previous ?? slug;
}

// 공개 글 경로 구성
export function postPath(slug: string): string {
  return "/posts/" + encodeURIComponent(slug) + "/";
}
