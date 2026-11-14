# JunHo Tech Blog

흰 배경과 넓은 여백, 읽기 좋은 타이포그래피를 중심으로 구성한 기술 블로그입니다.

## 화면

- 메인 상단에는 GitHub 프로필 사진, 이름, 아이디와 Bio를 왼쪽에, 연도별 활동 달력을 오른쪽에 표시합니다. 연도 선택으로 가입 연도부터의 공개 활동을 볼 수 있습니다.
- 기본 주소 `/`에서 발행 글과 예시 글을 한 페이지에 5개씩 표시합니다. 왼쪽 세로 카테고리를 선택하면 해당 글만 볼 수 있고 첫 페이지로 돌아갑니다. 하단에는 최대 5개의 페이지 번호와 이전/다음 버튼을 표시합니다.
- 메인 목록은 왼쪽 가로형 썸네일과 오른쪽 글 정보로 구성합니다. 썸네일과 텍스트 영역의 위아래 높이를 맞추고, 별도 목록 제목과 작성자 배지는 표시하지 않습니다. 대표 이미지가 없는 글에는 카테고리 썸네일을 표시합니다.
- 메인과 상세 헤더는 `app/shared/styles/PageFrame.module.css`의 공통 컨테이너를 사용해 좌우 시작점과 끝점을 맞춥니다. 실제 내용 폭은 최대 1120px이며, 상세 대표 이미지의 최대 1440px과 바깥 그리드의 최대 1800px과 구분합니다.
- 글 상세에서는 상단 고정 제목, 읽기 진행률, 링크와 코드 복사를 제공합니다.
- 글 상세는 흰 배경에 파란 카테고리 배지와 굵은 제목, 날짜와 읽기 시간을 왼쪽 정렬합니다. 부설명은 표시하지 않습니다.
- 1800px 최대 그리드 안에서 제목 영역은 최대 1120px, 본문은 6열을 사용합니다.
- 헤더는 카테고리와 글 제목 영역의 최대 폭 1120px과 좌우 시작선을 공유합니다. 대표 이미지는 Google 레퍼런스의 미디어 영역과 같이 추가 좌우 여백 없이 최대 1440px로 표시하며, 뷰포트 1441px부터 모서리에 24px 반경을 적용합니다.
- 첫 번째 샘플 글에는 레퍼런스의 대표 이미지를 표시합니다. 480px 이하에서는 9:16, 그보다 넓은 화면에서는 16:9 비율을 사용합니다.
- 본문 폭과 행간을 중심으로 한 모바일 레이아웃을 적용했습니다.
- 글을 누르면 `/posts/[slug]/` 주소에서 상세를 볼 수 있습니다.
- 존재하지 않는 글 주소에는 404 안내를 표시합니다.

처음 표시되는 글 6개는 화면 확인용 샘플입니다. `/write/`에서 직접 글을 작성하고 발행할 수 있습니다.

대표 이미지는 Google 레퍼런스의 외부 이미지 주소를 사용합니다. 글별 이미지는 `app/shared/data/posts.ts`의 `heroImage`에서 지정합니다.

## 로컬 개발

`dijeungi.github.io/` 폴더에서 실행합니다. 이 폴더가 앱과 Git 저장소의 루트입니다.

Node.js 24 이상을 사용합니다.

```sh
npm run dev
```

터미널에 표시된 로컬 주소로 접속합니다. 기본 주소는 http://localhost:3000 입니다.

## 글쓰기

`npm run dev`는 블로그와 기기 내부의 글 저장 서버를 함께 실행합니다. 로컬 블로그 상단의 `글쓰기`를 누르거나 [로컬 글쓰기 화면](http://localhost:3000/write/)에서 제목, 카테고리, 날짜와 본문을 작성합니다. 개발 서버가 다른 포트를 사용하면 터미널에 표시된 주소 뒤에 `/write/`를 붙입니다.

- 본문에서 소제목, 굵게, 기울임, 목록, 인용과 코드 블록을 사용할 수 있습니다.
- 이미지와 대표 이미지를 올리고 설명을 입력할 수 있습니다.
- 임시저장과 자동저장은 이 컴퓨터의 `.editor/`에 보관하며 Git에 포함하지 않습니다.
- 미리보기는 실제 글 상세 화면과 같은 본문 렌더러를 사용합니다.
- 발행한 본문은 `content/posts/<글 주소>.json`, 이미지는 `public/uploads/`에 저장합니다.
- 발행 버튼은 해당 글과 이미지만 커밋한 뒤 `git push origin main`으로 블로그 저장소에 반영합니다. 자동 배포가 끝나면 공개 사이트에 표시됩니다.

글쓰기 기능을 처음 사용하기 전에는 이 기능의 코드 변경을 먼저 커밋해야 합니다. 공개 빌드에는 `/write/` 페이지를 내보내지 않아 해당 주소는 404로 처리됩니다. 기기 내부 저장 서버도 GitHub Pages에 배포되지 않으므로 글 저장과 발행은 로컬 주소에서 진행합니다.

읽는 시간을 `0`으로 두면 본문 길이를 기준으로 계산합니다. 글 소개는 검색 메타데이터에 사용하며 제목 아래 부설명으로 표시하지 않습니다.

## GitHub 프로필과 활동

공개 프로필과 가입 연도부터 현재 연도까지의 활동을 빌드 시 GitHub에서 가져와 첫 화면에 표시합니다. 페이지에 접속하면 브라우저에서 공개 정보를 다시 조회하며, 화면을 열어 둔 동안에는 5분 간격으로 변경을 확인합니다. 숨긴 탭에서는 조회를 멈추고 화면 복귀와 네트워크 재연결 때 조회 주기를 확인합니다. 같은 브라우저에서 목록과 상세를 오갈 때는 최근 5분 응답을 재사용합니다.

프로필은 GitHub 공개 API, 잔디는 [GitHub Contributions API](https://github.com/grubersjoe/github-contributions-api)에서 가져옵니다. 별도 배포나 방문자의 GitHub 로그인이 필요하지 않습니다. 기여 API는 GitHub 공식 서비스가 아니며 결과를 1시간 캐시합니다. GitHub 자체 기여 집계에도 지연이 있어 변경 직후 반영을 보장하지 않습니다. API 조회가 실패하면 표시 중인 정상 데이터를 유지합니다. 첫 빌드의 GitHub 조회도 실패하면 `app/(routes)/(public)/_data/github-snapshot.json`에 보관한 공개 데이터를 사용합니다.

- 잔디의 합계와 일별 숫자는 GitHub 공개 캘린더의 실제 기여 수입니다. 커밋 외에 PR 등도 포함하므로 `기여`로 표시합니다.
- 빌드 환경에 `GITHUB_TOKEN`이 있으면 GraphQL API로 초기 연간 커밋 수를 별도 조회합니다. 자동 갱신 API는 커밋 합계를 제공하지 않으므로 해당 연도 갱신 후에는 전체 기여 수만 표시합니다. 이전 커밋 수를 새 데이터와 섞지 않습니다.
- 배포 워크플로는 GitHub Actions의 기본 토큰을 빌드 단계에만 전달합니다. 토큰은 브라우저 데이터와 정적 결과물에 포함하지 않습니다.
- 브라우저 요청에는 토큰이나 로그인 정보를 포함하지 않습니다. 프로필과 잔디는 각각 검증하고 반영하므로 한쪽 조회가 실패해도 성공한 쪽은 갱신됩니다. 연도 선택은 갱신 뒤에도 유지됩니다.
- 프로필 수정 시각으로 사진 URL 버전을 바꿔 사진도 다시 불러옵니다. 달력 하단에는 조회 날짜를 `2026. 10. 26` 형식으로 표시하며, 미래 날짜도 기여 0회와 같은 회색 칸으로 표시합니다. 연도 선택 버튼의 안쪽 여백은 왼쪽 12px, 나머지 방향은 8px입니다.
- 월과 요일 및 잔디 칸은 하나의 grid에 배치하며, `GitHubOverview.module.css`의 `.calendarCanvas`에 있는 `gap: 3px` 한 값으로 가로와 세로 간격을 관리합니다.
- 연도 선택은 흰 배경과 얇은 테두리의 커스텀 목록을 사용합니다. 버튼과 화살표 사이 간격은 6px이며, 화살표 오른쪽에도 버튼 안쪽 여백 8px을 확보합니다. 방향키, Home/End, Enter/Space, Escape와 연도 숫자 입력을 지원하며 바깥을 누르거나 포커스를 옮기면 닫힙니다.
- 잔디를 가리키면 날짜와 실제 기여 수를 짙은 말풍선으로 표시합니다. 말풍선은 가로 스크롤 영역 밖에 배치하고 화면 가장자리를 피합니다. 포인터를 말풍선으로 옮겨도 유지되며 Escape, 연도 변경이나 화면 이동으로 닫힙니다. 달력에 탭으로 진입한 뒤 방향키와 Home/End로 날짜를 탐색할 수도 있습니다.

## 댓글

발행한 글 상세의 본문 아래에 [giscus](https://giscus.app/ko) 댓글을 표시합니다. 방문자는 GitHub 계정으로 로그인해 댓글을 남길 수 있으며, 댓글은 [블로그 저장소의 Discussions](https://github.com/dijeungi/dijeungi.github.io/discussions)에 보관합니다.

처음 사용할 때는 [giscus 앱 설치](https://github.com/apps/giscus/installations/new)에서 `Only select repositories`를 선택하고 `dijeungi.github.io` 저장소를 지정합니다. 저장소의 Discussions와 `Announcements` 카테고리를 사용합니다. 앱 설치 후 글 상세를 새로고침해 로그인 화면을 확인합니다.

- 댓글은 글 주소별로 구분하며, 로컬 상세와 공개 상세가 같은 댓글을 표시합니다. GitHub에서 글로 돌아가는 링크는 공개 사이트 주소를 사용합니다.
- 비공개 글쓰기 미리보기에는 댓글 위젯을 불러오지 않습니다. 읽기 진행률도 댓글을 제외한 본문만 기준으로 계산합니다.
- 공식 `giscus` 웹 컴포넌트 `1.6.0`을 esm.sh에서 불러오고, 댓글 화면은 giscus.app에서 제공합니다. 별도 서버나 API 토큰은 필요하지 않습니다.
- 글을 이동하면 이전 위젯을 제거하고 새 글의 댓글을 연결합니다. 별도 제목과 이동 링크 없이 기본 댓글창만 표시하며, 라이브러리 로딩이 실패하면 새로고침을 안내합니다.
- 저장소와 카테고리의 공개 ID, 언어와 테마는 `app/(routes)/(public)/posts/[slug]/_hooks/useArticleComments.ts`에서 관리합니다.

## 검사

```sh
npm test
npm run build
```

저장과 발행 테스트는 격리된 임시 Git 저장소를 사용하며 실제 게시글을 원격에 발행하지 않습니다.

## 주요 파일

- `app/(routes)/(public)/page.tsx`: 메인 목록 데이터와 검색 메타데이터
- `app/(routes)/(public)/_components/HomePage.tsx`: 카테고리와 글 목록
- `app/(routes)/(public)/_hooks/useHomePosts.ts`: 카테고리 집계, 목록 선택과 페이지 이동
- `app/(routes)/(public)/_components/GitHubOverview.tsx`: 상단 GitHub 프로필과 연간 활동 달력
- `app/(routes)/(public)/_hooks/useGitHubCalendar.ts`: 활동 연도 선택과 주별 달력 배치
- `app/(routes)/(public)/_components/GitHubCalendarTooltip.tsx`: 날짜와 기여 수 말풍선
- `app/(routes)/(public)/_hooks/useGitHubCalendarTooltip.ts`: 잔디 호버, 키보드 탐색과 말풍선 측정
- `app/(routes)/(public)/_lib/github-tooltip.ts`: 화면 경계를 피하는 말풍선 위치 계산
- `app/(routes)/(public)/_components/GitHubYearSelect.tsx`: 연도 선택 버튼과 커스텀 목록
- `app/(routes)/(public)/_hooks/useGitHubYearSelect.ts`: 연도 목록 열림, 키보드 탐색과 외부 클릭 해제
- `app/(routes)/(public)/_hooks/useGitHubOverview.ts`: 공개 정보 자동 조회, 화면 복귀, 캐시와 요청 해제
- `app/(routes)/(public)/_lib/github-live.ts`: 브라우저 공개 응답과 프로필 사진 버전 검증
- `app/(routes)/(public)/_lib/github.server.ts`: 빌드 전용 공개 프로필과 활동 조회
- `app/(routes)/(public)/_lib/github-calendar.ts`: 실제 일별 기여 수 파싱과 보관 데이터 검증
- `app/(routes)/(public)/_data/github-snapshot.json`: 조회 실패에 대비한 공개 데이터
- `app/(routes)/(public)/GitHubOverview.module.css`: 프로필과 활동 달력 전용 스타일
- `app/(routes)/(public)/Home.module.css`: 메인 페이지 전용 스타일
- `app/(routes)/(public)/posts/[slug]/page.tsx`: 글별 정적 페이지와 메타데이터
- `app/(routes)/(public)/posts/[slug]/_components/`: 글 상세 조합, 헤더, 제목 영역과 본문
- `app/(routes)/(public)/posts/[slug]/_hooks/`: 읽기 진행률과 복사 동작
- `app/(routes)/(public)/posts/[slug]/_components/ArticleComments.tsx`: 본문 하단 GitHub 댓글
- `app/(routes)/(public)/posts/[slug]/_hooks/useArticleComments.ts`: 댓글 위젯 연결과 화면 해제
- `app/(routes)/(public)/posts/[slug]/ArticleComments.module.css`: 댓글 영역 전용 스타일
- `app/(routes)/(public)/posts/[slug]/PostDetail.module.css`: 글 상세 전용 스타일
- `app/(routes)/(public)/posts/[slug]/_types/`: 글 상세 컴포넌트의 타입 계약
- `app/shared/data/posts.ts`: 샘플 글 데이터
- `app/shared/data/published-posts.ts`: 직접 발행한 글과 샘플 글 조회
- `app/shared/lib/content.ts`: 글 데이터와 편집기 본문 검증
- `app/(routes)/(public)/write/`: 로컬 글쓰기 화면과 동작
- `app/(routes)/(public)/write/page.dev.tsx`: 개발 서버에서만 등록되는 글쓰기 페이지
- `scripts/editor-server.mjs`: 로컬 임시저장, 이미지 업로드와 발행 API
- `scripts/dev.mjs`: 블로그 개발 서버와 글쓰기 API 실행
- `app/shared/constants/site.ts`: 사이트 이름과 소개
- `app/styles/`: 공통 reset, 레이아웃 토큰과 타이포그래피
- `app/NotFound.module.css`: 404 화면 전용 스타일

한글과 영문 및 숫자는 [Himedia_Community의 적용 방식](https://github.com/dijeungi/Himedia_Community/blob/95fd054624c004ccfb31580cc51269f1dc0499a8/frontend/app/styles/typography.css)과 동일한 Pretendard Variable 1.3.9를 사용합니다. 원본 WOFF2 파일을 `app/shared/fonts/pretendard/Pretendard-Variable.woff2`에 보관하고 `app/styles/typography.css`의 `@font-face`로 불러옵니다. 굵기 범위는 45부터 920, 표시 방식은 `font-display: swap`이며, `html`과 `body`에 적용하고 버튼 및 입력 요소는 `font: inherit`로 상속합니다. 폰트 파일은 변환하지 않았으며 빌드 결과의 로컬 자산으로 제공하므로 Google Fonts 연결은 필요하지 않습니다. 라이선스 원문은 `public/licenses/Pretendard-LICENSE.txt`에 보관합니다.

블로그 이름은 `app/shared/constants/site.ts`에서 관리합니다.

## GitHub Pages

사이트 주소는 [dijeungi.github.io](https://dijeungi.github.io/)입니다.

로컬 블로그 작업은 `dijeungi.github.io/` 폴더에서 진행합니다. `origin`의 가져오기와 푸시 주소는 [블로그 저장소](https://github.com/dijeungi/dijeungi.github.io) 한 곳입니다.

옆의 `dijeungi/` 폴더는 README와 이미지를 관리하는 [프로필 저장소](https://github.com/dijeungi/dijeungi)입니다. 두 폴더는 독립된 Git 저장소이며 각각 자신의 원격에만 푸시합니다.

블로그 코드를 새로 내려받을 때는 다음 명령을 사용합니다.

```sh
git clone https://github.com/dijeungi/dijeungi.github.io.git
cd dijeungi.github.io
npm ci
```

`main`에 푸시하면 [배포 워크플로](.github/workflows/deploy-pages.yml)가 실행됩니다. GitHub Actions 화면에서 수동 실행도 가능합니다.

1. Node.js 24와 루트 `package-lock.json` 기준 npm 캐시를 설정합니다.
2. 루트에서 `npm ci`와 `npm run build`를 실행합니다.
3. 정적 결과물 `out/`을 GitHub Pages에 배포합니다.

Pages 빌드 소스는 GitHub Actions를 사용하고, 사용자 루트 주소에 맞춰 `NEXT_PUBLIC_BASE_PATH`를 빈 값으로 설정합니다.

로컬 정적 빌드도 `dijeungi.github.io/` 폴더에서 실행합니다.

```sh
npm run build
```

`next.config.ts`의 정적 내보내기와 디렉터리형 주소를 사용합니다. `public/.nojekyll`도 결과에 포함됩니다. 운영 환경에서는 `next start` 대신 정적 파일 호스팅을 사용합니다.
