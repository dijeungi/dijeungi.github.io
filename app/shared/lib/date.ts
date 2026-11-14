const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  year: "numeric",
  month: "short",
  timeZone: "UTC",
});

// 게시일을 영문 월과 날짜 및 연도로 표시
export function formatPostDate(date: string): string {
  return dateFormatter.format(new Date(date + "T00:00:00Z"));
}
