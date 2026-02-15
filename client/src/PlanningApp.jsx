import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowDown,
  faArrowUp,
  faExpand,
  faGear,
  faPen,
  faPlus,
  faTrash,
  faXmark
} from '@fortawesome/free-solid-svg-icons';
import './PlanningApp.css';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_ZOOM_KEY = 'matthiance.scheduleZoom';
const SCHEDULE_ZOOM_OPTIONS = ['detailed', 'overview'];
const SCHEDULE_ZOOM_LAYOUT = {
  detailed: { dayWidth: 196, weekendFactor: 0.55 },
  overview: { dayWidth: 58, weekendFactor: 0.5 }
};

const inferApiBase = () => {
  const envBase = (import.meta?.env?.VITE_API_BASE || '').replace(/\/$/, '');
  if (envBase) {
    return envBase;
  }
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return 'http://127.0.0.1:3001';
  }
  return '';
};

const apiBase = inferApiBase();
const apiUrl = (path) => (apiBase ? `${apiBase}${path}` : path);

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

const addDaysToDateKey = (dateKey, amount) => {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return '';
  }
  const next = new Date(parsed.getTime());
  next.setUTCDate(next.getUTCDate() + amount);
  return toDateKey(next);
};

const diffDaysInclusive = (startDateKey, endDateKey) => {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  if (!start || !end) {
    return null;
  }
  const diff = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  return diff >= 1 ? diff : null;
};

const parseLengthDays = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
};

const formatDayHeader = (dateKey, mode = 'full') => {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return dateKey;
  }
  if (mode === 'compact') {
    return parsed.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    });
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
};

const formatDayTooltip = (dateKey) => {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return dateKey;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
};

const defaultProjectForm = () => ({
  name: '',
  startDate: '',
  endDate: '',
  lengthDays: ''
});

const defaultActivityForm = () => ({
  name: '',
  color: '#1b5c4f'
});

const applyDateDerivation = (draft, driver) => {
  const next = { ...draft };
  const start = parseDateKey(next.startDate);
  if (!start) {
    return next;
  }

  const end = parseDateKey(next.endDate);
  const length = parseLengthDays(next.lengthDays);

  if (end && end.getTime() < start.getTime()) {
    next.endDate = next.startDate;
    next.lengthDays = '1';
    return next;
  }

  if (driver === 'lengthDays') {
    if (length) {
      next.endDate = addDaysToDateKey(next.startDate, length - 1);
    } else if (end) {
      const derived = diffDaysInclusive(next.startDate, next.endDate);
      if (derived) {
        next.lengthDays = String(derived);
      }
    }
    return next;
  }

  if (end) {
    const derived = diffDaysInclusive(next.startDate, next.endDate);
    if (derived) {
      next.lengthDays = String(derived);
    }
  } else if (length) {
    next.endDate = addDaysToDateKey(next.startDate, length - 1);
  }
  return next;
};

const normalizeProjectPayload = (form, driver) => {
  const name = form.name.trim();
  if (!name) {
    return { error: 'Project name is required.' };
  }

  const startDate = form.startDate;
  if (!parseDateKey(startDate)) {
    return { error: 'Start date is required.' };
  }

  const normalized = applyDateDerivation(form, driver);
  const endDate = normalized.endDate;
  const lengthDays = parseLengthDays(normalized.lengthDays);

  if (!parseDateKey(endDate) || !lengthDays) {
    return { error: 'Provide a valid end date or length in days.' };
  }

  return {
    value: {
      name,
      startDate,
      endDate,
      lengthDays
    }
  };
};

const toProjectSummary = (project) =>
  `${project.startDate} - ${project.endDate} (${project.lengthDays} days)`;

const getErrorMessage = async (response, fallback) => {
  const payload = await response.json().catch(() => ({}));
  return payload?.error || fallback;
};

const isWeekend = (day) => day?.isWeekend || false;

const animateReorderedRows = (rowsMap, previousTopByIdRef) => {
  const nextTopById = new Map();
  rowsMap.forEach((element, id) => {
    nextTopById.set(id, element.getBoundingClientRect().top);
  });

  nextTopById.forEach((nextTop, id) => {
    const previousTop = previousTopByIdRef.current.get(id);
    if (typeof previousTop !== 'number') {
      return;
    }

    const deltaY = previousTop - nextTop;
    if (Math.abs(deltaY) < 0.5) {
      return;
    }

    const element = rowsMap.get(id);
    if (!element) {
      return;
    }

    element.style.transition = 'none';
    element.style.transform = `translateY(${deltaY}px)`;
    element.style.willChange = 'transform';

    window.requestAnimationFrame(() => {
      element.style.transition = 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)';
      element.style.transform = 'translateY(0)';
    });

    const cleanup = () => {
      element.style.transition = '';
      element.style.transform = '';
      element.style.willChange = '';
      element.removeEventListener('transitionend', cleanup);
    };
    element.addEventListener('transitionend', cleanup);
  });

  previousTopByIdRef.current = nextTopById;
};

export default function PlanningApp() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [board, setBoard] = useState(null);
  const [status, setStatus] = useState('');
  const [serverOk, setServerOk] = useState(true);

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [projectDriver, setProjectDriver] = useState('endDate');
  const [projectForm, setProjectForm] = useState(defaultProjectForm);

  const [showActivityModal, setShowActivityModal] = useState(false);
  const [isEditingActivity, setIsEditingActivity] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [activityForm, setActivityForm] = useState(defaultActivityForm);
  const [scheduleZoom, setScheduleZoom] = useState(() => {
    if (typeof window === 'undefined') {
      return 'overview';
    }
    const stored = localStorage.getItem(SCHEDULE_ZOOM_KEY);
    if (stored === 'ultra-compact') {
      return 'overview';
    }
    if (stored === 'comfortable') {
      return 'detailed';
    }
    if (stored === 'compact') {
      return 'overview';
    }
    return SCHEDULE_ZOOM_OPTIONS.includes(stored) ? stored : 'overview';
  });

  const [showSettings, setShowSettings] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [showScheduleFullscreen, setShowScheduleFullscreen] = useState(false);
  const activityListRowRefs = useRef(new Map());
  const scheduleRowRefs = useRef(new Map());
  const previousActivityListTopByIdRef = useRef(new Map());
  const previousScheduleTopByIdRef = useRef(new Map());

  const hasDesktopBridge = typeof window !== 'undefined' && window.electronAPI;

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const monthGroups = useMemo(() => {
    if (!board?.days?.length) {
      return [];
    }

    const groups = [];
    for (const day of board.days) {
      const parsed = parseDateKey(day.date);
      if (!parsed) {
        continue;
      }

      const year = parsed.getUTCFullYear();
      const month = parsed.getUTCMonth();
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      const label = parsed.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      });

      const previous = groups[groups.length - 1];
      if (!previous || previous.key !== key) {
        groups.push({ key, label, span: 1 });
      } else {
        previous.span += 1;
      }
    }

    return groups;
  }, [board]);
  const scheduleLayout = SCHEDULE_ZOOM_LAYOUT[scheduleZoom] || SCHEDULE_ZOOM_LAYOUT.overview;
  const useCompactHeaders = scheduleZoom === 'overview';
  const isDetailedZoom = scheduleZoom === 'detailed';

  const withApi = async (requestFn) => {
    try {
      const value = await requestFn();
      setServerOk(true);
      return value;
    } catch (error) {
      setServerOk(false);
      setStatus(error.message || 'Unable to reach local server.');
      return null;
    }
  };

  const loadProjects = async () => {
    const result = await withApi(async () => {
      const response = await fetch(apiUrl('/api/projects'));
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to load projects.'));
      }
      return response.json();
    });

    if (!result) {
      return;
    }

    setProjects(result);
    if (result.length === 0) {
      setSelectedProjectId(null);
      setBoard(null);
      return;
    }

    setSelectedProjectId((current) => {
      const exists = result.some((project) => project.id === current);
      return exists ? current : result[0].id;
    });
  };

  const loadBoard = async (projectId) => {
    if (!projectId) {
      setBoard(null);
      return;
    }

    const result = await withApi(async () => {
      const response = await fetch(apiUrl(`/api/projects/${projectId}/board`));
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to load project board.'));
      }
      return response.json();
    });

    if (!result) {
      return;
    }

    setBoard(result);
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    loadBoard(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    localStorage.setItem(SCHEDULE_ZOOM_KEY, scheduleZoom);
  }, [scheduleZoom]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const hasOpenModal =
      showProjectModal || showActivityModal || showSettings || showScheduleFullscreen;
    const previousOverflow = document.body.style.overflow;

    if (hasOpenModal) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showProjectModal, showActivityModal, showSettings, showScheduleFullscreen]);

  useEffect(() => {
    if (!showScheduleFullscreen) {
      return;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowScheduleFullscreen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showScheduleFullscreen]);

  useLayoutEffect(() => {
    const activityIds = board?.activities?.map((activity) => activity.id) || [];
    if (activityIds.length === 0) {
      previousActivityListTopByIdRef.current = new Map();
      previousScheduleTopByIdRef.current = new Map();
      return;
    }

    const activityListRows = new Map();
    const scheduleRows = new Map();
    for (const id of activityIds) {
      const activityListElement = activityListRowRefs.current.get(id);
      if (activityListElement) {
        activityListRows.set(id, activityListElement);
      }
      const scheduleElement = scheduleRowRefs.current.get(id);
      if (scheduleElement) {
        scheduleRows.set(id, scheduleElement);
      }
    }

    animateReorderedRows(activityListRows, previousActivityListTopByIdRef);
    animateReorderedRows(scheduleRows, previousScheduleTopByIdRef);
  }, [board?.activities]);

  const bindActivityListRowRef = (activityId) => (element) => {
    if (element) {
      activityListRowRefs.current.set(activityId, element);
      return;
    }
    activityListRowRefs.current.delete(activityId);
  };

  const bindScheduleRowRef = (activityId) => (element) => {
    if (element) {
      scheduleRowRefs.current.set(activityId, element);
      return;
    }
    scheduleRowRefs.current.delete(activityId);
  };

  const openCreateProjectModal = () => {
    setIsEditingProject(false);
    setProjectForm(defaultProjectForm());
    setProjectDriver('endDate');
    setShowProjectModal(true);
  };

  const openEditProjectModal = () => {
    if (!selectedProject) {
      return;
    }
    setIsEditingProject(true);
    setProjectDriver('endDate');
    setProjectForm({
      name: selectedProject.name,
      startDate: selectedProject.startDate,
      endDate: selectedProject.endDate,
      lengthDays: String(selectedProject.lengthDays)
    });
    setShowProjectModal(true);
  };

  const handleProjectFieldChange = (field, value) => {
    let nextDriver = projectDriver;
    if (field === 'endDate') {
      nextDriver = 'endDate';
    } else if (field === 'lengthDays') {
      nextDriver = 'lengthDays';
    }

    setProjectDriver(nextDriver);
    setProjectForm((current) => {
      let nextValue = value;
      if (
        field === 'endDate' &&
        current.startDate &&
        parseDateKey(value) &&
        value < current.startDate
      ) {
        nextValue = current.startDate;
      }
      const updated = { ...current, [field]: nextValue };
      return applyDateDerivation(updated, nextDriver);
    });
  };

  const handleProjectSubmit = async (event) => {
    event.preventDefault();

    const normalized = normalizeProjectPayload(projectForm, projectDriver);
    if (!normalized.value) {
      setStatus(normalized.error);
      return;
    }

    const endpoint = isEditingProject
      ? `/api/projects/${selectedProjectId}`
      : '/api/projects';
    const method = isEditingProject ? 'PUT' : 'POST';

    const createdOrUpdated = await withApi(async () => {
      const response = await fetch(apiUrl(endpoint), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized.value)
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to save project.'));
      }
      return response.json();
    });

    if (!createdOrUpdated) {
      return;
    }

    setShowProjectModal(false);
    setStatus(isEditingProject ? 'Project updated.' : 'Project created.');
    await loadProjects();
    setSelectedProjectId(createdOrUpdated.id);
    await loadBoard(createdOrUpdated.id);
  };

  const handleDeleteProject = async () => {
    if (!selectedProjectId || !selectedProject) {
      return;
    }

    const ok = window.confirm(
      `Delete project \"${selectedProject.name}\" and all related activities and instances?`
    );
    if (!ok) {
      return;
    }

    const deleted = await withApi(async () => {
      const response = await fetch(apiUrl(`/api/projects/${selectedProjectId}`), {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to delete project.'));
      }
      return response.json();
    });

    if (!deleted) {
      return;
    }

    setStatus(
      `Project deleted (${deleted.deletedActivities} activities, ${deleted.deletedInstances} instances).`
    );
    await loadProjects();
  };

  const closeActivityModal = () => {
    setShowActivityModal(false);
    setIsEditingActivity(false);
    setEditingActivityId(null);
  };

  const openCreateActivityModal = () => {
    if (!selectedProjectId) {
      setStatus('Select or create a project first.');
      return;
    }

    setIsEditingActivity(false);
    setEditingActivityId(null);
    setActivityForm(defaultActivityForm());
    setShowActivityModal(true);
  };

  const openEditActivityModal = (activity) => {
    if (!activity) {
      return;
    }

    setIsEditingActivity(true);
    setEditingActivityId(activity.id);
    setActivityForm({
      name: activity.name,
      color: activity.color
    });
    setShowActivityModal(true);
  };

  const handleActivitySubmit = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) {
      setStatus('Select or create a project first.');
      return;
    }

    const name = activityForm.name.trim();
    if (!name) {
      setStatus('Activity name is required.');
      return;
    }

    if (isEditingActivity && !editingActivityId) {
      setStatus('No activity selected for editing.');
      return;
    }

    const endpoint = isEditingActivity
      ? `/api/projects/${selectedProjectId}/activities/${editingActivityId}`
      : `/api/projects/${selectedProjectId}/activities`;
    const method = isEditingActivity ? 'PUT' : 'POST';

    const saved = await withApi(async () => {
      const response = await fetch(apiUrl(endpoint), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          color: activityForm.color
        })
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to save activity.'));
      }
      return response.json();
    });

    if (!saved) {
      return;
    }

    closeActivityModal();
    setActivityForm(defaultActivityForm());
    setStatus(isEditingActivity ? 'Activity updated.' : 'Activity added.');
    await loadBoard(selectedProjectId);
  };

  const handleDeleteActivity = async (activity) => {
    if (!selectedProjectId) {
      return;
    }

    const ok = window.confirm(
      `Delete activity \"${activity.name}\" and all of its instances?`
    );
    if (!ok) {
      return;
    }

    const deleted = await withApi(async () => {
      const response = await fetch(
        apiUrl(`/api/projects/${selectedProjectId}/activities/${activity.id}`),
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to delete activity.'));
      }
      return response.json();
    });

    if (!deleted) {
      return;
    }

    setStatus(`Activity deleted (${deleted.deletedInstances} instances removed).`);
    await loadBoard(selectedProjectId);
  };

  const handleMoveActivity = async (activityId, direction) => {
    if (!selectedProjectId) {
      return;
    }

    const moved = await withApi(async () => {
      const response = await fetch(
        apiUrl(`/api/projects/${selectedProjectId}/activities/${activityId}/reorder`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction })
        }
      );
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to reorder activity.'));
      }
      return response.json();
    });

    if (!moved) {
      return;
    }

    if (!moved.moved) {
      setStatus(direction === 'up' ? 'Activity is already at the top.' : 'Activity is already at the bottom.');
      return;
    }

    await loadBoard(selectedProjectId);
  };

  const handleCellClick = async (activityId, day, filled) => {
    if (!selectedProjectId) {
      return;
    }

    if (!filled) {
      const created = await withApi(async () => {
        const response = await fetch(
          apiUrl(`/api/projects/${selectedProjectId}/activities/${activityId}/instances`),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: day })
          }
        );
        if (!response.ok) {
          throw new Error(await getErrorMessage(response, 'Unable to assign activity.'));
        }
        return response.json();
      });

      if (!created) {
        return;
      }

      setStatus('Activity assigned.');
      await loadBoard(selectedProjectId);
      return;
    }

    const deleted = await withApi(async () => {
      const response = await fetch(
        apiUrl(
          `/api/projects/${selectedProjectId}/activities/${activityId}/instances/${encodeURIComponent(day)}`
        ),
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to delete activity instance.'));
      }
      return response.json();
    });

    if (!deleted) {
      return;
    }

    setStatus('Activity instance removed.');
    await loadBoard(selectedProjectId);
  };

  const handleOpenDataFolder = async () => {
    if (!hasDesktopBridge) {
      setSettingsStatus('Desktop tools are available in Electron only.');
      return;
    }

    setSettingsStatus('Opening data folder...');
    const result = await window.electronAPI.openUserData();
    if (!result?.ok) {
      setSettingsStatus(result?.error || 'Unable to open data folder.');
      return;
    }
    setSettingsStatus('Data folder opened.');
  };

  const handleExportBackup = async () => {
    if (!hasDesktopBridge) {
      setSettingsStatus('Desktop tools are available in Electron only.');
      return;
    }

    setSettingsStatus('Preparing backup...');
    const result = await window.electronAPI.exportBackup();
    if (!result?.ok) {
      setSettingsStatus(result?.error || 'Backup failed.');
      return;
    }
    setSettingsStatus('Backup exported.');
  };

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-text">
          <p className="eyebrow">Project planning, local-first.</p>
          <h1>Matthiance</h1>
          <p className="subhead">
            Build project timelines, define activities, and assign daily activity instances directly
            in the planning grid.
          </p>
        </div>
        <div className="status-card">
          <div className="status-header">
            <p className="status-label">Status</p>
            <span className={`status-badge ${serverOk ? 'ok' : 'down'}`}>
              {serverOk ? 'Server online' : 'Server offline'}
            </span>
          </div>
          <p className="status-meta">
            {selectedProject ? `Selected: ${selectedProject.name}` : 'No project selected'}
          </p>
          <div className="status-actions">
            <button
              type="button"
              className="ghost with-icon"
              onClick={() => setShowSettings(true)}
            >
              <FontAwesomeIcon icon={faGear} className="icon" aria-hidden="true" />
              Settings
            </button>
          </div>
          {status && <p className="status">{status}</p>}
        </div>
      </header>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>Projects</h2>
            <p className="card-subtitle">Create, edit, and switch between planning projects.</p>
          </div>
          <div className="projects-actions">
            <button type="button" className="primary with-icon" onClick={openCreateProjectModal}>
              <FontAwesomeIcon icon={faPlus} className="icon" aria-hidden="true" />
              New project
            </button>
            <button type="button" className="ghost with-icon" onClick={openEditProjectModal}>
              <FontAwesomeIcon icon={faPen} className="icon" aria-hidden="true" />
              Edit project
            </button>
            <button type="button" className="ghost with-icon" onClick={handleDeleteProject}>
              <FontAwesomeIcon icon={faTrash} className="icon" aria-hidden="true" />
              Delete project
            </button>
          </div>
        </div>
        {projects.length === 0 ? (
          <p className="empty-state">No projects yet. Create your first project to start planning.</p>
        ) : (
          <div className="project-list">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`project-item ${selectedProjectId === project.id ? 'is-selected' : ''}`}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <span className="project-item-name">{project.name}</span>
                <span className="project-item-meta">{toProjectSummary(project)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>Schedule</h2>
            <p className="card-subtitle">
              Click cells to add one-day activity instances. Click assigned cells to remove them.
            </p>
          </div>
          <div className="schedule-header-actions">
            <div className="zoom-toggle" role="group" aria-label="Schedule zoom level">
              {SCHEDULE_ZOOM_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`zoom-option ${scheduleZoom === option ? 'is-active' : ''}`}
                  onClick={() => setScheduleZoom(option)}
                >
                  {option === 'detailed' ? 'Detailed' : 'Overview'}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ghost with-icon"
              onClick={() => setShowScheduleFullscreen(true)}
              aria-label="Open full screen schedule"
              title="Open full screen schedule"
            >
              <FontAwesomeIcon icon={faExpand} className="icon" aria-hidden="true" />
              Full screen
            </button>
          </div>
        </div>
        {!board?.project ? (
          <p className="empty-state">Select a project to view its timeline.</p>
        ) : (
          <div
            className="schedule-scroll"
            style={{
              '--day-col-width': `${scheduleLayout.dayWidth}px`,
              '--weekend-width-factor': scheduleLayout.weekendFactor
            }}
          >
            <table className="schedule-grid">
              <colgroup>
                <col className="activity-column-col" />
                {board.days.map((day) => (
                  <col
                    key={`col-${day.date}`}
                    className={`day-column-col ${isWeekend(day) ? 'is-weekend-col' : ''}`}
                  />
                ))}
              </colgroup>
              <thead>
                <tr className="month-row">
                  <th className="activity-column" rowSpan={2}>
                    Activity
                  </th>
                  {monthGroups.map((group) => (
                    <th key={group.key} className="month-group" colSpan={group.span}>
                      <span className="month-label">{group.label}</span>
                    </th>
                  ))}
                </tr>
                <tr className="day-row">
                  {board.days.map((day) => (
                    <th
                      key={day.date}
                      className={isWeekend(day) ? 'is-weekend' : ''}
                      title={formatDayTooltip(day.date)}
                    >
                      {formatDayHeader(day.date, useCompactHeaders ? 'compact' : 'full')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.activities.length === 0 && (
                  <tr>
                    <th>
                      <span className="activity-label activity-label-muted">Unassigned</span>
                    </th>
                    {board.days.map((day) => (
                      <td key={`unassigned-${day.date}`} className={isWeekend(day) ? 'is-weekend' : ''}>
                        <span className="unassigned-cell" />
                      </td>
                    ))}
                  </tr>
                )}
                {board.activities.map((activity) => {
                  const map = board.instanceMap?.[String(activity.id)] || {};
                  const assignedDays = Object.keys(map).sort((left, right) =>
                    left.localeCompare(right)
                  );
                  const totalAssigned = assignedDays.length;
                  const positionByDay = assignedDays.reduce((acc, date, index) => {
                    acc[date] = index + 1;
                    return acc;
                  }, {});
                  return (
                    <tr key={activity.id} ref={bindScheduleRowRef(activity.id)}>
                      <th>
                        <span className="activity-label">
                          <span className="activity-color" style={{ backgroundColor: activity.color }} />
                          <span>{activity.name}</span>
                        </span>
                      </th>
                      {board.days.map((day) => {
                        const filled = Boolean(map[day.date]);
                        const position = filled ? positionByDay[day.date] : null;
                        return (
                          <td key={`${activity.id}-${day.date}`} className={isWeekend(day) ? 'is-weekend' : ''}>
                            <button
                              type="button"
                              className={`instance-cell ${filled ? 'is-filled' : 'is-empty'} ${isDetailedZoom ? 'is-detailed' : ''}`}
                              style={filled ? { '--cell-color': activity.color } : undefined}
                              onClick={() => handleCellClick(activity.id, day.date, filled)}
                              aria-label={`${activity.name} on ${day.date}`}
                            >
                              {filled ? (
                                isDetailedZoom ? (
                                  <>
                                    <span className="instance-cell-name">{activity.name}</span>
                                    <span className="instance-cell-ratio">
                                      {position}/{totalAssigned}
                                    </span>
                                  </>
                                ) : (
                                  `${position}/${totalAssigned}`
                                )
                              ) : (
                                'Add'
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>Activities</h2>
            <p className="card-subtitle">
              Manage colored activities for this project. Deleting an activity removes all its
              instances.
            </p>
          </div>
          <div className="projects-actions">
            <button
              type="button"
              className="primary with-icon"
              onClick={openCreateActivityModal}
              disabled={!selectedProjectId}
            >
              <FontAwesomeIcon icon={faPlus} className="icon" aria-hidden="true" />
              New activity
            </button>
            <span className="count">{board?.activities?.length || 0} total</span>
          </div>
        </div>
        {board?.activities?.length ? (
          <ul className="activity-list">
            {board.activities.map((activity, index) => (
              <li key={activity.id} ref={bindActivityListRowRef(activity.id)}>
                <span className="activity-label">
                  <span className="activity-color" style={{ backgroundColor: activity.color }} />
                  <span>{activity.name}</span>
                </span>
                <div className="activity-actions">
                  <button
                    type="button"
                    className="ghost with-icon event-action icon-only-action"
                    onClick={() => handleMoveActivity(activity.id, 'up')}
                    disabled={index === 0}
                    aria-label="Move activity up"
                    title="Move activity up"
                  >
                    <FontAwesomeIcon icon={faArrowUp} className="icon" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ghost with-icon event-action icon-only-action"
                    onClick={() => handleMoveActivity(activity.id, 'down')}
                    disabled={index === board.activities.length - 1}
                    aria-label="Move activity down"
                    title="Move activity down"
                  >
                    <FontAwesomeIcon icon={faArrowDown} className="icon" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ghost with-icon event-action icon-only-action"
                    onClick={() => openEditActivityModal(activity)}
                    aria-label="Edit activity"
                    title="Edit activity"
                  >
                    <FontAwesomeIcon icon={faPen} className="icon" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ghost with-icon event-action icon-only-action"
                    onClick={() => handleDeleteActivity(activity)}
                    aria-label="Delete activity"
                    title="Delete activity"
                  >
                    <FontAwesomeIcon icon={faTrash} className="icon" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No activities yet for this project.</p>
        )}
      </section>

      {showProjectModal && (
        <div className="modal-backdrop" onClick={() => setShowProjectModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>{isEditingProject ? 'Edit project' : 'Create project'}</h2>
                <p className="card-subtitle">
                  Set start and end date or start and length. The third value is derived.
                </p>
              </div>
              <button
                type="button"
                className="ghost with-icon"
                onClick={() => setShowProjectModal(false)}
              >
                <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
              </button>
            </div>
            <form className="project-form" onSubmit={handleProjectSubmit}>
              <label>
                Project name
                <input
                  value={projectForm.name}
                  onChange={(event) => handleProjectFieldChange('name', event.target.value)}
                  required
                />
              </label>
              <label>
                Start date
                <input
                  type="date"
                  value={projectForm.startDate}
                  onChange={(event) => handleProjectFieldChange('startDate', event.target.value)}
                  required
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  value={projectForm.endDate}
                  min={projectForm.startDate || undefined}
                  onChange={(event) => handleProjectFieldChange('endDate', event.target.value)}
                />
              </label>
              <label>
                Length (days)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={projectForm.lengthDays}
                  onChange={(event) => handleProjectFieldChange('lengthDays', event.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="ghost" onClick={() => setShowProjectModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary with-icon">
                  <FontAwesomeIcon
                    icon={isEditingProject ? faPen : faPlus}
                    className="icon"
                    aria-hidden="true"
                  />
                  {isEditingProject ? 'Save project' : 'Create project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showScheduleFullscreen && (
        <div className="modal-backdrop schedule-fullscreen-backdrop" onClick={() => setShowScheduleFullscreen(false)}>
          <div className="schedule-fullscreen-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Schedule</h2>
                {/* <p className="card-subtitle">
                  {selectedProject
                    ? `${selectedProject.name} · ${board?.days?.length || 0} days`
                  : 'Project timeline'}
                </p> */}
              </div>
              <div className="projects-actions">
                <div className="zoom-toggle" role="group" aria-label="Schedule zoom level">
                  {SCHEDULE_ZOOM_OPTIONS.map((option) => (
                    <button
                      key={`fullscreen-zoom-${option}`}
                      type="button"
                      className={`zoom-option ${scheduleZoom === option ? 'is-active' : ''}`}
                      onClick={() => setScheduleZoom(option)}
                    >
                      {option === 'detailed' ? 'Detailed' : 'Overview'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="ghost with-icon"
                  onClick={() => setShowScheduleFullscreen(false)}
                  aria-label="Close fullscreen schedule"
                >
                  <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
                </button>
              </div>
            </div>
            {!board?.project ? (
              <p className="empty-state">Select a project to view its timeline.</p>
            ) : (
              <div
                className="schedule-scroll fullscreen"
                style={{
                  '--day-col-width': `${scheduleLayout.dayWidth}px`,
                  '--weekend-width-factor': scheduleLayout.weekendFactor
                }}
              >
                <table className="schedule-grid">
                  <colgroup>
                    <col className="activity-column-col" />
                    {board.days.map((day) => (
                      <col
                        key={`fullscreen-col-${day.date}`}
                        className={`day-column-col ${isWeekend(day) ? 'is-weekend-col' : ''}`}
                      />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="month-row">
                      <th className="activity-column" rowSpan={2}>
                        Activity
                      </th>
                      {monthGroups.map((group) => (
                        <th key={`fullscreen-${group.key}`} className="month-group" colSpan={group.span}>
                          <span className="month-label">{group.label}</span>
                        </th>
                      ))}
                    </tr>
                    <tr className="day-row">
                      {board.days.map((day) => (
                        <th
                          key={`fullscreen-${day.date}`}
                          className={isWeekend(day) ? 'is-weekend' : ''}
                          title={formatDayTooltip(day.date)}
                        >
                          {formatDayHeader(day.date, useCompactHeaders ? 'compact' : 'full')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {board.activities.length === 0 && (
                      <tr>
                        <th>
                          <span className="activity-label activity-label-muted">Unassigned</span>
                        </th>
                        {board.days.map((day) => (
                          <td key={`fullscreen-unassigned-${day.date}`} className={isWeekend(day) ? 'is-weekend' : ''}>
                            <span className="unassigned-cell" />
                          </td>
                        ))}
                      </tr>
                    )}
                    {board.activities.map((activity) => {
                      const map = board.instanceMap?.[String(activity.id)] || {};
                      const assignedDays = Object.keys(map).sort((left, right) =>
                        left.localeCompare(right)
                      );
                      const totalAssigned = assignedDays.length;
                      const positionByDay = assignedDays.reduce((acc, date, index) => {
                        acc[date] = index + 1;
                        return acc;
                      }, {});

                      return (
                        <tr key={`fullscreen-${activity.id}`}>
                          <th>
                            <span className="activity-label">
                              <span className="activity-color" style={{ backgroundColor: activity.color }} />
                              <span>{activity.name}</span>
                            </span>
                          </th>
                          {board.days.map((day) => {
                            const filled = Boolean(map[day.date]);
                            const position = filled ? positionByDay[day.date] : null;
                            return (
                              <td
                                key={`fullscreen-${activity.id}-${day.date}`}
                                className={isWeekend(day) ? 'is-weekend' : ''}
                              >
                                <button
                                  type="button"
                                  className={`instance-cell ${filled ? 'is-filled' : 'is-empty'} ${isDetailedZoom ? 'is-detailed' : ''}`}
                                  style={filled ? { '--cell-color': activity.color } : undefined}
                                  onClick={() => handleCellClick(activity.id, day.date, filled)}
                                  aria-label={`${activity.name} on ${day.date}`}
                                >
                                  {filled ? (
                                    isDetailedZoom ? (
                                      <>
                                        <span className="instance-cell-name">{activity.name}</span>
                                        <span className="instance-cell-ratio">
                                          {position}/{totalAssigned}
                                        </span>
                                      </>
                                    ) : (
                                      `${position}/${totalAssigned}`
                                    )
                                  ) : (
                                    'Add'
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showActivityModal && (
        <div className="modal-backdrop" onClick={closeActivityModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>{isEditingActivity ? 'Edit activity' : 'Create activity'}</h2>
                <p className="card-subtitle">
                  Set a unique activity name and color for the selected project.
                </p>
              </div>
              <button type="button" className="ghost with-icon" onClick={closeActivityModal}>
                <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
              </button>
            </div>
            <form className="project-form" onSubmit={handleActivitySubmit}>
              <label>
                Activity name
                <input
                  value={activityForm.name}
                  onChange={(event) =>
                    setActivityForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Design, Build, Review..."
                  required
                />
              </label>
              <label>
                Color
                <input
                  type="color"
                  value={activityForm.color}
                  onChange={(event) =>
                    setActivityForm((current) => ({ ...current, color: event.target.value }))
                  }
                  required
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="ghost" onClick={closeActivityModal}>
                  Cancel
                </button>
                <button type="submit" className="primary with-icon">
                  <FontAwesomeIcon
                    icon={isEditingActivity ? faPen : faPlus}
                    className="icon"
                    aria-hidden="true"
                  />
                  {isEditingActivity ? 'Save activity' : 'Create activity'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="settings-popover" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Desktop tools</h2>
                <p className="card-subtitle">Open local data folder and export a backup.</p>
              </div>
              <button type="button" className="ghost with-icon" onClick={() => setShowSettings(false)}>
                <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
              </button>
            </div>
            <div className="settings-actions">
              <button type="button" className="ghost" onClick={handleOpenDataFolder}>
                Open data folder
              </button>
              <button type="button" className="primary" onClick={handleExportBackup}>
                Export backup
              </button>
            </div>
            {settingsStatus && <p className="settings-status">{settingsStatus}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
