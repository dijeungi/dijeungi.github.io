import type { GitHubTooltipAnchor, GitHubTooltipPosition } from "../_types/github";

// 화면 가장자리를 피한 잔디 말풍선과 화살표 위치 계산
export function getGitHubTooltipPosition(anchor: GitHubTooltipAnchor, size: { width: number; height: number }, viewport: { width: number; height: number }): GitHubTooltipPosition {
  const padding = 8;
  const offset = 8;
  const center = (anchor.left + anchor.right) / 2;
  const halfWidth = size.width / 2;
  const left = Math.max(padding + halfWidth, Math.min(viewport.width - padding - halfWidth, center));
  const fitsAbove = anchor.top - offset - size.height >= padding;
  const fitsBelow = anchor.bottom + offset + size.height <= viewport.height - padding;
  const placement = fitsAbove || (!fitsBelow && anchor.top >= viewport.height - anchor.bottom) ? "top" : "bottom";
  const preferredTop = placement === "top" ? anchor.top - offset - size.height : anchor.bottom + offset;
  const boxTop = Math.max(padding, Math.min(viewport.height - padding - size.height, preferredTop));
  const arrowLeft = Math.max(8, Math.min(size.width - 8, center - left + halfWidth));
  return { left, top: placement === "top" ? boxTop + size.height : boxTop, arrowLeft, placement };
}
