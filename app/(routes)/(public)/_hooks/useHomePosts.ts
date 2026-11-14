"use client";

import { useState } from "react";

import type { HomePost, HomeCategory, HomeSelection } from "../_types/home";

const postsPerPage = 5;
const maximumPageNumbers = 5;

// 실제 글의 카테고리 집계와 선택한 목록 관리
export function useHomePosts(posts: HomePost[]) {
  const [selection, setSelection] = useState<HomeSelection>({ category: null, page: 1 });
  const counts = new Map<string, number>();

  for (const post of posts) {
    counts.set(post.category, (counts.get(post.category) ?? 0) + 1);
  }

  const categories: HomeCategory[] = Array.from(counts, ([name, count]) => ({ name, count }));
  const selectedCategory = selection.category !== null && counts.has(selection.category)
    ? selection.category
    : null;
  const filteredPosts = selectedCategory === null
    ? posts
    : posts.filter((post) => post.category === selectedCategory);
  const filteredPostCount = filteredPosts.length;
  const totalPages = Math.ceil(filteredPostCount / postsPerPage);
  const currentPage = Math.max(1, Math.min(selection.page, totalPages));
  const firstPageNumber = Math.max(
    1,
    Math.min(currentPage - Math.floor(maximumPageNumbers / 2), totalPages - maximumPageNumbers + 1),
  );
  const pageNumbers = Array.from(
    { length: Math.min(totalPages, maximumPageNumbers) },
    (_, index) => firstPageNumber + index,
  );
  const visiblePosts = filteredPosts.slice((currentPage - 1) * postsPerPage, currentPage * postsPerPage);

  // 전체 글 또는 개별 카테고리 선택
  function selectCategory(category: string | null) {
    setSelection({ category, page: 1 });
  }

  // 유효한 글 목록 페이지 선택
  function selectPage(page: number) {
    if (!Number.isInteger(page) || totalPages === 0) return;
    setSelection({ category: selectedCategory, page: Math.max(1, Math.min(page, totalPages)) });
  }

  return {
    categories,
    currentPage,
    totalPages,
    pageNumbers,
    visiblePosts,
    filteredPostCount,
    selectedCategory,
    selectPage,
    selectCategory,
  };
}
