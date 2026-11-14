"use client";

import Image from "next/image";

import { GitHubYearSelect } from "./GitHubYearSelect";
import { useGitHubOverview } from "../_hooks/useGitHubOverview";
import { useGitHubCalendar } from "../_hooks/useGitHubCalendar";
import { GitHubCalendarTooltip } from "./GitHubCalendarTooltip";
import { useGitHubCalendarTooltip } from "../_hooks/useGitHubCalendarTooltip";

import styles from "../GitHubOverview.module.css";
import frameStyles from "@/app/shared/styles/PageFrame.module.css";

import type { GitHubOverviewProps } from "../_types/home";

const numberFormatter = new Intl.NumberFormat("ko-KR");
const weekdays = ["", "월", "", "수", "", "금", ""];
const levelClasses = [styles.level0, styles.level1, styles.level2, styles.level3, styles.level4] as const;

// GitHub 프로필과 연도별 실제 기여 활동 표시
export function GitHubOverview({ github }: GitHubOverviewProps) {
  const overview = useGitHubOverview(github);
  const { profile, updatedAt } = overview;
  const displayName = profile.name || profile.login;
  const { cells, months, asOfDate, weekCount, selectedYear, availableYears, selectYear } = useGitHubCalendar(overview.years, updatedAt);
  const { tooltip, tooltipRef, viewportRef, tooltipId, onPointerOver, onKeyDown, keepTooltip, hideTooltip, scheduleHide } = useGitHubCalendarTooltip(selectedYear, profile);
  const hasCalendar = selectedYear !== null && selectedYear.days.length > 0;
  const gridColumns = "repeat(" + weekCount + ", minmax(0, 1fr))";

  return (
    <section className={styles.overview + " " + frameStyles.content} aria-label="GitHub 프로필과 활동">
      <div className={styles.profile}>
        <a className={styles.avatarLink} href={profile.profileUrl} target="_blank" rel="noreferrer" aria-label={profile.login + " GitHub 프로필 보기"}>
          <Image className={styles.avatar} src={profile.avatarUrl} alt={displayName + " 프로필 사진"} width={112} height={112} unoptimized />
        </a>
        <div className={styles.identity}>
          <a className={styles.name} href={profile.profileUrl} target="_blank" rel="noreferrer">{displayName}</a>
          <p className={styles.login}>{profile.login}</p>
          {profile.bio && <p className={styles.bio}>{profile.bio}</p>}
        </div>
      </div>

      <div className={styles.activity}>
        <div className={styles.toolbar}>
          <div>
            <h2 className={styles.total}>{selectedYear ? numberFormatter.format(selectedYear.totalContributions) + "회 기여" : "GitHub 활동"}</h2>
            {selectedYear?.totalCommits != null && <p className={styles.commits}>커밋 {numberFormatter.format(selectedYear.totalCommits)}회</p>}
          </div>
          <GitHubYearSelect years={availableYears.map((entry) => entry.year)} selectedYear={selectedYear?.year ?? null} onSelect={(year) => { hideTooltip(); selectYear(year); }} />
        </div>

        {hasCalendar && selectedYear ? (
          <>
            <div
              className={styles.calendarViewport}
              ref={viewportRef}
              role="group"
              aria-label={selectedYear.year + "년 GitHub 기여 달력. 총 " + numberFormatter.format(selectedYear.totalContributions) + "회 기여. " + asOfDate + " 조회 결과이며 진한 초록색일수록 기여가 많습니다. 방향키로 날짜별 활동을 확인할 수 있습니다."}
              aria-describedby={tooltip ? tooltipId : undefined}
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End Escape"
              tabIndex={0}
              onPointerOver={onPointerOver}
              onPointerLeave={scheduleHide}
              onKeyDown={onKeyDown}
              onBlur={hideTooltip}
            >
              <div className={styles.calendarCanvas} style={{ gridTemplateColumns: "18px " + gridColumns }} aria-hidden="true">
                {months.map((month) => <span className={styles.month} key={month.label} style={{ gridColumnStart: month.column + 1 }}>{month.label}</span>)}
                {weekdays.map((day, index) => day && (
                  <span className={styles.weekday} key={index} style={{ gridRowStart: index + 2 }}><span>{day}</span></span>
                ))}
                {cells.map(({ day, isFuture }, index) => (
                  <span
                    className={styles.day + " " + (day === null ? styles.blank : levelClasses[isFuture ? 0 : day.level])}
                    key={day?.date ?? "padding-" + index}
                    style={{ gridColumnStart: Math.floor(index / 7) + 2, gridRowStart: index % 7 + 2 }}
                    data-date={day?.date}
                    data-count={isFuture ? 0 : day?.count}
                    data-level={isFuture ? 0 : day?.level}
                  />
                ))}
              </div>
            </div>
            <div className={styles.calendarFooter}>
              <p className={styles.updated}>{asOfDate.replaceAll("-", ". ")} 조회</p>
              <div className={styles.legend} aria-label="기여 횟수는 옅은 색에서 진한 색까지 다섯 단계로 표시됩니다.">
                <span>적음</span>
                {levelClasses.map((level, index) => <span className={styles.legendCell + " " + level} key={index} aria-hidden="true" />)}
                <span>많음</span>
              </div>
            </div>
          </>
        ) : <p className={styles.unavailable}>GitHub 활동 정보를 표시할 수 없습니다.</p>}
      </div>
      <GitHubCalendarTooltip tooltip={tooltip} tooltipRef={tooltipRef} tooltipId={tooltipId} onEnter={keepTooltip} onLeave={scheduleHide} />
    </section>
  );
}
