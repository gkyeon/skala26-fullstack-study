# Full-stack Engineering 학습 저장소

AI캠퍼스 Full-stack 부트캠프(3개월, 4일 단위 모듈 진행) 내용을 정리하는 사이트입니다.
강의별로 내용 요약 · 브라우저 실습 · 퀴즈를 한 페이지에 담고, GitHub Pages로 배포해서 링크만 공유하면 누구나 바로 볼 수 있게 만들었습니다.

🔗 **배포된 사이트**: https://gkyeon.github.io/skala26-fullstack-study/

## 폴더 구조

```
site/
├── index.html                             # 홈 — 강의 목록 카드 + 새 강의 추가 가이드
├── lectures/
│   ├── 01-python-data-analysis/index.html # 강의 1: 데이터 분석을 위한 Python 이해 (완료)
│   └── 02-smart-data/index.html           # 강의 2: 스마트 데이터 이해 및 활용 (완료)
├── template/
│   └── lecture-template.html              # 새 강의 만들 때 복사해서 쓰는 뼈대
└── README.md                              # 이 파일
```

## GitHub Pages로 배포하기 (최초 1회)

1. GitHub에서 새 저장소(repo) 생성 (예: `skala26-fullstack-study`). Public으로 만들면 별도 설정 없이 Pages 사용 가능.
2. 이 `site` 폴더 안의 내용을 저장소 루트에 올리기 (터미널 또는 VS Code에서):
   ```bash
   cd site
   git init
   git add .
   git commit -m "init: 학습 사이트 초기 세팅"
   git branch -M main
   git remote add origin https://github.com/{아이디}/skala26-fullstack-study.git
   git push -u origin main
   ```
3. GitHub 저장소 페이지 → **Settings → Pages** 로 이동
4. **Build and deployment** 에서 Source를 `Deploy from a branch` 로 설정, Branch는 `main` / `/ (root)` 선택 후 저장
5. 1~2분 후 `https://{아이디}.github.io/skala26-fullstack-study/` 로 접속하면 홈페이지가 뜹니다.
6. 조원들에게 이 링크만 공유하면 끝. (Pull 받아서 로컬에서 열어도 바로 동작 — 별도 서버·빌드 과정 없음)

## 새 강의 추가하기 (매 강의마다 반복)

1. `lectures/` 안에 새 폴더 생성 — 예: `lectures/02-backend-basics/`
2. `template/lecture-template.html` 을 복사해 새 폴더의 `index.html` 로 저장
3. 템플릿 안 `<!-- ① ~ ⑥ -->` 주석을 따라 강의 제목 · 섹션 내용 · 실습 예시 · 퀴즈를 채워넣기
   - Claude(또는 Claude Code)에게 강의 PDF나 자료를 주고 "`template/lecture-template.html` 형식에 맞춰 이 내용으로 강의 페이지 만들어줘"라고 요청하면 빠르게 채울 수 있습니다.
   - SQL 실습 콘솔처럼 브라우저에서 직접 코드를 돌려보는 기능이 필요하면 `lectures/01-smart-data/index.html` 맨 아래 `#pgToggle`/`#pgDrawer`/`sql.js` 스크립트 블록을 참고해서 복사 후 데이터·연습문제만 교체하세요.
4. 루트 `index.html` 의 강의 목록(`<div class="grid">`) 안에 새 카드 추가, "준비 중" 카드는 지우거나 다음 자리로 옮기기
5. 커밋 & 푸시:
   ```bash
   git add .
   git commit -m "add: 02 강의 추가"
   git push
   ```
6. GitHub Pages가 자동으로 다시 배포됨 (보통 1분 이내 반영, 강제 새로고침 `Cmd+Shift+R` 필요할 수 있음)

## 로컬에서 미리보기

배포 전에 확인하고 싶으면 `site` 폴더에서 그냥 `index.html` 을 브라우저로 더블클릭해서 열면 됩니다. 별도 서버·빌드 불필요 (전부 순수 HTML/CSS/JS, 외부 라이브러리는 CDN에서 로드).

## 자주 겪는 문제

- **카드 클릭했는데 안 열려요** → `lectures/xx/index.html` 파일명이 정확한지, `index.html` 의 `href` 경로가 맞는지 확인
- **강의 페이지에서 "🏠 Full-stack 학습 홈" 링크가 깨져요** → 폴더 깊이가 `lectures/폴더명/index.html` 2단계인지 확인 (다르면 `../../index.html` 경로 조정 필요)
- **SQL 연습장이 안 떠요** → 인터넷 연결 필요 (sql.js를 CDN에서 불러옴), 오프라인에서는 동작 안 함
