# FUARA - AI 연동 데스크탑 할일 앱

바탕화면에 떠있는 스티커 메모 + Cursor/IDE에서 바로 작업을 등록할 수 있는 할일 앱.

AI 에이전트 연동 지침은 `AGENTS.md`를 우선 참고하세요.

## 실행

```bash
npm start
```

## Cursor에서 작업 등록하기

FUARA가 실행 중이면 Cursor에서 이렇게 말하세요:

> "이 기능 FUARA에 등록해줘"

그러면 AI가 아래와 같은 명령을 실행해서 FUARA에 작업을 추가합니다:

```powershell
$body = [System.Text.Encoding]::UTF8.GetBytes('{"project":"프로젝트명","title":"작업 제목","estimate_minutes":120,"priority":"must","target_date":"2026-02-27"}')
Invoke-WebRequest -Uri "http://127.0.0.1:7777/tasks" -Method POST -ContentType "application/json; charset=utf-8" -Body $body -UseBasicParsing
```

## API 엔드포인트 (localhost:7777)

| Method | Path | 설명 |
|--------|------|------|
| GET | /ping | 서버 상태 확인 |
| GET | /projects | 프로젝트 목록 |
| POST | /projects | 프로젝트 등록 |
| DELETE | /projects/:id | 프로젝트 삭제 |
| GET | /tasks/today | 오늘 할일 |
| GET | /tasks?date=YYYY-MM-DD | 특정 날짜 할일 |
| POST | /tasks | 작업 추가 |
| PATCH | /tasks/:id | 작업 수정 |
| DELETE | /tasks/:id | 작업 삭제 |

### POST /tasks 필드

```json
{
  "title": "작업 제목 (필수)",
  "project": "프로젝트 이름 (없으면 자동 생성)",
  "project_id": 1,
  "description": "설명",
  "estimate_minutes": 120,
  "priority": "must | normal | low",
  "target_date": "2026-02-27"
}
```

### PATCH /tasks/:id 필드

```json
{
  "status": "done | pending | cancelled",
  "title": "수정된 제목",
  "estimate_minutes": 90,
  "actual_minutes": 100
}
```
