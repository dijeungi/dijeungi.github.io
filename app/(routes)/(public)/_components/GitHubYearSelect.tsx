"use client";

import { LuChevronDown } from "react-icons/lu";

import { useGitHubYearSelect } from "../_hooks/useGitHubYearSelect";

import styles from "../GitHubOverview.module.css";

import type { GitHubYearSelectProps } from "../_types/home";

// GitHub 활동 연도의 접근 가능한 선택 메뉴 표시
export function GitHubYearSelect({ years, selectedYear, onSelect }: GitHubYearSelectProps) {
  const { isOpen, activeYear, rootRef, triggerRef, listboxId, optionId, toggleMenu, chooseYear, activateYear, onKeyDown } = useGitHubYearSelect(years, selectedYear, onSelect);

  return (
    <div className={styles.yearPicker} ref={rootRef}>
      <button
        className={styles.yearTrigger}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={"GitHub 활동 연도" + (selectedYear === null ? "" : ", " + selectedYear + "년")}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && activeYear !== null ? optionId(activeYear) : undefined}
        disabled={years.length === 0}
        onClick={toggleMenu}
        onKeyDown={onKeyDown}
      >
        <span>{selectedYear === null ? "연도" : selectedYear + "년"}</span>
        <LuChevronDown className={styles.yearChevron} size={12} aria-hidden="true" focusable="false" />
      </button>
      {isOpen && (
        <div className={styles.yearMenu} id={listboxId} role="listbox" aria-label="GitHub 활동 연도">
          {years.map((year) => (
            <button
              className={styles.yearOption}
              id={optionId(year)}
              key={year}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={year === selectedYear}
              data-active={year === activeYear}
              onMouseEnter={() => activateYear(year)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseYear(year)}
            >
              {year}년
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
