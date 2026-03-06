# FUARA

**AI 에이전트와 함께 쓰는 데스크탑 생산성 앱**

FUARA는 바탕화면 스티커 메모 + 할일 관리 + 캘린더를 하나로 합친 Electron 데스크탑 앱입니다.
Cursor 같은 AI 코딩 에이전트에서 자연어로 작업을 등록하고, 스티커 메모로 오늘 할 일을 항상 눈앞에 띄워둘 수 있습니다.

## 주요 기능

| 기능 | 설명 |
|------|------|
| **할일 관리** | 프로젝트별 메인/서브 태스크, 우선순위, 예상 시간, 스톱워치 |
| **스케줄** | 날짜별 시간대 스케줄 등록, 총 할당 시간 자동 계산 |
| **캘린더** | 월간 완료 이력 + 예정 작업 + 스케줄 + 실제 작업 시간 통합 뷰 |
| **스티커 메모** | 항상 위에 떠있는 오늘 할일 요약, 접기/펼치기, 위치 기억 |
| **활동 타이머** | 스티커에서 원클릭 작업 시작/정지, 누적 시간 캘린더에 표시 |
| **노트** | 리치 텍스트 메모, 프로젝트별 분류, 카테고리 관리 |
| **커스텀 섹션** | 프로젝트별 사용자 정의 콘텐츠 (대사 라이브러리, 참고 문서 등) |
| **동기부여 트래커** | 일/주간 생산성 비교, 캘린더에 🔥 표시 |
| **AI 에이전트 연동** | REST API + AGENTS.md 기반 자연어 작업 등록 |

## 시작하기

```bash
# 의존성 설치
npm install

# 네이티브 모듈 리빌드 (better-sqlite3)
npx @electron/rebuild

# 실행
npm start
```

## AI 에이전트 연동

FUARA가 실행 중이면 Cursor 같은 AI IDE에서 자연어로 바로 작업을 관리할 수 있습니다.

```
"FUARA에 내일 할 일 추가해줘 - UI 리팩토링"
"오늘 할 일 보여줘"
"완료 처리해줘"
```

에이전트는 로컬 REST API(`http://127.0.0.1:7777`)를 통해 FUARA와 소통합니다.
상세 연동 지침은 [`AGENTS.md`](./AGENTS.md)를 참고하세요.

## 기술 스택

- **Electron** — 데스크탑 앱 프레임워크
- **Express** — 로컬 REST API 서버 (포트 7777)
- **better-sqlite3** — 로컬 SQLite 데이터베이스
- **TipTap** — 리치 텍스트 에디터 (노트)
- **esbuild** — 프론트엔드 번들러

## 프로젝트 구조

```
├── main.js              # Electron 메인 프로세스 (윈도우 관리, IPC)
├── server.js            # Express REST API 서버
├── db.js                # SQLite 데이터베이스 스키마 + CRUD
├── preload.js           # Electron IPC 브릿지
├── build-renderer.js    # esbuild 번들 스크립트
├── AGENTS.md            # AI 에이전트 연동 가이드
├── windows/
│   ├── main/            # 메인 앱 윈도우 (할일/스케줄/캘린더/노트)
│   │   ├── index.html
│   │   ├── renderer.js
│   │   └── style.css
│   └── sticker/         # 스티커 메모 윈도우
│       ├── index.html
│       ├── renderer.js
│       └── style.css
```

## API 개요

| Method | Path | 설명 |
|--------|------|------|
| GET | `/ping` | 서버 상태 확인 |
| GET | `/projects` | 프로젝트 목록 |
| POST | `/projects` | 프로젝트 등록 |
| GET | `/tasks/today` | 오늘 할일 |
| GET | `/tasks?date=YYYY-MM-DD` | 날짜별 할일 |
| POST | `/tasks` | 작업 추가 (서브태스크 포함) |
| PATCH | `/tasks/:id` | 작업 수정 |
| DELETE | `/tasks/:id` | 작업 삭제 |
| GET | `/schedules?date=YYYY-MM-DD` | 스케줄 조회 |
| POST | `/schedules` | 스케줄 등록 |
| GET | `/notes` | 노트 목록 |
| POST | `/notes` | 노트 추가 |
| GET | `/projects/:id/sections` | 커스텀 섹션 |
| GET | `/projects/:id/items/export` | 섹션 데이터 내보내기 |
| GET | `/work/today` | 오늘 작업 시간 |
| GET | `/effort/today` | 오늘 생산성 점수 |

전체 API 필드 및 페이로드는 [`AGENTS.md`](./AGENTS.md)를 참고하세요.

## 라이선스

MIT
