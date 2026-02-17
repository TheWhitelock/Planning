import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PlanningApp from '../PlanningApp.jsx';

const parseDateKey = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const toDateKey = (date) => {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDaysToDateKey = (dateKey, amount) => {
  const parsed = parseDateKey(dateKey);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return toDateKey(parsed);
};

const buildDays = (startDate, endDate) => {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  const days = [];
  let cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const weekday = cursor.getUTCDay();
    days.push({
      date: toDateKey(cursor),
      isWeekend: weekday === 0 || weekday === 6
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

const makeResponse = (body, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  });

const setupApiMock = (state) => {
  const local = {
    projects: [...(state.projects || [])],
    activities: [...(state.activities || [])],
    subprojects: [...(state.subprojects || [])],
    instances: [...(state.instances || [])],
    ids: {
      project: 100,
      activity: 200,
      subproject: 300,
      instance: 400
    },
    shiftDelayMs: Number(state.shiftDelayMs || 0)
  };

  const findProject = (projectId) => local.projects.find((project) => project.id === projectId);
  const listActivities = (projectId) =>
    local.activities
      .filter((activity) => activity.projectId === projectId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  const listSubprojects = (projectId) =>
    local.subprojects
      .filter((subproject) => subproject.projectId === projectId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  const listInstances = (projectId) => {
    const activityIds = new Set(listActivities(projectId).map((activity) => activity.id));
    return local.instances.filter((instance) => activityIds.has(instance.activityId));
  };

  const makeBoard = (projectId, requestedSubProjectId = null) => {
    const project = findProject(projectId);
    const activities = listActivities(projectId);
    const subprojects = listSubprojects(projectId);
    const instances = listInstances(projectId);
    const activeSubProjectId =
      requestedSubProjectId && subprojects.some((subproject) => subproject.id === requestedSubProjectId)
        ? requestedSubProjectId
        : subprojects[0]?.id || null;

    const instanceMap = {};
    const subProjectDayMap = {};

    instances.forEach((instance) => {
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
        return;
      }

      const activityKey = String(instance.activityId);
      if (!instanceMap[activityKey]) {
        instanceMap[activityKey] = {};
      }
      instanceMap[activityKey][instance.day] = instance.id;
    });

    return {
      project,
      days: buildDays(project.startDate, project.endDate),
      activities,
      subprojects,
      activeSubProjectId,
      instances,
      instanceMap,
      subProjectDayMap
    };
  };

  return vi.fn(async (url, options = {}) => {
    const requestUrl = new URL(url, 'http://localhost');
    const method = (options.method || 'GET').toUpperCase();
    const path = requestUrl.pathname;
    const body = options.body ? JSON.parse(options.body) : null;

    if (method === 'GET' && path === '/api/projects') {
      return makeResponse(local.projects);
    }

    const boardMatch = path.match(/^\/api\/projects\/(\d+)\/board$/);
    if (boardMatch && method === 'GET') {
      const projectId = Number(boardMatch[1]);
      const project = findProject(projectId);
      if (!project) {
        return makeResponse({ error: 'Project not found.' }, 404);
      }
      const subProjectIdRaw = requestUrl.searchParams.get('subProjectId');
      const subProjectId = subProjectIdRaw ? Number(subProjectIdRaw) : null;
      return makeResponse(makeBoard(projectId, subProjectId));
    }

    const createActivityMatch = path.match(/^\/api\/projects\/(\d+)\/activities$/);
    if (createActivityMatch && method === 'POST') {
      const projectId = Number(createActivityMatch[1]);
      const id = local.ids.activity++;
      const nextSortOrder =
        listActivities(projectId).reduce((max, activity) => Math.max(max, activity.sortOrder || 0), 0) + 1;
      const activity = {
        id,
        projectId,
        name: body.name,
        color: body.color,
        createdAt: new Date().toISOString(),
        sortOrder: nextSortOrder
      };
      local.activities.push(activity);
      return makeResponse(activity, 201);
    }

    const createSubProjectMatch = path.match(/^\/api\/projects\/(\d+)\/subprojects$/);
    if (createSubProjectMatch && method === 'POST') {
      const projectId = Number(createSubProjectMatch[1]);
      const id = local.ids.subproject++;
      const nextSortOrder =
        listSubprojects(projectId).reduce(
          (max, subproject) => Math.max(max, subproject.sortOrder || 0),
          0
        ) + 1;
      const subproject = {
        id,
        projectId,
        name: body.name,
        createdAt: new Date().toISOString(),
        sortOrder: nextSortOrder
      };
      local.subprojects.push(subproject);
      return makeResponse(subproject, 201);
    }

    const deleteSubProjectMatch = path.match(/^\/api\/projects\/(\d+)\/subprojects\/(\d+)$/);
    if (deleteSubProjectMatch && method === 'DELETE') {
      const projectId = Number(deleteSubProjectMatch[1]);
      const subProjectId = Number(deleteSubProjectMatch[2]);
      if (listSubprojects(projectId).length <= 1) {
        return makeResponse(
          { code: 'SUBPROJECT_MINIMUM_REQUIRED', error: 'A project must have at least one sub-project.' },
          409
        );
      }
      const deletedInstances = local.instances.filter((instance) => instance.subProjectId === subProjectId)
        .length;
      local.instances = local.instances.filter((instance) => instance.subProjectId !== subProjectId);
      local.subprojects = local.subprojects.filter((subproject) => subproject.id !== subProjectId);
      return makeResponse({ deletedId: subProjectId, deletedInstances });
    }

    const duplicateSubProjectMatch = path.match(
      /^\/api\/projects\/(\d+)\/subprojects\/(\d+)\/duplicate$/
    );
    if (duplicateSubProjectMatch && method === 'POST') {
      const projectId = Number(duplicateSubProjectMatch[1]);
      const sourceSubProjectId = Number(duplicateSubProjectMatch[2]);
      const source = local.subprojects.find(
        (subproject) => subproject.projectId === projectId && subproject.id === sourceSubProjectId
      );
      if (!source) {
        return makeResponse({ error: 'Sub-project not found.' }, 404);
      }

      const existingNames = new Set(
        listSubprojects(projectId).map((subproject) => subproject.name.toLowerCase())
      );
      const requestedName = typeof body?.name === 'string' ? body.name.trim() : '';
      let nextName = requestedName;
      if (!nextName) {
        nextName = `${source.name} (copy)`;
        let index = 2;
        while (existingNames.has(nextName.toLowerCase())) {
          nextName = `${source.name} (copy ${index})`;
          index += 1;
        }
      } else if (existingNames.has(nextName.toLowerCase())) {
        return makeResponse({ error: 'Sub-project name must be unique within this project.' }, 409);
      }

      const id = local.ids.subproject++;
      const nextSortOrder =
        listSubprojects(projectId).reduce(
          (max, subproject) => Math.max(max, subproject.sortOrder || 0),
          0
        ) + 1;
      const duplicated = {
        id,
        projectId,
        name: nextName,
        createdAt: new Date().toISOString(),
        sortOrder: nextSortOrder
      };
      local.subprojects.push(duplicated);

      const sourceInstances = local.instances.filter(
        (instance) => instance.subProjectId === sourceSubProjectId
      );
      const selectedActivityIds = Array.isArray(body?.activityIds)
        ? new Set(body.activityIds.map((value) => Number(value)))
        : null;
      const sourceInstancesToCopy = selectedActivityIds
        ? sourceInstances.filter((instance) => selectedActivityIds.has(instance.activityId))
        : sourceInstances;
      sourceInstancesToCopy.forEach((instance) => {
        local.instances.push({
          id: local.ids.instance++,
          activityId: instance.activityId,
          subProjectId: duplicated.id,
          day: instance.day,
          createdAt: new Date().toISOString()
        });
      });

      return makeResponse({
        subproject: duplicated,
        copiedInstances: sourceInstancesToCopy.length
      }, 201);
    }

    const shiftSubProjectMatch = path.match(/^\/api\/projects\/(\d+)\/subprojects\/(\d+)\/shift$/);
    if (shiftSubProjectMatch && method === 'POST') {
      const projectId = Number(shiftSubProjectMatch[1]);
      const subProjectId = Number(shiftSubProjectMatch[2]);
      const days = Number(body?.days);
      const confirmDeleteOutOfRangeInstances = Boolean(body?.confirmDeleteOutOfRangeInstances);
      if (!Number.isInteger(days) || days === 0) {
        return makeResponse({ error: 'days must be a non-zero integer.' }, 400);
      }

      const project = findProject(projectId);
      const subproject = local.subprojects.find(
        (entry) => entry.projectId === projectId && entry.id === subProjectId
      );
      if (!project || !subproject) {
        return makeResponse({ error: 'Sub-project not found.' }, 404);
      }

      if (local.shiftDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, local.shiftDelayMs));
      }

      const sourceInstances = local.instances.filter((instance) => instance.subProjectId === subProjectId);
      const outOfRange = [];
      const candidates = [];
      sourceInstances.forEach((instance) => {
        const targetDay = addDaysToDateKey(instance.day, days);
        if (targetDay < project.startDate || targetDay > project.endDate) {
          outOfRange.push(instance);
          return;
        }
        candidates.push({
          ...instance,
          targetDay
        });
      });

      if (outOfRange.length > 0 && !confirmDeleteOutOfRangeInstances) {
        return makeResponse(
          {
            code: 'SUBPROJECT_SHIFT_OUT_OF_RANGE_DELETE_REQUIRED',
            outOfRangeInstances: outOfRange.length,
            error: `Shifting would remove ${outOfRange.length} activity instance(s) outside the project date range.`
          },
          409
        );
      }

      if (outOfRange.length > 0) {
        const outOfRangeIds = new Set(outOfRange.map((instance) => instance.id));
        local.instances = local.instances.filter((instance) => !outOfRangeIds.has(instance.id));
      }

      const occupiedBySkipped = new Set();
      const skippedDuplicates = [];
      const movable = [];
      candidates.forEach((candidate) => {
        const key = `${candidate.activityId}:${candidate.targetDay}`;
        if (occupiedBySkipped.has(key)) {
          skippedDuplicates.push(candidate);
          return;
        }
        movable.push(candidate);
      });

      const movedInstanceIds = [];
      movable.forEach((candidate) => {
        const target = local.instances.find((instance) => instance.id === candidate.id);
        if (!target) {
          return;
        }
        target.day = candidate.targetDay;
        movedInstanceIds.push(target.id);
      });

      return makeResponse({
        requestedShiftDays: days,
        movedCount: movable.length,
        skippedOutOfRangeCount: outOfRange.length,
        skippedDuplicateCount: skippedDuplicates.length,
        totalSourceCount: sourceInstances.length,
        movedInstanceIds,
        deletedOutOfRangeCount: outOfRange.length
      });
    }

    const createInstanceMatch = path.match(/^\/api\/projects\/(\d+)\/activities\/(\d+)\/instances$/);
    if (createInstanceMatch && method === 'POST') {
      const activityId = Number(createInstanceMatch[2]);
      const duplicate = local.instances.find(
        (instance) =>
          instance.activityId === activityId &&
          instance.day === body.date &&
          instance.subProjectId === body.subProjectId
      );
      if (duplicate) {
        return makeResponse(
          { error: 'An instance already exists for this sub-project, activity, and day.' },
          409
        );
      }
      const instance = {
        id: local.ids.instance++,
        activityId,
        subProjectId: body.subProjectId,
        day: body.date,
        createdAt: new Date().toISOString()
      };
      local.instances.push(instance);
      return makeResponse(instance, 201);
    }

    const deleteInstanceMatch = path.match(
      /^\/api\/projects\/(\d+)\/activities\/(\d+)\/instances\/(\d{4}-\d{2}-\d{2})$/
    );
    if (deleteInstanceMatch && method === 'DELETE') {
      const activityId = Number(deleteInstanceMatch[2]);
      const day = deleteInstanceMatch[3];
      const subProjectId = Number(requestUrl.searchParams.get('subProjectId'));
      const existing = local.instances.find(
        (instance) =>
          instance.activityId === activityId && instance.day === day && instance.subProjectId === subProjectId
      );
      local.instances = local.instances.filter(
        (instance) => !(instance.activityId === activityId && instance.day === day && instance.subProjectId === subProjectId)
      );
      return makeResponse({ deletedId: existing?.id, activityId, subProjectId, date: day });
    }

    return makeResponse({ error: `Unhandled endpoint: ${method} ${path}` }, 404);
  });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Planning app', () => {
  it('renders activity mode with grouped controls in header', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Alpha',
          startDate: '2026-02-10',
          endDate: '2026-02-11',
          lengthDays: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [],
      subprojects: [
        { id: 10, projectId: 1, name: 'Main', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      instances: []
    });

    render(<PlanningApp />);

    await waitFor(() => {
      expect(screen.getByText('Activity mode')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /new activity/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /new sub-project/i })).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: /sub-project/i })).not.toBeInTheDocument();
    });
  });

  it('creates and removes an activity instance in activity mode', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Gamma',
          startDate: '2026-02-10',
          endDate: '2026-02-11',
          lengthDays: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [],
      subprojects: [
        { id: 10, projectId: 1, name: 'Main', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      instances: []
    });

    render(<PlanningApp />);

    fireEvent.click(await screen.findByRole('button', { name: /new activity/i }));
    fireEvent.change(await screen.findByLabelText(/activity name/i), {
      target: { value: 'Build' }
    });
    fireEvent.click(screen.getByRole('button', { name: /create activity/i }));

    const cell = await screen.findByLabelText('Main Build on 2026-02-10');
    fireEvent.click(cell);

    await waitFor(() => {
      expect(screen.getByLabelText('Main Build on 2026-02-10')).toHaveTextContent('1/1');
    });

    fireEvent.click(screen.getByLabelText('Main Build on 2026-02-10'));

    await waitFor(() => {
      expect(screen.getByLabelText('Main Build on 2026-02-10')).toHaveTextContent('Add');
    });
  });

  it('adds in sub-project mode with menu and hides duplicate activity choices', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Delta',
          startDate: '2026-02-10',
          endDate: '2026-02-11',
          lengthDays: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [
        { id: 20, projectId: 1, name: 'Design', color: '#1b5c4f', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 },
        { id: 21, projectId: 1, name: 'Review', color: '#c05621', createdAt: '2026-01-03T00:00:00.000Z', sortOrder: 2 }
      ],
      subprojects: [
        { id: 10, projectId: 1, name: 'Main', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      instances: []
    });

    render(<PlanningApp />);

    fireEvent.click(await screen.findByRole('button', { name: /sub-project mode/i }));

    const addButton = await screen.findByLabelText('Add instance for Main on 2026-02-10');
    fireEvent.click(addButton);

    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('button', { name: /Design/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Main Design on 2026-02-10')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Add instance for Main on 2026-02-10'));

    await waitFor(() => {
      const nextMenu = screen.getByRole('menu');
      expect(within(nextMenu).queryByRole('button', { name: /^Design$/i })).not.toBeInTheDocument();
      expect(within(nextMenu).getByRole('button', { name: /Delete Design/i })).toBeInTheDocument();
      expect(within(nextMenu).getByRole('button', { name: /Review/i })).toBeInTheDocument();
    });
  });

  it('creates and deletes sub-projects in sub-project mode', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Eta',
          startDate: '2026-02-10',
          endDate: '2026-02-11',
          lengthDays: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [],
      subprojects: [
        { id: 10, projectId: 1, name: 'Main', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      instances: []
    });

    render(<PlanningApp />);

    fireEvent.click(await screen.findByRole('button', { name: /sub-project mode/i }));
    fireEvent.click(await screen.findByRole('button', { name: /new sub-project/i }));

    fireEvent.change(await screen.findByLabelText(/sub-project name/i), {
      target: { value: 'Phase 2' }
    });
    fireEvent.click(screen.getByRole('button', { name: /create sub-project/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Add instance for Phase 2 on 2026-02-10')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /open sub-project actions/i })[1]);
    fireEvent.click(await screen.findByRole('button', { name: /delete sub-project/i }));
    await screen.findByRole('button', { name: /^Delete$/i });
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByLabelText('Add instance for Phase 2 on 2026-02-10')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /open sub-project actions/i })[1]);
    fireEvent.click(await screen.findByRole('button', { name: /delete sub-project/i }));
    await screen.findByRole('button', { name: /^Delete$/i });
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByLabelText('Add instance for Phase 2 on 2026-02-10')).not.toBeInTheDocument();
    });
  });

  it('collapses and expands sub-project groups in activity mode and persists per project', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Collapse',
          startDate: '2026-02-10',
          endDate: '2026-02-11',
          lengthDays: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [
        { id: 20, projectId: 1, name: 'Build', color: '#1b5c4f', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      subprojects: [
        { id: 10, projectId: 1, name: 'Main', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      instances: []
    });

    const firstRender = render(<PlanningApp />);
    fireEvent.click(await screen.findByRole('button', { name: /activity mode/i }));
    fireEvent.click(await screen.findByRole('button', { name: /collapse sub-project/i }));

    await waitFor(() => {
      expect(screen.queryByLabelText('Main Build on 2026-02-10')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /expand sub-project/i })).toBeInTheDocument();
    });

    firstRender.unmount();
    render(<PlanningApp />);

    await waitFor(() => {
      expect(screen.queryByLabelText('Main Build on 2026-02-10')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /expand sub-project/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /expand sub-project/i }));
    await waitFor(() => {
      expect(screen.getByLabelText('Main Build on 2026-02-10')).toBeInTheDocument();
    });
  });

  it('duplicates and shifts sub-projects in both modes', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Transform',
          startDate: '2026-02-10',
          endDate: '2026-02-12',
          lengthDays: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [
        { id: 20, projectId: 1, name: 'Design', color: '#1b5c4f', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      subprojects: [
        { id: 10, projectId: 1, name: 'Main', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      instances: [
        { id: 300, activityId: 20, subProjectId: 10, day: '2026-02-10', createdAt: '2026-01-02T00:00:00.000Z' }
      ]
    });

    render(<PlanningApp />);

    fireEvent.click((await screen.findAllByRole('button', { name: /open sub-project actions/i }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: /duplicate sub-project/i }));
    expect(await screen.findByLabelText(/sub-project name/i)).toHaveValue('Main (copy)');
    fireEvent.click(screen.getByRole('button', { name: /^Duplicate sub-project$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText('Main (copy) Design on 2026-02-10')).toBeInTheDocument();
      expect(screen.getByText(/Sub-project duplicated \(1 instances copied\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /open sub-project actions/i })[0]);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: /shift sub-project forward one day/i }))[0]
    );
    await waitFor(() => {
      expect(screen.getByText(/Shifted \+1 day\(s\): moved 1/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Main Design on 2026-02-11')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /sub-project mode/i }));
    fireEvent.click(
      (await screen.findAllByRole('button', { name: /shift sub-project back one day/i }))[0]
    );
    await waitFor(() => {
      expect(screen.getByText(/Shifted -1 day\(s\): moved 1/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Main Design on 2026-02-10')).toBeInTheDocument();
    });
  });

  it('duplicates sub-project with selected activities only', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Selective Copy',
          startDate: '2026-02-10',
          endDate: '2026-02-12',
          lengthDays: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [
        { id: 20, projectId: 1, name: 'Design', color: '#1b5c4f', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 },
        { id: 21, projectId: 1, name: 'Review', color: '#c05621', createdAt: '2026-01-03T00:00:00.000Z', sortOrder: 2 }
      ],
      subprojects: [
        { id: 10, projectId: 1, name: 'Main', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      instances: [
        { id: 300, activityId: 20, subProjectId: 10, day: '2026-02-10', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 301, activityId: 21, subProjectId: 10, day: '2026-02-11', createdAt: '2026-01-02T00:00:00.000Z' }
      ]
    });

    render(<PlanningApp />);

    fireEvent.click((await screen.findAllByRole('button', { name: /open sub-project actions/i }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: /duplicate sub-project/i }));
    fireEvent.click(screen.getByLabelText('Design'));
    fireEvent.click(screen.getByRole('button', { name: /^Duplicate sub-project$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Sub-project duplicated \(1 instances copied\)/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Main (copy) Design on 2026-02-10')).toHaveTextContent('Add');
      expect(screen.getByLabelText('Main (copy) Review on 2026-02-11')).toBeInTheDocument();
    });
  });

  it('disables sub-project transform controls while a shift is pending', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Pending',
          startDate: '2026-02-10',
          endDate: '2026-02-12',
          lengthDays: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [
        { id: 20, projectId: 1, name: 'Design', color: '#1b5c4f', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      subprojects: [
        { id: 10, projectId: 1, name: 'Main', createdAt: '2026-01-02T00:00:00.000Z', sortOrder: 1 }
      ],
      instances: [
        { id: 300, activityId: 20, subProjectId: 10, day: '2026-02-10', createdAt: '2026-01-02T00:00:00.000Z' }
      ],
      shiftDelayMs: 50
    });

    render(<PlanningApp />);
    const actionsButton = (await screen.findAllByRole('button', { name: /open sub-project actions/i }))[0];
    const shiftForwardButton = (await screen.findAllByRole('button', {
      name: /shift sub-project forward one day/i
    }))[0];
    fireEvent.click(shiftForwardButton);

    fireEvent.click(actionsButton);
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: /shift sub-project forward one day/i })[0]
      ).toBeDisabled();
      expect(screen.getByRole('button', { name: /duplicate sub-project/i })).toBeDisabled();
    });

    await waitFor(() => {
      expect(screen.getByText(/Shifted \+1 day\(s\)/i)).toBeInTheDocument();
    });
  });
});
