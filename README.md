# Matthiance Planning Application

Local-first multi-project planning with a daily schedule grid.

Tech stack:
- Frontend: React + Vite
- Backend: Express + SQLite (`sql.js`, file-backed)
- Desktop: Electron + electron-builder

## Prerequisites

- Node.js 18+

## Development

1. Install dependencies:

```bash
npm install
```

2. Run web app (client + server):

```bash
npm run dev
```

- Client: `http://localhost:5173`
- API: `http://127.0.0.1:3001`

## Desktop

Run Electron in development:

```bash
npm run desktop:dev
```

Build Windows installer:

```bash
npm run electron:build
```

Build output is written to `dist-electron/` as `Matthiance-Setup-<version>.exe`.

Packaged desktop data:
- DB file: `matthiance.db`
- Tools: `Open data folder`, `Export backup`

## Scripts

From repo root:
- `npm run dev`
- `npm run desktop:dev`
- `npm run build`
- `npm run build:electron-client`
- `npm run build:server-deps`
- `npm run electron:build`
- `npm run lint`
- `npm run format`

Tests:
- `npm run test --workspace client -- --run`
- `npm run test --workspace server -- --run`

## API

### Health
- `GET /api/health` -> `{ ok: true }`

### Projects
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PUT /api/projects/:projectId`
- `DELETE /api/projects/:projectId`

Project payload (`startDate` + (`endDate` or `lengthDays`)):

```json
{
  "name": "Project Alpha",
  "startDate": "2026-03-01",
  "endDate": "2026-03-10",
  "lengthDays": 10
}
```

Rules:
- Dates are stored as `YYYY-MM-DD` (inclusive day length).
- `endDate` cannot be before `startDate`.
- On project update, if the new date range would drop existing instances, the API returns:
  - `409`
  - `code: "PROJECT_RANGE_PRUNE_REQUIRED"`
  - `outOfRangeInstances`
- Retry the same update with `confirmTrimOutOfRangeInstances: true` to confirm pruning.

### Activities
- `GET /api/projects/:projectId/activities`
- `POST /api/projects/:projectId/activities`
- `PUT /api/projects/:projectId/activities/:activityId`
- `POST /api/projects/:projectId/activities/:activityId/reorder`
- `DELETE /api/projects/:projectId/activities/:activityId`

Activity payload:

```json
{
  "name": "Design",
  "color": "#1b5c4f"
}
```

Reorder payload:

```json
{
  "direction": "up"
}
```

### Activity Instances and Board
- `GET /api/projects/:projectId/board`
- `POST /api/projects/:projectId/activities/:activityId/instances`
- `DELETE /api/projects/:projectId/activities/:activityId/instances/:date`

Create instance payload:

```json
{
  "date": "2026-03-05"
}
```

Rules:
- Instance date must be within project range.
- One instance per activity/day.
- Different activities can share a day.

## Notes

- Schedule export creates an `.xlsx` file with:
  - `Project Info` sheet
  - `Schedule` sheet
- Export selection per project is persisted in local storage.
