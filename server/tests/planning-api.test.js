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

  const createInstance = async (projectId, activityId, date) =>
    request(app)
      .post(`/api/projects/${projectId}/activities/${activityId}/instances`)
      .send({ date });

  const reorderActivity = async (projectId, activityId, direction) =>
    request(app)
      .post(`/api/projects/${projectId}/activities/${activityId}/reorder`)
      .send({ direction });

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

  it('creates project from startDate and endDate', async () => {
    const response = await createProject({
      name: 'Alpha',
      startDate: '2026-02-10',
      endDate: '2026-02-14'
    });

    expect(response.status).toBe(201);
    expect(response.body.startDate).toBe('2026-02-10');
    expect(response.body.endDate).toBe('2026-02-14');
    expect(response.body.lengthDays).toBe(5);
  });

  it('creates project from startDate and lengthDays', async () => {
    const response = await createProject({
      name: 'Beta',
      startDate: '2026-03-01',
      lengthDays: 10
    });

    expect(response.status).toBe(201);
    expect(response.body.endDate).toBe('2026-03-10');
    expect(response.body.lengthDays).toBe(10);
  });

  it('updates project and preserves normalized date range', async () => {
    const created = await createProject({
      name: 'Gamma',
      startDate: '2026-04-01',
      endDate: '2026-04-03'
    });

    const updated = await request(app)
      .put(`/api/projects/${created.body.id}`)
      .send({
        name: 'Gamma Updated',
        startDate: '2026-04-01',
        lengthDays: 5
      });

    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Gamma Updated');
    expect(updated.body.endDate).toBe('2026-04-05');
    expect(updated.body.lengthDays).toBe(5);
  });

  it('deletes a project with cascade counts', async () => {
    const project = await createProject({
      name: 'Cascade',
      startDate: '2026-02-10',
      endDate: '2026-02-12'
    });
    const activity = await createActivity(project.body.id, {
      name: 'Design',
      color: '#1b5c4f'
    });
    await createInstance(project.body.id, activity.body.id, '2026-02-10');

    const deleted = await request(app).delete(`/api/projects/${project.body.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deletedActivities).toBe(1);
    expect(deleted.body.deletedInstances).toBe(1);

    const projects = await request(app).get('/api/projects');
    expect(projects.body).toHaveLength(0);
  });

  it('enforces unique activity names per project case-insensitively', async () => {
    const project = await createProject({
      name: 'Unique',
      startDate: '2026-02-01',
      endDate: '2026-02-02'
    });

    const created = await createActivity(project.body.id, {
      name: 'Design',
      color: '#1b5c4f'
    });
    expect(created.status).toBe(201);

    const duplicate = await createActivity(project.body.id, {
      name: 'design',
      color: '#ff0000'
    });
    expect(duplicate.status).toBe(409);
  });

  it('updates an activity name and color', async () => {
    const project = await createProject({
      name: 'Activity update',
      startDate: '2026-04-01',
      endDate: '2026-04-02'
    });

    const created = await createActivity(project.body.id, {
      name: 'Draft',
      color: '#1b5c4f'
    });

    const updated = await request(app)
      .put(`/api/projects/${project.body.id}/activities/${created.body.id}`)
      .send({
        name: 'Final draft',
        color: '#cc5500'
      });

    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Final draft');
    expect(updated.body.color).toBe('#cc5500');
  });

  it('validates assignment range and duplicate activity-day assignments', async () => {
    const project = await createProject({
      name: 'Range',
      startDate: '2026-05-10',
      endDate: '2026-05-12'
    });
    const activity = await createActivity(project.body.id, {
      name: 'Build',
      color: '#1b5c4f'
    });

    const outside = await createInstance(project.body.id, activity.body.id, '2026-05-13');
    expect(outside.status).toBe(400);

    const first = await createInstance(project.body.id, activity.body.id, '2026-05-11');
    expect(first.status).toBe(201);

    const duplicate = await createInstance(project.body.id, activity.body.id, '2026-05-11');
    expect(duplicate.status).toBe(409);
  });

  it('allows multiple activities on the same day and returns board map', async () => {
    const project = await createProject({
      name: 'Board',
      startDate: '2026-06-05',
      endDate: '2026-06-08'
    });
    const design = await createActivity(project.body.id, {
      name: 'Design',
      color: '#1b5c4f'
    });
    const review = await createActivity(project.body.id, {
      name: 'Review',
      color: '#c05621'
    });

    await createInstance(project.body.id, design.body.id, '2026-06-06');
    await createInstance(project.body.id, review.body.id, '2026-06-06');

    const board = await request(app).get(`/api/projects/${project.body.id}/board`);
    expect(board.status).toBe(200);
    expect(board.body.days).toHaveLength(4);
    expect(board.body.days.some((day) => day.date === '2026-06-06' && day.isWeekend)).toBe(true);
    expect(board.body.instanceMap[String(design.body.id)]['2026-06-06']).toBeTruthy();
    expect(board.body.instanceMap[String(review.body.id)]['2026-06-06']).toBeTruthy();
  });

  it('deletes activity with instance count', async () => {
    const project = await createProject({
      name: 'Activity delete',
      startDate: '2026-07-01',
      endDate: '2026-07-03'
    });
    const activity = await createActivity(project.body.id, {
      name: 'Test',
      color: '#1b5c4f'
    });
    await createInstance(project.body.id, activity.body.id, '2026-07-01');
    await createInstance(project.body.id, activity.body.id, '2026-07-02');

    const deleted = await request(app).delete(
      `/api/projects/${project.body.id}/activities/${activity.body.id}`
    );

    expect(deleted.status).toBe(200);
    expect(deleted.body.deletedInstances).toBe(2);
  });

  it('reorders activities within a project', async () => {
    const project = await createProject({
      name: 'Activity order',
      startDate: '2026-08-01',
      endDate: '2026-08-02'
    });
    const first = await createActivity(project.body.id, {
      name: 'First',
      color: '#1b5c4f'
    });
    const second = await createActivity(project.body.id, {
      name: 'Second',
      color: '#c05621'
    });

    const moved = await reorderActivity(project.body.id, second.body.id, 'up');
    expect(moved.status).toBe(200);
    expect(moved.body.moved).toBe(true);

    const board = await request(app).get(`/api/projects/${project.body.id}/board`);
    expect(board.status).toBe(200);
    expect(board.body.activities[0].id).toBe(second.body.id);
    expect(board.body.activities[1].id).toBe(first.body.id);
  });
});
