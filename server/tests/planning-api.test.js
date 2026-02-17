import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const testDbFilename = `planning.test.${Date.now()}.db`;
const testDbPath = path.join(serverRoot, testDbFilename);

const removeTestDb = () => {
  if (fs.existsSync(testDbPath)) {
    try {
      fs.rmSync(testDbPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
};

describe('planning API', () => {
  let app;
  let createApp;

  const createProject = async (payload) => request(app).post('/api/projects').send(payload);

  const createActivity = async (projectId, payload) =>
    request(app).post(`/api/projects/${projectId}/activities`).send(payload);

  const createSubProject = async (projectId, payload) =>
    request(app).post(`/api/projects/${projectId}/subprojects`).send(payload);

  const createInstance = async (projectId, activityId, payload) =>
    request(app)
      .post(`/api/projects/${projectId}/activities/${activityId}/instances`)
      .send(payload);

  beforeAll(async () => {
    process.env.DB_PATH = testDbPath;
    removeTestDb();
    ({ createApp } = await import('../src/planning-app.js'));
    const created = await createApp({ dbPath: testDbPath });
    app = created.app;
  });

  beforeEach(async () => {
    removeTestDb();
    const created = await createApp({ dbPath: testDbPath });
    app = created.app;
  });

  afterAll(() => {
    removeTestDb();
  });

  it('creates project and default Main sub-project', async () => {
    const project = await createProject({
      name: 'Alpha',
      startDate: '2026-02-10',
      endDate: '2026-02-12'
    });

    expect(project.status).toBe(201);

    const subprojects = await request(app).get(`/api/projects/${project.body.id}/subprojects`);
    expect(subprojects.status).toBe(200);
    expect(subprojects.body).toHaveLength(1);
    expect(subprojects.body[0].name).toBe('Main');
  });

  it('supports sub-project CRUD/reorder and blocks deleting last sub-project', async () => {
    const project = await createProject({
      name: 'Subproject CRUD',
      startDate: '2026-03-01',
      endDate: '2026-03-03'
    });

    const created = await createSubProject(project.body.id, { name: 'Phase 2' });
    expect(created.status).toBe(201);

    const renamed = await request(app)
      .put(`/api/projects/${project.body.id}/subprojects/${created.body.id}`)
      .send({ name: 'Execution' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Execution');

    const mainId = (await request(app).get(`/api/projects/${project.body.id}/subprojects`)).body.find(
      (entry) => entry.name === 'Main'
    ).id;

    const moved = await request(app)
      .post(`/api/projects/${project.body.id}/subprojects/${created.body.id}/reorder`)
      .send({ direction: 'up' });
    expect(moved.status).toBe(200);
    expect(moved.body.moved).toBe(true);

    const deleteCreated = await request(app).delete(
      `/api/projects/${project.body.id}/subprojects/${created.body.id}`
    );
    expect(deleteCreated.status).toBe(200);

    const deleteLast = await request(app).delete(`/api/projects/${project.body.id}/subprojects/${mainId}`);
    expect(deleteLast.status).toBe(409);
    expect(deleteLast.body.code).toBe('SUBPROJECT_MINIMUM_REQUIRED');
  });

  it('requires subProjectId for instances and enforces duplicate scope by sub-project', async () => {
    const project = await createProject({
      name: 'Instances',
      startDate: '2026-04-01',
      endDate: '2026-04-03'
    });

    const activity = await createActivity(project.body.id, {
      name: 'Build',
      color: '#1b5c4f'
    });

    const subprojects = await request(app).get(`/api/projects/${project.body.id}/subprojects`);
    const main = subprojects.body[0];

    const missingSubProject = await createInstance(project.body.id, activity.body.id, {
      date: '2026-04-01'
    });
    expect(missingSubProject.status).toBe(400);

    const created = await createInstance(project.body.id, activity.body.id, {
      date: '2026-04-01',
      subProjectId: main.id
    });
    expect(created.status).toBe(201);

    const duplicate = await createInstance(project.body.id, activity.body.id, {
      date: '2026-04-01',
      subProjectId: main.id
    });
    expect(duplicate.status).toBe(409);
  });

  it('allows same activity/day across different sub-projects', async () => {
    const project = await createProject({
      name: 'Cross subprojects',
      startDate: '2026-05-01',
      endDate: '2026-05-02'
    });

    const activity = await createActivity(project.body.id, {
      name: 'Review',
      color: '#c05621'
    });

    const extra = await createSubProject(project.body.id, { name: 'Phase 2' });
    expect(extra.status).toBe(201);

    const subprojects = await request(app).get(`/api/projects/${project.body.id}/subprojects`);
    const main = subprojects.body.find((entry) => entry.name === 'Main');

    const first = await createInstance(project.body.id, activity.body.id, {
      date: '2026-05-01',
      subProjectId: main.id
    });
    const second = await createInstance(project.body.id, activity.body.id, {
      date: '2026-05-01',
      subProjectId: extra.body.id
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it('returns extended board payload with scoped instanceMap and subProjectDayMap', async () => {
    const project = await createProject({
      name: 'Board',
      startDate: '2026-06-10',
      endDate: '2026-06-11'
    });

    const activityA = await createActivity(project.body.id, {
      name: 'Design',
      color: '#1b5c4f'
    });
    const activityB = await createActivity(project.body.id, {
      name: 'QA',
      color: '#c05621'
    });

    const subproject = await createSubProject(project.body.id, { name: 'Phase 2' });
    const subprojects = await request(app).get(`/api/projects/${project.body.id}/subprojects`);
    const main = subprojects.body.find((entry) => entry.name === 'Main');

    await createInstance(project.body.id, activityA.body.id, {
      date: '2026-06-10',
      subProjectId: main.id
    });
    await createInstance(project.body.id, activityB.body.id, {
      date: '2026-06-10',
      subProjectId: subproject.body.id
    });

    const boardMain = await request(app).get(
      `/api/projects/${project.body.id}/board?subProjectId=${main.id}`
    );
    expect(boardMain.status).toBe(200);
    expect(boardMain.body.subprojects.length).toBe(2);
    expect(boardMain.body.activeSubProjectId).toBe(main.id);
    expect(boardMain.body.instanceMap[String(activityA.body.id)]['2026-06-10']).toBeTruthy();
    expect(boardMain.body.instanceMap[String(activityB.body.id)]?.['2026-06-10']).toBeFalsy();
    expect(boardMain.body.subProjectDayMap[String(subproject.body.id)]['2026-06-10']).toHaveLength(1);
  });

  it('requires confirmation before pruning out-of-range instances across sub-projects', async () => {
    const project = await createProject({
      name: 'Trim',
      startDate: '2026-07-01',
      endDate: '2026-07-05'
    });

    const activity = await createActivity(project.body.id, {
      name: 'Implementation',
      color: '#1b5c4f'
    });
    const subproject = await createSubProject(project.body.id, { name: 'Phase 2' });

    await createInstance(project.body.id, activity.body.id, {
      date: '2026-07-05',
      subProjectId: subproject.body.id
    });

    const blocked = await request(app)
      .put(`/api/projects/${project.body.id}`)
      .send({
        name: 'Trim',
        startDate: '2026-07-01',
        endDate: '2026-07-03'
      });

    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('PROJECT_RANGE_PRUNE_REQUIRED');
    expect(blocked.body.outOfRangeInstances).toBe(1);

    const confirmed = await request(app)
      .put(`/api/projects/${project.body.id}`)
      .send({
        name: 'Trim',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
        confirmTrimOutOfRangeInstances: true
      });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.prunedInstances).toBe(1);
  });

  it('duplicates sub-projects with copied instances and resolves duplicate naming', async () => {
    const project = await createProject({
      name: 'Duplicate',
      startDate: '2026-08-01',
      endDate: '2026-08-05'
    });
    const subprojectsBefore = await request(app).get(`/api/projects/${project.body.id}/subprojects`);
    const main = subprojectsBefore.body.find((entry) => entry.name === 'Main');
    const activity = await createActivity(project.body.id, {
      name: 'Task',
      color: '#1b5c4f'
    });
    const activityTwo = await createActivity(project.body.id, {
      name: 'Review',
      color: '#c05621'
    });
    await createInstance(project.body.id, activity.body.id, {
      date: '2026-08-02',
      subProjectId: main.id
    });
    await createInstance(project.body.id, activityTwo.body.id, {
      date: '2026-08-03',
      subProjectId: main.id
    });

    const duplicatedA = await request(app).post(
      `/api/projects/${project.body.id}/subprojects/${main.id}/duplicate`
    );
    expect(duplicatedA.status).toBe(201);
    expect(duplicatedA.body.subproject.name).toBe('Main (copy)');
    expect(duplicatedA.body.copiedInstances).toBe(2);

    const duplicatedB = await request(app).post(
      `/api/projects/${project.body.id}/subprojects/${main.id}/duplicate`
    );
    expect(duplicatedB.status).toBe(201);
    expect(duplicatedB.body.subproject.name).toBe('Main (copy 2)');
    expect(duplicatedB.body.copiedInstances).toBe(2);

    const duplicatedFiltered = await request(app)
      .post(`/api/projects/${project.body.id}/subprojects/${main.id}/duplicate`)
      .send({ name: 'Main filtered', activityIds: [activityTwo.body.id] });
    expect(duplicatedFiltered.status).toBe(201);
    expect(duplicatedFiltered.body.copiedInstances).toBe(1);

    const filteredBoard = await request(app).get(
      `/api/projects/${project.body.id}/board?subProjectId=${duplicatedFiltered.body.subproject.id}`
    );
    expect(filteredBoard.status).toBe(200);
    expect(filteredBoard.body.instanceMap[String(activity.body.id)]?.['2026-08-02']).toBeFalsy();
    expect(filteredBoard.body.instanceMap[String(activityTwo.body.id)]?.['2026-08-03']).toBeTruthy();

    const duplicateCustomNameConflict = await request(app)
      .post(`/api/projects/${project.body.id}/subprojects/${main.id}/duplicate`)
      .send({ name: 'Main (copy)' });
    expect(duplicateCustomNameConflict.status).toBe(409);

    const duplicateInvalidActivity = await request(app)
      .post(`/api/projects/${project.body.id}/subprojects/${main.id}/duplicate`)
      .send({ name: 'Main invalid', activityIds: [99999] });
    expect(duplicateInvalidActivity.status).toBe(400);
  });

  it('shifts sub-project instances with partial apply and summary counts', async () => {
    const project = await createProject({
      name: 'Shift',
      startDate: '2026-09-01',
      endDate: '2026-09-04'
    });
    const subprojects = await request(app).get(`/api/projects/${project.body.id}/subprojects`);
    const main = subprojects.body.find((entry) => entry.name === 'Main');
    const activity = await createActivity(project.body.id, {
      name: 'Task',
      color: '#1b5c4f'
    });

    await createInstance(project.body.id, activity.body.id, {
      date: '2026-09-01',
      subProjectId: main.id
    });
    await createInstance(project.body.id, activity.body.id, {
      date: '2026-09-03',
      subProjectId: main.id
    });
    await createInstance(project.body.id, activity.body.id, {
      date: '2026-09-04',
      subProjectId: main.id
    });

    const shiftForwardBlocked = await request(app)
      .post(`/api/projects/${project.body.id}/subprojects/${main.id}/shift`)
      .send({ days: 1 });
    expect(shiftForwardBlocked.status).toBe(409);
    expect(shiftForwardBlocked.body.code).toBe('SUBPROJECT_SHIFT_OUT_OF_RANGE_DELETE_REQUIRED');
    expect(shiftForwardBlocked.body.outOfRangeInstances).toBe(1);

    const shiftForward = await request(app)
      .post(`/api/projects/${project.body.id}/subprojects/${main.id}/shift`)
      .send({ days: 1, confirmDeleteOutOfRangeInstances: true });
    expect(shiftForward.status).toBe(200);
    expect(shiftForward.body.movedCount).toBe(1);
    expect(shiftForward.body.skippedOutOfRangeCount).toBe(1);
    expect(shiftForward.body.deletedOutOfRangeCount).toBe(1);
    expect(shiftForward.body.skippedDuplicateCount).toBe(0);

    const boardAfter = await request(app).get(
      `/api/projects/${project.body.id}/board?subProjectId=${main.id}`
    );
    expect(boardAfter.status).toBe(200);
    expect(boardAfter.body.instanceMap[String(activity.body.id)]['2026-09-02']).toBeTruthy();
    expect(boardAfter.body.instanceMap[String(activity.body.id)]['2026-09-04']).toBeTruthy();

    const shiftBackward = await request(app)
      .post(`/api/projects/${project.body.id}/subprojects/${main.id}/shift`)
      .send({ days: -1 });
    expect(shiftBackward.status).toBe(200);
    expect(shiftBackward.body.requestedShiftDays).toBe(-1);
  });

  it('validates shift and duplicate route linkage', async () => {
    const project = await createProject({
      name: 'Validation',
      startDate: '2026-10-01',
      endDate: '2026-10-03'
    });
    const otherProject = await createProject({
      name: 'Other',
      startDate: '2026-10-01',
      endDate: '2026-10-03'
    });

    const subprojects = await request(app).get(`/api/projects/${project.body.id}/subprojects`);
    const main = subprojects.body.find((entry) => entry.name === 'Main');

    const badShiftDays = await request(app)
      .post(`/api/projects/${project.body.id}/subprojects/${main.id}/shift`)
      .send({ days: 0 });
    expect(badShiftDays.status).toBe(400);

    const wrongProjectDuplicate = await request(app).post(
      `/api/projects/${otherProject.body.id}/subprojects/${main.id}/duplicate`
    );
    expect(wrongProjectDuplicate.status).toBe(404);

    const wrongProjectShift = await request(app)
      .post(`/api/projects/${otherProject.body.id}/subprojects/${main.id}/shift`)
      .send({ days: 1 });
    expect(wrongProjectShift.status).toBe(404);
  });
});
