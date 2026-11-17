import type { SVGProps } from "react";
import type { WriterIconName } from "../_types/writer";

const paths: Record<WriterIconName, string> = {
  bold: "M6 3h5a4 4 0 0 1 0 8H6zm0 8h6a4 4 0 0 1 0 8H6z",
  italic: "M10 3h8M4 19h8M14 3 8 19",
  strike: "M16 5c-1-2-7-3-9 0-1 2 1 4 4 5M6 17c2 3 8 3 10 0 1-2 0-4-3-5M3 11h18",
  link: "m9 14 6-6M8 6l2-2a4 4 0 0 1 6 6l-2 2M14 16l-2 2a4 4 0 0 1-6-6l2-2",
  bullets: "M8 5h12M8 11h12M8 17h12M3 5h.1M3 11h.1M3 17h.1",
  numbers: "M9 5h11M9 11h11M9 17h11M3 3h1v5M3 11c2-2 4 0 1 2l-1 1h3M3 17c3-2 4 2 1 2h-1",
  code: "m7 6-5 5 5 5m10-10 5 5-5 5M14 3l-4 16",
  image: "M3 3h18v16H3zM3 15l5-5 5 5 3-3 5 5M14 7h.1",
  undo: "M8 5 3 10l5 5M3 10h10a6 6 0 0 1 0 12",
  redo: "m16 5 5 5-5 5M21 10H11a6 6 0 0 0 0 12",
  back: "M20 12H4m6-6-6 6 6 6",
  check: "m5 12 4 4L19 6",
  plus: "M12 4v16M4 12h16",
  edit: "M16 3l5 5L9 20l-6 1 1-6L16 3zM14 5l5 5",
};

// 글쓰기 도구의 선형 아이콘
export function WriterIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: WriterIconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
