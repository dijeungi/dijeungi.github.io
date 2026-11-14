# JunHo Tech Blog

흰 배경과 넓은 여백, 읽기 좋은 타이포그래피를 중심으로 구성한 기술 블로그입니다.

## 화면

- 기본 주소 `/`에서 발행 글과 예시 글을 한 페이지에 5개씩 표시합니다. 왼쪽 세로 카테고리를 선택하면 해당 글만 볼 수 있고 첫 페이지로 돌아갑니다. 하단에는 최대 5개의 페이지 번호와 이전/다음 버튼을 표시합니다.
- 메인 목록은 왼쪽 가로형 썸네일과 오른쪽 글 정보로 구성합니다. 썸네일과 텍스트 영역의 위아래 높이를 맞추고, 별도 목록 제목과 작성자 배지는 표시하지 않습니다. 대표 이미지가 없는 글에는 카테고리 썸네일을 표시합니다.
- 메인과 상세 헤더는 `app/shared/styles/PageFrame.module.css`의 공통 컨테이너를 사용해 좌우 시작점과 끝점을 맞춥니다. 실제 내용 폭은 최대 1120px이며, 상세 대표 이미지와 바깥 그리드의 최대 1800px과 구분합니다.
- 글 상세에서는 상단 고정 제목, 읽기 진행률, 링크와 코드 복사를 제공합니다.
- 글 상세는 흰 배경에 파란 카테고리 배지와 굵은 제목, 날짜와 읽기 시간을 왼쪽 정렬합니다. 부설명은 표시하지 않습니다.
- 1800px 최대 그리드 안에서 제목 영역은 최대 1120px, 본문은 6열을 사용합니다.
- 헤더는 카테고리와 글 제목 영역의 최대 폭 1120px과 좌우 시작선을 공유합니다. 대표 이미지의 최대 폭은 1800px입니다.
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
- `app/(routes)/(public)/Home.module.css`: 메인 페이지 전용 스타일
- `app/(routes)/(public)/posts/[slug]/page.tsx`: 글별 정적 페이지와 메타데이터
- `app/(routes)/(public)/posts/[slug]/_components/`: 글 상세 조합, 헤더, 제목 영역과 본문
- `app/(routes)/(public)/posts/[slug]/_hooks/`: 읽기 진행률과 복사 동작
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

영문은 [Google Sans Flex](https://github.com/googlefonts/googlesans-flex), 한글은 [Noto Sans KR](https://fonts.google.com/specimen/Noto+Sans+KR)을 사용합니다. `next/font`가 빌드 시 글꼴을 받아 사이트 자산으로 제공하므로 빌드에는 Google Fonts 연결이 필요하고, 방문자는 이 사이트에서 글꼴을 받습니다. 각 글꼴의 라이선스는 `public/licenses/`에 보관합니다.

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
