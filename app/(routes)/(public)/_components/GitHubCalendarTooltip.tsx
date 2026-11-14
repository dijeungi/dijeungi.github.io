"use client";

import { createPortal } from "react-dom";

import { formatPostDate } from "@/app/shared/lib/date";

import styles from "../GitHubOverview.module.css";

import type { GitHubCalendarTooltipProps } from "../_types/home";

const numberFormatter = new Intl.NumberFormat("ko-KR");

// 실제 기여수와 날짜를 본문 밖 말풍선으로 표시
export function GitHubCalendarTooltip({ tooltip, tooltipRef, tooltipId, onEnter, onLeave }: GitHubCalendarTooltipProps) {
  if (!tooltip) return null;
  const { date, count, position } = tooltip;

  return createPortal(
    <div
      className={styles.calendarTooltip}
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      data-placement={position?.placement ?? "top"}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <strong>{numberFormatter.format(count)}회 기여</strong>
      <span className={styles.calendarTooltipDate}>{formatPostDate(date)}</span>
      <span className={styles.calendarTooltipArrow} style={{ left: position?.arrowLeft ?? 0 }} aria-hidden="true" />
    </div>,
    document.body,
  );
}
