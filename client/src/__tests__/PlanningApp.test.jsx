import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    instances: [...(state.instances || [])],
    ids: {
      project: 100,
      activity: 200,
      instance: 300
    }
  };

  const findProject = (projectId) => local.projects.find((project) => project.id === projectId);
  const listActivities = (projectId) =>
    local.activities
      .filter((activity) => activity.projectId === projectId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  const listInstances = (projectId) => {
    const activityIds = new Set(listActivities(projectId).map((activity) => activity.id));
    return local.instances.filter((instance) => activityIds.has(instance.activityId));
  };

  const makeBoard = (projectId) => {
    const project = findProject(projectId);
    const activities = listActivities(projectId);
    const instances = listInstances(projectId);
    const instanceMap = {};
    for (const instance of instances) {
      const key = String(instance.activityId);
      if (!instanceMap[key]) {
        instanceMap[key] = {};
      }
      instanceMap[key][instance.day] = instance.id;
    }
    return {
      project,
      days: buildDays(project.startDate, project.endDate),
      activities,
      instances,
      instanceMap
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

    if (method === 'POST' && path === '/api/projects') {
      const id = local.ids.project++;
      const now = new Date().toISOString();
      const project = { id, createdAt: now, updatedAt: now, ...body };
      local.projects.unshift(project);
      return makeResponse(project, 201);
    }

    const projectBoardMatch = path.match(/^\/api\/projects\/(\d+)\/board$/);
    if (projectBoardMatch && method === 'GET') {
      const projectId = Number(projectBoardMatch[1]);
      const project = findProject(projectId);
      if (!project) {
        return makeResponse({ error: 'Project not found.' }, 404);
      }
      return makeResponse(makeBoard(projectId));
    }

    const projectMatch = path.match(/^\/api\/projects\/(\d+)$/);
    if (projectMatch && method === 'PUT') {
      const projectId = Number(projectMatch[1]);
      const index = local.projects.findIndex((project) => project.id === projectId);
      if (index < 0) {
        return makeResponse({ error: 'Project not found.' }, 404);
      }
      local.projects[index] = {
        ...local.projects[index],
        ...body,
        updatedAt: new Date().toISOString()
      };
      return makeResponse(local.projects[index]);
    }

    if (projectMatch && method === 'DELETE') {
      const projectId = Number(projectMatch[1]);
      const activities = listActivities(projectId);
      const activityIds = new Set(activities.map((activity) => activity.id));
      const deletedInstances = local.instances.filter((instance) => activityIds.has(instance.activityId))
        .length;

      local.instances = local.instances.filter((instance) => !activityIds.has(instance.activityId));
      local.activities = local.activities.filter((activity) => activity.projectId !== projectId);
      local.projects = local.projects.filter((project) => project.id !== projectId);

      return makeResponse({
        deletedId: projectId,
        deletedActivities: activities.length,
        deletedInstances
      });
    }

    const activitiesMatch = path.match(/^\/api\/projects\/(\d+)\/activities$/);
    if (activitiesMatch && method === 'POST') {
      const projectId = Number(activitiesMatch[1]);
      const id = local.ids.activity++;
      const nextSortOrder =
        local.activities
          .filter((activity) => activity.projectId === projectId)
          .reduce((max, activity) => Math.max(max, activity.sortOrder || 0), 0) + 1;
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

    const deleteActivityMatch = path.match(/^\/api\/projects\/(\d+)\/activities\/(\d+)$/);
    if (deleteActivityMatch && method === 'PUT') {
      const activityId = Number(deleteActivityMatch[2]);
      const index = local.activities.findIndex((activity) => activity.id === activityId);
      if (index < 0) {
        return makeResponse({ error: 'Activity not found.' }, 404);
      }
      local.activities[index] = {
        ...local.activities[index],
        name: body.name,
        color: body.color
      };
      return makeResponse(local.activities[index]);
    }

    const reorderActivityMatch = path.match(/^\/api\/projects\/(\d+)\/activities\/(\d+)\/reorder$/);
    if (reorderActivityMatch && method === 'POST') {
      const projectId = Number(reorderActivityMatch[1]);
      const activityId = Number(reorderActivityMatch[2]);
      const activity = local.activities.find(
        (entry) => entry.projectId === projectId && entry.id === activityId
      );
      if (!activity) {
        return makeResponse({ error: 'Activity not found.' }, 404);
      }
      const siblings = listActivities(projectId);
      const currentIndex = siblings.findIndex((entry) => entry.id === activityId);
      const nextIndex = body?.direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= siblings.length) {
        return makeResponse({ moved: false, activity });
      }
      const neighbor = siblings[nextIndex];
      const currentOrder = activity.sortOrder;
      activity.sortOrder = neighbor.sortOrder;
      neighbor.sortOrder = currentOrder;
      return makeResponse({ moved: true, activity });
    }

    if (deleteActivityMatch && method === 'DELETE') {
      const activityId = Number(deleteActivityMatch[2]);
      const deletedInstances = local.instances.filter((instance) => instance.activityId === activityId)
        .length;
      local.instances = local.instances.filter((instance) => instance.activityId !== activityId);
      local.activities = local.activities.filter((activity) => activity.id !== activityId);
      return makeResponse({ deletedId: activityId, deletedInstances });
    }

    const createInstanceMatch = path.match(/^\/api\/projects\/(\d+)\/activities\/(\d+)\/instances$/);
    if (createInstanceMatch && method === 'POST') {
      const activityId = Number(createInstanceMatch[2]);
      const id = local.ids.instance++;
      const instance = {
        id,
        activityId,
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
      const existing = local.instances.find(
        (instance) => instance.activityId === activityId && instance.day === day
      );
      local.instances = local.instances.filter(
        (instance) => !(instance.activityId === activityId && instance.day === day)
      );
      return makeResponse({
        deletedId: existing?.id,
        activityId,
        date: day
      });
    }

    return makeResponse({ error: `Unhandled endpoint: ${method} ${path}` }, 404);
  });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Planning app', () => {
  it('renders project board with weekend columns', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Alpha',
          startDate: '2026-02-01',
          endDate: '2026-02-03',
          lengthDays: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [
        {
          id: 10,
          projectId: 1,
          name: 'Design',
          color: '#1b5c4f',
          createdAt: '2026-01-02T00:00:00.000Z'
        }
      ],
      instances: []
    });

    const { container } = render(<PlanningApp />);

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByLabelText('Design on 2026-02-01')).toBeInTheDocument();
    });

    expect(container.querySelectorAll('th.is-weekend').length).toBeGreaterThan(0);
  });

  it('derives end date from start date + length on project creation', async () => {
    global.fetch = setupApiMock({ projects: [], activities: [], instances: [] });

    render(<PlanningApp />);

    fireEvent.click(await screen.findByRole('button', { name: /new project/i }));

    fireEvent.change(screen.getByLabelText(/project name/i), {
      target: { value: 'Beta' }
    });
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: '2026-03-10' }
    });
    fireEvent.change(screen.getByLabelText(/length \(days\)/i), {
      target: { value: '5' }
    });

    expect(screen.getByLabelText(/end date/i).value).toBe('2026-03-14');

    fireEvent.submit(screen.getByRole('button', { name: /create project/i }).closest('form'));

    await waitFor(() => {
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });
  });

  it('creates an activity and assigns an instance by clicking a day cell', async () => {
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
      instances: []
    });

    render(<PlanningApp />);

    fireEvent.click(await screen.findByRole('button', { name: /new activity/i }));

    fireEvent.change(await screen.findByLabelText(/activity name/i), {
      target: { value: 'Build' }
    });
    fireEvent.click(screen.getByRole('button', { name: /create activity/i }));

    const cell = await screen.findByLabelText('Build on 2026-02-10');
    fireEvent.click(cell);

    await waitFor(() => {
      expect(screen.getByLabelText('Build on 2026-02-10')).toHaveTextContent('1/1');
    });
  });

  it('edits an activity from the activities list', async () => {
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
      activities: [
        {
          id: 10,
          projectId: 1,
          name: 'Build',
          color: '#1b5c4f',
          createdAt: '2026-01-02T00:00:00.000Z'
        }
      ],
      instances: []
    });

    render(<PlanningApp />);

    fireEvent.click(await screen.findByRole('button', { name: /edit activity/i }));
    fireEvent.change(await screen.findByLabelText(/activity name/i), {
      target: { value: 'Build v2' }
    });
    fireEvent.click(screen.getByRole('button', { name: /save activity/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Build v2 on 2026-02-10')).toBeInTheDocument();
      expect(screen.getByText(/activity updated/i)).toBeInTheDocument();
    });
  });

  it('deletes an activity with cascade message', async () => {
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
        {
          id: 10,
          projectId: 1,
          name: 'Test',
          color: '#1b5c4f',
          createdAt: '2026-01-02T00:00:00.000Z'
        }
      ],
      instances: [
        {
          id: 25,
          activityId: 10,
          day: '2026-02-10',
          createdAt: '2026-01-03T00:00:00.000Z'
        }
      ]
    });

    render(<PlanningApp />);

    fireEvent.click(await screen.findByRole('button', { name: /delete activity/i }));

    await waitFor(() => {
      expect(screen.getByText(/instances removed/i)).toBeInTheDocument();
    });
  });

  it('reorders activities from the activities list', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Order',
          startDate: '2026-02-10',
          endDate: '2026-02-11',
          lengthDays: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [
        {
          id: 10,
          projectId: 1,
          name: 'First',
          color: '#1b5c4f',
          createdAt: '2026-01-02T00:00:00.000Z',
          sortOrder: 1
        },
        {
          id: 11,
          projectId: 1,
          name: 'Second',
          color: '#c05621',
          createdAt: '2026-01-03T00:00:00.000Z',
          sortOrder: 2
        }
      ],
      instances: []
    });

    render(<PlanningApp />);

    await screen.findByLabelText('First on 2026-02-10');
    fireEvent.click(screen.getAllByRole('button', { name: /move activity down/i })[0]);

    await waitFor(() => {
      const rows = screen.getAllByLabelText(/on 2026-02-10$/i);
      expect(rows[0]).toHaveAttribute('aria-label', 'Second on 2026-02-10');
      expect(rows[1]).toHaveAttribute('aria-label', 'First on 2026-02-10');
    });
  });

  it('removes an existing instance when clicking a filled selected cell', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Epsilon',
          startDate: '2026-02-10',
          endDate: '2026-02-10',
          lengthDays: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [
        {
          id: 10,
          projectId: 1,
          name: 'Deploy',
          color: '#1b5c4f',
          createdAt: '2026-01-02T00:00:00.000Z'
        }
      ],
      instances: [
        {
          id: 91,
          activityId: 10,
          day: '2026-02-10',
          createdAt: '2026-01-03T00:00:00.000Z'
        }
      ]
    });

    render(<PlanningApp />);

    const cell = await screen.findByLabelText('Deploy on 2026-02-10');
    expect(cell).toHaveTextContent('1/1');

    fireEvent.click(cell);

    await waitFor(() => {
      expect(screen.getByLabelText('Deploy on 2026-02-10')).toHaveTextContent('Add');
    });
  });

  it('shows chronological instance position as n/total', async () => {
    global.fetch = setupApiMock({
      projects: [
        {
          id: 1,
          name: 'Zeta',
          startDate: '2026-02-10',
          endDate: '2026-02-12',
          lengthDays: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      activities: [
        {
          id: 10,
          projectId: 1,
          name: 'Document',
          color: '#1b5c4f',
          createdAt: '2026-01-02T00:00:00.000Z'
        }
      ],
      instances: [
        {
          id: 91,
          activityId: 10,
          day: '2026-02-10',
          createdAt: '2026-01-03T00:00:00.000Z'
        }
      ]
    });

    render(<PlanningApp />);

    const firstCell = await screen.findByLabelText('Document on 2026-02-10');
    const secondCell = await screen.findByLabelText('Document on 2026-02-11');
    expect(firstCell).toHaveTextContent('1/1');

    fireEvent.click(secondCell);

    await waitFor(() => {
      expect(screen.getByLabelText('Document on 2026-02-10')).toHaveTextContent('1/2');
      expect(screen.getByLabelText('Document on 2026-02-11')).toHaveTextContent('2/2');
    });
  });
});
