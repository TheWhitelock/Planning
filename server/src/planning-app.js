import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { createDatabase } from './db.js';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_SUBPROJECT_NAME = 'Main';

const resolveDbPath = (dbPath = process.env.DB_PATH || './dev.db') =>
  dbPath && path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);

const parseIntegerId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseDateKey = (value) => {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) {
    return null;
  }

  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
};

const toDateKey = (date) => {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date, amount) => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
};

const parseLengthDays = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
};

const diffDaysInclusive = (start, end) => {
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000);
  return days + 1;
};

const normalizeProjectPayload = (payload = {}) => {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const startDateRaw = payload.startDate;
  const endDateRaw = payload.endDate;
  const lengthDaysRaw = payload.lengthDays;

  if (!name) {
    return { error: 'Project name is required.' };
  }

  const startDate = parseDateKey(startDateRaw);
  if (!startDate) {
    return { error: 'A valid startDate (YYYY-MM-DD) is required.' };
  }

  const hasEndDate = typeof endDateRaw === 'string' && endDateRaw.trim().length > 0;
  const hasLengthDays = !(
    lengthDaysRaw === null ||
    lengthDaysRaw === undefined ||
    lengthDaysRaw === ''
  );

  if (!hasEndDate && !hasLengthDays) {
    return { error: 'Provide either endDate or lengthDays.' };
  }

  const parsedLengthDays = hasLengthDays ? parseLengthDays(lengthDaysRaw) : null;
  if (hasLengthDays && !parsedLengthDays) {
    return { error: 'lengthDays must be an integer greater than 0.' };
  }

  const parsedEndDate = hasEndDate ? parseDateKey(endDateRaw) : null;
  if (hasEndDate && !parsedEndDate) {
    return { error: 'endDate must be a valid date key (YYYY-MM-DD).' };
  }

  let normalizedEndDate = parsedEndDate;
  let normalizedLengthDays = parsedLengthDays;

  if (parsedEndDate && parsedLengthDays) {
    const derivedLength = diffDaysInclusive(startDate, parsedEndDate);
    if (derivedLength < 1) {
      return { error: 'endDate cannot be before startDate.' };
    }
    if (derivedLength !== parsedLengthDays) {
      return { error: 'endDate and lengthDays are inconsistent.' };
    }
    normalizedLengthDays = derivedLength;
  } else if (parsedEndDate) {
    const derivedLength = diffDaysInclusive(startDate, parsedEndDate);
    if (derivedLength < 1) {
      return { error: 'endDate cannot be before startDate.' };
    }
    normalizedLengthDays = derivedLength;
  } else {
    normalizedEndDate = addDays(startDate, parsedLengthDays - 1);
    normalizedLengthDays = parsedLengthDays;
  }

  return {
    value: {
      name,
      startDate: toDateKey(startDate),
      endDate: toDateKey(normalizedEndDate),
      lengthDays: normalizedLengthDays
    }
  };
};

const normalizeActivityPayload = (payload = {}) => {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const color = typeof payload.color === 'string' ? payload.color.trim() : '';

  if (!name) {
    return { error: 'Activity name is required.' };
  }

  if (!HEX_COLOR_PATTERN.test(color)) {
    return { error: 'Activity color must be a hex value like #1A2B3C.' };
  }

  return {
    value: {
      name,
      color
    }
  };
};

const normalizeSubprojectPayload = (payload = {}) => {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';

  if (!name) {
    return { error: 'Sub-project name is required.' };
  }

  return {
    value: {
      name
    }
  };
};

const mapProject = (row) =>
  row
    ? {
        id: row.id,
        name: row.name,
        startDate: row.startDate,
        endDate: row.endDate,
        lengthDays: row.lengthDays,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }
    : null;

const mapActivity = (row) =>
  row
    ? {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        color: row.color,
        createdAt: row.createdAt,
        sortOrder: row.sortOrder
      }
    : null;

const mapSubproject = (row) =>
  row
    ? {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt
      }
    : null;

const mapInstance = (row) =>
  row
    ? {
        id: row.id,
        subProjectId: row.subProjectId,
        activityId: row.activityId,
        day: row.day,
        createdAt: row.createdAt
      }
    : null;

const isConstraintError = (error) =>
  typeof error?.message === 'string' &&
  (error.message.includes('UNIQUE constraint failed') ||
    error.message.includes('CHECK constraint failed') ||
    error.message.includes('FOREIGN KEY constraint failed'));

const buildDayRange = (startDateKey, endDateKey) => {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  if (!start || !end) {
    return [];
  }

  const days = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    const weekday = cursor.getUTCDay();
    days.push({
      date: toDateKey(cursor),
      isWeekend: weekday === 0 || weekday === 6
    });
    cursor = addDays(cursor, 1);
  }

  return days;
};

export const createApp = async ({ dbPath } = {}) => {
  const app = express();
  const db = await createDatabase(resolveDbPath(dbPath));

  app.use(cors());
  app.use(express.json());

  const getProjectById = (projectId) => {
    const rows = db.all(
      `SELECT id, name, startDate, endDate, lengthDays, createdAt, updatedAt
       FROM projects
       WHERE id = ?`,
      [projectId]
    );
    return mapProject(rows[0]);
  };

  const getLatestProject = () => {
    const rows = db.all(
      `SELECT id, name, startDate, endDate, lengthDays, createdAt, updatedAt
       FROM projects
       ORDER BY id DESC
       LIMIT 1`
    );
    return mapProject(rows[0]);
  };

  const getActivityById = (activityId) => {
    const rows = db.all(
      `SELECT id, projectId, name, color, createdAt, sortOrder
       FROM activities
       WHERE id = ?`,
      [activityId]
    );
    return mapActivity(rows[0]);
  };

  const getLatestActivityForProject = (projectId) => {
    const rows = db.all(
      `SELECT id, projectId, name, color, createdAt, sortOrder
       FROM activities
       WHERE projectId = ?
       ORDER BY sortOrder DESC, id DESC
       LIMIT 1`,
      [projectId]
    );
    return mapActivity(rows[0]);
  };

  const getActivityByProjectAndId = (projectId, activityId) => {
    const rows = db.all(
      `SELECT id, projectId, name, color, createdAt, sortOrder
       FROM activities
       WHERE projectId = ? AND id = ?`,
      [projectId, activityId]
    );
    return mapActivity(rows[0]);
  };

  const getSubprojectById = (subProjectId) => {
    const rows = db.all(
      `SELECT id, projectId, name, sortOrder, createdAt
       FROM subprojects
       WHERE id = ?`,
      [subProjectId]
    );
    return mapSubproject(rows[0]);
  };

  const getLatestSubprojectForProject = (projectId) => {
    const rows = db.all(
      `SELECT id, projectId, name, sortOrder, createdAt
       FROM subprojects
       WHERE projectId = ?
       ORDER BY sortOrder DESC, id DESC
       LIMIT 1`,
      [projectId]
    );
    return mapSubproject(rows[0]);
  };

  const getSubprojectByProjectAndId = (projectId, subProjectId) => {
    const rows = db.all(
      `SELECT id, projectId, name, sortOrder, createdAt
       FROM subprojects
       WHERE projectId = ? AND id = ?`,
      [projectId, subProjectId]
    );
    return mapSubproject(rows[0]);
  };

  const getSubprojectsForProject = (projectId) =>
    db
      .all(
        `SELECT id, projectId, name, sortOrder, createdAt
         FROM subprojects
         WHERE projectId = ?
         ORDER BY sortOrder ASC, id ASC`,
        [projectId]
      )
      .map(mapSubproject);

  const createDefaultSubprojectForProject = async (projectId) => {
    const existingRows = db.all(
      `SELECT id
       FROM subprojects
       WHERE projectId = ?
       LIMIT 1`,
      [projectId]
    );
    if (existingRows.length > 0) {
      return;
    }
    await db.run(
      `INSERT INTO subprojects (projectId, name, sortOrder, createdAt)
       VALUES (?, ?, 1, ?)`,
      [projectId, DEFAULT_SUBPROJECT_NAME, new Date().toISOString()]
    );
  };

  const getInstanceBySubprojectActivityAndDay = (subProjectId, activityId, day) => {
    const rows = db.all(
      `SELECT id, subProjectId, activityId, day, createdAt
       FROM activity_instances
       WHERE subProjectId = ? AND activityId = ? AND day = ?`,
      [subProjectId, activityId, day]
    );
    return mapInstance(rows[0]);
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/projects', (_req, res) => {
    const rows = db.all(
      `SELECT id, name, startDate, endDate, lengthDays, createdAt, updatedAt
       FROM projects
       ORDER BY datetime(updatedAt) DESC, id DESC`
    );

    res.json(rows.map(mapProject));
  });

  app.post('/api/projects', async (req, res) => {
    const normalized = normalizeProjectPayload(req.body);
    if (!normalized.value) {
      res.status(400).json({ error: normalized.error });
      return;
    }

    let initialSubProjectName = DEFAULT_SUBPROJECT_NAME;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'subProjectName')) {
      const normalizedSubproject = normalizeSubprojectPayload({
        name: req.body?.subProjectName
      });
      if (!normalizedSubproject.value) {
        res.status(400).json({ error: normalizedSubproject.error });
        return;
      }
      initialSubProjectName = normalizedSubproject.value.name;
    }

    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO projects (name, startDate, endDate, lengthDays, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        normalized.value.name,
        normalized.value.startDate,
        normalized.value.endDate,
        normalized.value.lengthDays,
        now,
        now
      ]
    );

    const created = getLatestProject();
    if (created) {
      await db.run(
        `INSERT INTO subprojects (projectId, name, sortOrder, createdAt)
         VALUES (?, ?, 1, ?)`,
        [created.id, initialSubProjectName, new Date().toISOString()]
      );
    }
    res.status(201).json(created);
  });

  app.get('/api/projects/:projectId', (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    const project = getProjectById(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    res.json(project);
  });

  app.put('/api/projects/:projectId', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    const existing = getProjectById(projectId);
    if (!existing) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const normalized = normalizeProjectPayload(req.body);
    if (!normalized.value) {
      res.status(400).json({ error: normalized.error });
      return;
    }

    const confirmTrimOutOfRangeInstances = Boolean(req.body?.confirmTrimOutOfRangeInstances);
    const outOfRangeCountRows = db.all(
      `SELECT COUNT(*) AS total
       FROM activity_instances ai
       JOIN activities a ON a.id = ai.activityId
       WHERE a.projectId = ?
         AND (ai.day < ? OR ai.day > ?)`,
      [projectId, normalized.value.startDate, normalized.value.endDate]
    );
    const outOfRangeInstances = outOfRangeCountRows[0]?.total || 0;

    if (outOfRangeInstances > 0 && !confirmTrimOutOfRangeInstances) {
      res.status(409).json({
        code: 'PROJECT_RANGE_PRUNE_REQUIRED',
        outOfRangeInstances,
        error: `Updating this project would remove ${outOfRangeInstances} activity instance(s) outside the new date range.`
      });
      return;
    }

    if (outOfRangeInstances > 0) {
      await db.run(
        `DELETE FROM activity_instances
         WHERE id IN (
           SELECT ai.id
           FROM activity_instances ai
           JOIN activities a ON a.id = ai.activityId
           WHERE a.projectId = ?
             AND (ai.day < ? OR ai.day > ?)
         )`,
        [projectId, normalized.value.startDate, normalized.value.endDate]
      );
    }

    await db.run(
      `UPDATE projects
       SET name = ?, startDate = ?, endDate = ?, lengthDays = ?, updatedAt = ?
       WHERE id = ?`,
      [
        normalized.value.name,
        normalized.value.startDate,
        normalized.value.endDate,
        normalized.value.lengthDays,
        new Date().toISOString(),
        projectId
      ]
    );

    res.json({
      ...getProjectById(projectId),
      prunedInstances: outOfRangeInstances
    });
  });

  app.delete('/api/projects/:projectId', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    const existing = getProjectById(projectId);
    if (!existing) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const activityCountRows = db.all(
      `SELECT COUNT(*) AS total
       FROM activities
       WHERE projectId = ?`,
      [projectId]
    );

    const instanceCountRows = db.all(
      `SELECT COUNT(*) AS total
       FROM activity_instances ai
       JOIN activities a ON a.id = ai.activityId
       WHERE a.projectId = ?`,
      [projectId]
    );

    const subprojectCountRows = db.all(
      `SELECT COUNT(*) AS total
       FROM subprojects
       WHERE projectId = ?`,
      [projectId]
    );

    await db.run('DELETE FROM projects WHERE id = ?', [projectId]);

    res.json({
      deletedId: projectId,
      deletedSubprojects: subprojectCountRows[0]?.total || 0,
      deletedActivities: activityCountRows[0]?.total || 0,
      deletedInstances: instanceCountRows[0]?.total || 0
    });
  });

  app.get('/api/projects/:projectId/activities', (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    if (!getProjectById(projectId)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const rows = db.all(
      `SELECT id, projectId, name, color, createdAt, sortOrder
       FROM activities
       WHERE projectId = ?
       ORDER BY sortOrder ASC, id ASC`,
      [projectId]
    );

    res.json(rows.map(mapActivity));
  });

  app.post('/api/projects/:projectId/activities', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    if (!getProjectById(projectId)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const normalized = normalizeActivityPayload(req.body);
    if (!normalized.value) {
      res.status(400).json({ error: normalized.error });
      return;
    }

    const createdAt = new Date().toISOString();
    const nextSortOrderRows = db.all(
      `SELECT COALESCE(MAX(sortOrder), 0) + 1 AS nextSortOrder
       FROM activities
       WHERE projectId = ?`,
      [projectId]
    );
    const nextSortOrder = nextSortOrderRows[0]?.nextSortOrder || 1;

    try {
      await db.run(
        `INSERT INTO activities (projectId, name, color, createdAt, sortOrder)
         VALUES (?, ?, ?, ?, ?)`,
        [projectId, normalized.value.name, normalized.value.color, createdAt, nextSortOrder]
      );
    } catch (error) {
      if (isConstraintError(error)) {
        res.status(409).json({ error: 'Activity name must be unique within this project.' });
        return;
      }
      throw error;
    }

    res.status(201).json(getLatestActivityForProject(projectId));
  });

  app.put('/api/projects/:projectId/activities/:activityId', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    const activityId = parseIntegerId(req.params.activityId);
    if (!projectId || !activityId) {
      res.status(400).json({ error: 'Invalid project id or activity id.' });
      return;
    }

    if (!getProjectById(projectId)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const activity = getActivityByProjectAndId(projectId, activityId);
    if (!activity) {
      res.status(404).json({ error: 'Activity not found.' });
      return;
    }

    const normalized = normalizeActivityPayload(req.body);
    if (!normalized.value) {
      res.status(400).json({ error: normalized.error });
      return;
    }

    try {
      await db.run(
        `UPDATE activities
         SET name = ?, color = ?
         WHERE id = ?`,
        [normalized.value.name, normalized.value.color, activityId]
      );
    } catch (error) {
      if (isConstraintError(error)) {
        res.status(409).json({ error: 'Activity name must be unique within this project.' });
        return;
      }
      throw error;
    }

    res.json(getActivityById(activityId));
  });

  app.post('/api/projects/:projectId/activities/:activityId/reorder', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    const activityId = parseIntegerId(req.params.activityId);
    if (!projectId || !activityId) {
      res.status(400).json({ error: 'Invalid project id or activity id.' });
      return;
    }

    const direction = typeof req.body?.direction === 'string' ? req.body.direction : '';
    if (direction !== 'up' && direction !== 'down') {
      res.status(400).json({ error: "direction must be 'up' or 'down'." });
      return;
    }

    const activity = getActivityByProjectAndId(projectId, activityId);
    if (!activity) {
      res.status(404).json({ error: 'Activity not found.' });
      return;
    }

    const neighborRows = db.all(
      direction === 'up'
        ? `SELECT id, sortOrder
           FROM activities
           WHERE projectId = ? AND sortOrder < ?
           ORDER BY sortOrder DESC, id DESC
           LIMIT 1`
        : `SELECT id, sortOrder
           FROM activities
           WHERE projectId = ? AND sortOrder > ?
           ORDER BY sortOrder ASC, id ASC
           LIMIT 1`,
      [projectId, activity.sortOrder]
    );

    const neighbor = neighborRows[0];
    if (!neighbor) {
      res.json({ moved: false, activity: getActivityById(activityId) });
      return;
    }

    await db.run('UPDATE activities SET sortOrder = ? WHERE id = ?', [activity.sortOrder, neighbor.id]);
    await db.run('UPDATE activities SET sortOrder = ? WHERE id = ?', [neighbor.sortOrder, activityId]);

    res.json({ moved: true, activity: getActivityById(activityId) });
  });

  app.delete('/api/projects/:projectId/activities/:activityId', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    const activityId = parseIntegerId(req.params.activityId);
    if (!projectId || !activityId) {
      res.status(400).json({ error: 'Invalid project id or activity id.' });
      return;
    }

    const activity = getActivityByProjectAndId(projectId, activityId);
    if (!activity) {
      res.status(404).json({ error: 'Activity not found.' });
      return;
    }

    const countRows = db.all(
      `SELECT COUNT(*) AS total
       FROM activity_instances
       WHERE activityId = ?`,
      [activityId]
    );

    await db.run('DELETE FROM activities WHERE id = ?', [activityId]);

    res.json({
      deletedId: activityId,
      deletedInstances: countRows[0]?.total || 0
    });
  });

  app.get('/api/projects/:projectId/subprojects', (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    if (!getProjectById(projectId)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    res.json(getSubprojectsForProject(projectId));
  });

  app.post('/api/projects/:projectId/subprojects', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    if (!getProjectById(projectId)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const normalized = normalizeSubprojectPayload(req.body);
    if (!normalized.value) {
      res.status(400).json({ error: normalized.error });
      return;
    }

    const nextSortOrderRows = db.all(
      `SELECT COALESCE(MAX(sortOrder), 0) + 1 AS nextSortOrder
       FROM subprojects
       WHERE projectId = ?`,
      [projectId]
    );
    const nextSortOrder = nextSortOrderRows[0]?.nextSortOrder || 1;

    try {
      await db.run(
        `INSERT INTO subprojects (projectId, name, sortOrder, createdAt)
         VALUES (?, ?, ?, ?)`,
        [projectId, normalized.value.name, nextSortOrder, new Date().toISOString()]
      );
    } catch (error) {
      if (isConstraintError(error)) {
        res.status(409).json({ error: 'Sub-project name must be unique within this project.' });
        return;
      }
      throw error;
    }

    res.status(201).json(getLatestSubprojectForProject(projectId));
  });

  app.put('/api/projects/:projectId/subprojects/:subProjectId', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    const subProjectId = parseIntegerId(req.params.subProjectId);
    if (!projectId || !subProjectId) {
      res.status(400).json({ error: 'Invalid project id or sub-project id.' });
      return;
    }

    const subproject = getSubprojectByProjectAndId(projectId, subProjectId);
    if (!subproject) {
      res.status(404).json({ error: 'Sub-project not found.' });
      return;
    }

    const normalized = normalizeSubprojectPayload(req.body);
    if (!normalized.value) {
      res.status(400).json({ error: normalized.error });
      return;
    }

    try {
      await db.run(
        `UPDATE subprojects
         SET name = ?
         WHERE id = ?`,
        [normalized.value.name, subProjectId]
      );
    } catch (error) {
      if (isConstraintError(error)) {
        res.status(409).json({ error: 'Sub-project name must be unique within this project.' });
        return;
      }
      throw error;
    }

    res.json(getSubprojectById(subProjectId));
  });

  app.post('/api/projects/:projectId/subprojects/:subProjectId/reorder', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    const subProjectId = parseIntegerId(req.params.subProjectId);
    if (!projectId || !subProjectId) {
      res.status(400).json({ error: 'Invalid project id or sub-project id.' });
      return;
    }

    const direction = typeof req.body?.direction === 'string' ? req.body.direction : '';
    if (direction !== 'up' && direction !== 'down') {
      res.status(400).json({ error: "direction must be 'up' or 'down'." });
      return;
    }

    const subproject = getSubprojectByProjectAndId(projectId, subProjectId);
    if (!subproject) {
      res.status(404).json({ error: 'Sub-project not found.' });
      return;
    }

    const neighborRows = db.all(
      direction === 'up'
        ? `SELECT id, sortOrder
           FROM subprojects
           WHERE projectId = ? AND sortOrder < ?
           ORDER BY sortOrder DESC, id DESC
           LIMIT 1`
        : `SELECT id, sortOrder
           FROM subprojects
           WHERE projectId = ? AND sortOrder > ?
           ORDER BY sortOrder ASC, id ASC
           LIMIT 1`,
      [projectId, subproject.sortOrder]
    );

    const neighbor = neighborRows[0];
    if (!neighbor) {
      res.json({ moved: false, subproject: getSubprojectById(subProjectId) });
      return;
    }

    await db.run('UPDATE subprojects SET sortOrder = ? WHERE id = ?', [subproject.sortOrder, neighbor.id]);
    await db.run('UPDATE subprojects SET sortOrder = ? WHERE id = ?', [neighbor.sortOrder, subProjectId]);

    res.json({ moved: true, subproject: getSubprojectById(subProjectId) });
  });

  app.delete('/api/projects/:projectId/subprojects/:subProjectId', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    const subProjectId = parseIntegerId(req.params.subProjectId);
    if (!projectId || !subProjectId) {
      res.status(400).json({ error: 'Invalid project id or sub-project id.' });
      return;
    }

    const subproject = getSubprojectByProjectAndId(projectId, subProjectId);
    if (!subproject) {
      res.status(404).json({ error: 'Sub-project not found.' });
      return;
    }

    const siblingCountRows = db.all(
      `SELECT COUNT(*) AS total
       FROM subprojects
       WHERE projectId = ?`,
      [projectId]
    );
    const siblingCount = siblingCountRows[0]?.total || 0;
    if (siblingCount <= 1) {
      res.status(409).json({
        code: 'SUBPROJECT_MINIMUM_REQUIRED',
        error: 'A project must have at least one sub-project.'
      });
      return;
    }

    const countRows = db.all(
      `SELECT COUNT(*) AS total
       FROM activity_instances
       WHERE subProjectId = ?`,
      [subProjectId]
    );

    await db.run('DELETE FROM subprojects WHERE id = ?', [subProjectId]);

    res.json({
      deletedId: subProjectId,
      deletedInstances: countRows[0]?.total || 0
    });
  });

  app.get('/api/projects/:projectId/board', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    if (!projectId) {
      res.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    const project = getProjectById(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    await createDefaultSubprojectForProject(projectId);

    const activityRows = db.all(
      `SELECT id, projectId, name, color, createdAt, sortOrder
       FROM activities
       WHERE projectId = ?
       ORDER BY sortOrder ASC, id ASC`,
      [projectId]
    );

    const subprojects = getSubprojectsForProject(projectId);
    const hasSubprojectQuery = Object.prototype.hasOwnProperty.call(req.query, 'subProjectId');
    const requestedSubProjectId = parseIntegerId(req.query.subProjectId);
    if (hasSubprojectQuery && !requestedSubProjectId) {
      res.status(400).json({ error: 'Invalid subProjectId query parameter.' });
      return;
    }

    const activeSubProjectId = requestedSubProjectId || subprojects[0]?.id || null;
    if (
      activeSubProjectId &&
      !subprojects.some((subproject) => subproject.id === activeSubProjectId)
    ) {
      res.status(404).json({ error: 'Sub-project not found.' });
      return;
    }

    const instanceRows = db.all(
      `SELECT ai.id, ai.subProjectId, ai.activityId, ai.day, ai.createdAt, a.sortOrder
       FROM activity_instances ai
       JOIN activities a ON a.id = ai.activityId
       WHERE a.projectId = ?
       ORDER BY ai.day ASC, a.sortOrder ASC, ai.id ASC`,
      [projectId]
    );

    const activities = activityRows.map(mapActivity);
    const instances = instanceRows.map(mapInstance);
    const instanceMap = {};
    const subProjectDayMap = {};

    for (const instance of instances) {
      const subprojectKey = String(instance.subProjectId);
      if (!subProjectDayMap[subprojectKey]) {
        subProjectDayMap[subprojectKey] = {};
      }
      if (!subProjectDayMap[subprojectKey][instance.day]) {
        subProjectDayMap[subprojectKey][instance.day] = [];
      }
      subProjectDayMap[subprojectKey][instance.day].push({
        instanceId: instance.id,
        activityId: instance.activityId
      });

      if (instance.subProjectId !== activeSubProjectId) {
        continue;
      }
      const activityKey = String(instance.activityId);
      if (!instanceMap[activityKey]) {
        instanceMap[activityKey] = {};
      }
      instanceMap[activityKey][instance.day] = instance.id;
    }

    res.json({
      project,
      days: buildDayRange(project.startDate, project.endDate),
      activities,
      subprojects,
      activeSubProjectId,
      instances,
      instanceMap,
      subProjectDayMap
    });
  });

  app.post('/api/projects/:projectId/activities/:activityId/instances', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    const activityId = parseIntegerId(req.params.activityId);
    if (!projectId || !activityId) {
      res.status(400).json({ error: 'Invalid project id or activity id.' });
      return;
    }

    const activity = getActivityByProjectAndId(projectId, activityId);
    if (!activity) {
      res.status(404).json({ error: 'Activity not found.' });
      return;
    }

    const subProjectId = parseIntegerId(req.body?.subProjectId);
    if (!subProjectId) {
      res.status(400).json({ error: 'subProjectId is required.' });
      return;
    }

    const subproject = getSubprojectByProjectAndId(projectId, subProjectId);
    if (!subproject) {
      res.status(404).json({ error: 'Sub-project not found.' });
      return;
    }

    const day = typeof req.body?.date === 'string' ? req.body.date.trim() : '';
    const parsedDay = parseDateKey(day);
    if (!parsedDay) {
      res.status(400).json({ error: 'date must be a valid date key (YYYY-MM-DD).' });
      return;
    }

    const project = getProjectById(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    if (day < project.startDate || day > project.endDate) {
      res.status(400).json({ error: 'date must be within the project range.' });
      return;
    }

    try {
      await db.run(
        `INSERT INTO activity_instances (subProjectId, activityId, day, createdAt)
         VALUES (?, ?, ?, ?)`,
        [subProjectId, activityId, day, new Date().toISOString()]
      );
    } catch (error) {
      if (isConstraintError(error)) {
        res.status(409).json({
          error: 'An instance already exists for this sub-project, activity, and day.'
        });
        return;
      }
      throw error;
    }

    res.status(201).json(getInstanceBySubprojectActivityAndDay(subProjectId, activityId, day));
  });

  app.delete('/api/projects/:projectId/activities/:activityId/instances/:date', async (req, res) => {
    const projectId = parseIntegerId(req.params.projectId);
    const activityId = parseIntegerId(req.params.activityId);
    const day = typeof req.params.date === 'string' ? req.params.date.trim() : '';
    const subProjectId = parseIntegerId(req.query.subProjectId);

    if (!projectId || !activityId) {
      res.status(400).json({ error: 'Invalid project id or activity id.' });
      return;
    }

    if (!parseDateKey(day)) {
      res.status(400).json({ error: 'Invalid instance date key.' });
      return;
    }

    if (!subProjectId) {
      res.status(400).json({ error: 'subProjectId query parameter is required.' });
      return;
    }

    const activity = getActivityByProjectAndId(projectId, activityId);
    if (!activity) {
      res.status(404).json({ error: 'Activity not found.' });
      return;
    }

    const subproject = getSubprojectByProjectAndId(projectId, subProjectId);
    if (!subproject) {
      res.status(404).json({ error: 'Sub-project not found.' });
      return;
    }

    const instance = getInstanceBySubprojectActivityAndDay(subProjectId, activityId, day);
    if (!instance) {
      res.status(404).json({ error: 'Activity instance not found.' });
      return;
    }

    await db.run('DELETE FROM activity_instances WHERE id = ?', [instance.id]);

    res.json({
      deletedId: instance.id,
      activityId,
      subProjectId,
      date: day
    });
  });

  return { app, db };
};
