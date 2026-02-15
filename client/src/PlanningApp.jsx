import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faExpand,
  faFileExcel,
  faGear,
  faPen,
  faPlus,
  faTrash
} from '@fortawesome/free-solid-svg-icons';
import './PlanningApp.css';
import ScheduleGrid from './planning/ScheduleGrid.jsx';
import ProjectModal from './planning/modals/ProjectModal.jsx';
import ActivityModal from './planning/modals/ActivityModal.jsx';
import ExportModal from './planning/modals/ExportModal.jsx';
import SettingsModal from './planning/modals/SettingsModal.jsx';
import ScheduleFullscreenModal from './planning/modals/ScheduleFullscreenModal.jsx';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_ZOOM_KEY = 'matthiance.scheduleZoom.v2';
const SCHEDULE_ZOOM_OPTIONS = ['detailed', 'standard', 'overview'];
const SCHEDULE_ZOOM_LAYOUT = {
  detailed: { dayWidth: 196, weekendFactor: 0.55 },
  standard: { dayWidth: 58, weekendFactor: 0.5 },
  overview: { dayWidth: 36, weekendFactor: 0.46 }
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
  if (mode === 'day-only') {
    return parsed.toLocaleDateString(undefined, {
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
const exportSelectionStorageKey = (projectId) => `matthiance.export.deselected.${projectId}`;

const sanitizeFilePart = (value) =>
  String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);

const normalizeHexColor = (value, fallback = '1B5C4F') => {
  const raw = String(value || '')
    .trim()
    .replace(/^#/, '');
  const normalized =
    raw.length === 3
      ? raw
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : raw;
  return /^[0-9A-Fa-f]{6}$/.test(normalized) ? normalized.toUpperCase() : fallback;
};

const channelToLinear = (channel) => {
  const normalized = channel / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
};

const getExcelContrastTextArgb = (hexColor) => {
  const normalized = normalizeHexColor(hexColor);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance =
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue);
  return luminance < 0.45 ? 'FFFFFFFF' : 'FF1F1A14';
};

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
      return 'standard';
    }
    const storedV2 = localStorage.getItem(SCHEDULE_ZOOM_KEY);
    if (SCHEDULE_ZOOM_OPTIONS.includes(storedV2)) {
      return storedV2;
    }
    return 'standard';
  });

  const [showSettings, setShowSettings] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [showScheduleFullscreen, setShowScheduleFullscreen] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportDeselectedActivityIds, setExportDeselectedActivityIds] = useState([]);
  const scheduleRowRefs = useRef(new Map());
  const fullscreenScheduleRowRefs = useRef(new Map());
  const previousScheduleTopByIdRef = useRef(new Map());
  const previousFullscreenScheduleTopByIdRef = useRef(new Map());

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
  const scheduleLayout = SCHEDULE_ZOOM_LAYOUT[scheduleZoom] || SCHEDULE_ZOOM_LAYOUT.standard;
  const isDetailedZoom = scheduleZoom === 'detailed';
  const isOverviewZoom = scheduleZoom === 'overview';
  const dayHeaderMode = isDetailedZoom ? 'full' : isOverviewZoom ? 'day-only' : 'compact';
  const fullscreenDayWidth = isOverviewZoom ? 24 : scheduleLayout.dayWidth;

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
      showProjectModal || showActivityModal || showSettings || showScheduleFullscreen || showExportModal;
    const previousOverflow = document.body.style.overflow;

    if (hasOpenModal) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showProjectModal, showActivityModal, showSettings, showScheduleFullscreen, showExportModal]);

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
      previousScheduleTopByIdRef.current = new Map();
      previousFullscreenScheduleTopByIdRef.current = new Map();
      return;
    }

    const scheduleRows = new Map();
    const fullscreenScheduleRows = new Map();
    for (const id of activityIds) {
      const scheduleElement = scheduleRowRefs.current.get(id);
      if (scheduleElement) {
        scheduleRows.set(id, scheduleElement);
      }
      const fullscreenScheduleElement = fullscreenScheduleRowRefs.current.get(id);
      if (fullscreenScheduleElement) {
        fullscreenScheduleRows.set(id, fullscreenScheduleElement);
      }
    }

    animateReorderedRows(scheduleRows, previousScheduleTopByIdRef);
    animateReorderedRows(fullscreenScheduleRows, previousFullscreenScheduleTopByIdRef);
  }, [board?.activities]);

  const bindScheduleRowRef = (activityId) => (element) => {
    if (element) {
      scheduleRowRefs.current.set(activityId, element);
      return;
    }
    scheduleRowRefs.current.delete(activityId);
  };

  const bindFullscreenScheduleRowRef = (activityId) => (element) => {
    if (element) {
      fullscreenScheduleRowRefs.current.set(activityId, element);
      return;
    }
    fullscreenScheduleRowRefs.current.delete(activityId);
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

    const submitProject = async (confirmTrimOutOfRangeInstances = false) =>
      withApi(async () => {
        const payload =
          method === 'PUT'
            ? { ...normalized.value, confirmTrimOutOfRangeInstances }
            : normalized.value;
        const response = await fetch(apiUrl(endpoint), {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 409 && body?.code === 'PROJECT_RANGE_PRUNE_REQUIRED') {
            return {
              requiresTrimConfirmation: true,
              outOfRangeInstances: body.outOfRangeInstances || 0
            };
          }
          throw new Error(body?.error || 'Unable to save project.');
        }
        return { project: body };
      });

    let saveResult = await submitProject(false);
    if (!saveResult) {
      return;
    }

    if (saveResult.requiresTrimConfirmation) {
      const count = saveResult.outOfRangeInstances || 0;
      const instanceLabel = count === 1 ? 'instance' : 'instances';
      const confirmTrim = window.confirm(
        `Shortening or shifting this project will remove ${count} activity ${instanceLabel} outside the new date range. Continue?`
      );
      if (!confirmTrim) {
        setStatus('Project update canceled.');
        return;
      }

      saveResult = await submitProject(true);
      if (!saveResult || saveResult.requiresTrimConfirmation) {
        return;
      }
    }

    const createdOrUpdated = saveResult.project;
    if (!createdOrUpdated) {
      return;
    }

    setShowProjectModal(false);
    if (isEditingProject && (createdOrUpdated.prunedInstances || 0) > 0) {
      const count = createdOrUpdated.prunedInstances;
      const instanceLabel = count === 1 ? 'instance' : 'instances';
      setStatus(`Project updated. Removed ${count} out-of-range ${instanceLabel}.`);
    } else {
      setStatus(isEditingProject ? 'Project updated.' : 'Project created.');
    }
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

  const getCurrentExportDeselected = (projectId, activities) => {
    if (typeof window === 'undefined' || !projectId) {
      return [];
    }
    const key = exportSelectionStorageKey(projectId);
    const storedRaw = localStorage.getItem(key);
    if (!storedRaw) {
      return [];
    }
    const knownIds = new Set(activities.map((activity) => activity.id));
    const parsed = JSON.parse(storedRaw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && knownIds.has(value));
  };

  const persistExportDeselected = (projectId, deselectedIds) => {
    if (typeof window === 'undefined' || !projectId) {
      return;
    }
    localStorage.setItem(exportSelectionStorageKey(projectId), JSON.stringify(deselectedIds));
  };

  const openExportModal = () => {
    if (!selectedProjectId || !board?.activities) {
      return;
    }
    setExportDeselectedActivityIds(getCurrentExportDeselected(selectedProjectId, board.activities));
    setShowExportModal(true);
  };

  const toggleExportActivity = (activityId, checked) => {
    if (!selectedProjectId) {
      return;
    }
    setExportDeselectedActivityIds((current) => {
      const set = new Set(current);
      if (checked) {
        set.delete(activityId);
      } else {
        set.add(activityId);
      }
      const next = [...set];
      persistExportDeselected(selectedProjectId, next);
      return next;
    });
  };

  const handleExportSchedule = async () => {
    if (!board?.project) {
      return;
    }

    const selectedActivities = board.activities.filter(
      (activity) => !exportDeselectedActivityIds.includes(activity.id)
    );
    if (selectedActivities.length === 0) {
      setStatus('Select at least one activity to export.');
      return;
    }

    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const infoSheet = workbook.addWorksheet('Project Info');
      const worksheet = workbook.addWorksheet('Schedule');

      infoSheet.getColumn(1).width = 18;
      infoSheet.getColumn(2).width = 42;
      const infoRows = [
        ['Project name', board.project.name],
        ['Start date', board.project.startDate],
        ['End date', board.project.endDate],
        ['Length (days)', String(board.project.lengthDays)]
      ];
      infoRows.forEach(([label, value], index) => {
        const row = infoSheet.getRow(index + 1);
        row.getCell(1).value = label;
        row.getCell(1).font = { bold: true };
        row.getCell(2).value = value;
      });

      const firstColumnWidth = Math.max(18, Math.round((scheduleLayout.dayWidth || 120) / 8) + 10);
      const dayColumnWidth = Math.max(4, Math.round((scheduleLayout.dayWidth || 120) / 8));
      worksheet.getColumn(1).width = firstColumnWidth;
      for (let index = 0; index < board.days.length; index += 1) {
        worksheet.getColumn(index + 2).width = dayColumnWidth;
      }

      const headerRow1 = worksheet.getRow(1);
      const headerRow2 = worksheet.getRow(2);
      headerRow1.getCell(1).value = 'Activity';
      worksheet.mergeCells(1, 1, 2, 1);

      let cursor = 0;
      while (cursor < board.days.length) {
        const day = board.days[cursor];
        const monthLabel = parseDateKey(day.date)?.toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC'
        });
        let end = cursor;
        while (
          end + 1 < board.days.length &&
          parseDateKey(board.days[end + 1].date)?.getUTCMonth() === parseDateKey(day.date)?.getUTCMonth() &&
          parseDateKey(board.days[end + 1].date)?.getUTCFullYear() ===
            parseDateKey(day.date)?.getUTCFullYear()
        ) {
          end += 1;
        }
        const startCol = cursor + 2;
        const endCol = end + 2;
        headerRow1.getCell(startCol).value = monthLabel || '';
        if (endCol > startCol) {
          worksheet.mergeCells(1, startCol, 1, endCol);
        }
        cursor = end + 1;
      }

      board.days.forEach((day, index) => {
        headerRow2.getCell(index + 2).value = formatDayHeader(day.date, dayHeaderMode);
      });

      const headerFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF6E7D4' }
      };
      const weekendFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF6EDE1' }
      };
      const border = {
        top: { style: 'thin', color: { argb: 'e1e1e1' } },
        left: { style: 'thin', color: { argb: 'e1e1e1' } },
        bottom: { style: 'thin', color: { argb: 'e1e1e1' } },
        right: { style: 'thin', color: { argb: 'e1e1e1' } }
      };

      for (let rowIndex = 1; rowIndex <= 2; rowIndex += 1) {
        const row = worksheet.getRow(rowIndex);
        for (let col = 1; col <= board.days.length + 1; col += 1) {
          const cell = row.getCell(col);
          cell.fill = headerFill;
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.font = { bold: true };
        }
      }

      selectedActivities.forEach((activity, activityIndex) => {
        const rowNumber = 3 + activityIndex;
        const row = worksheet.getRow(rowNumber);
        row.getCell(1).value = activity.name;
        row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

        const map = board.instanceMap?.[String(activity.id)] || {};
        const assignedDays = Object.keys(map).sort((left, right) => left.localeCompare(right));
        const totalAssigned = assignedDays.length;
        const positionByDay = assignedDays.reduce((acc, date, index) => {
          acc[date] = index + 1;
          return acc;
        }, {});
        const activityColor = normalizeHexColor(activity.color, '1B5C4F');
        const fillColor = `FF${activityColor}`;
        const textColor = getExcelContrastTextArgb(activityColor);

        board.days.forEach((day, dayIndex) => {
          const col = dayIndex + 2;
          const cell = row.getCell(col);
          const filled = Boolean(map[day.date]);

          if (filled) {
            const position = positionByDay[day.date];
            cell.value = isOverviewZoom
              ? ''
              : isDetailedZoom
                ? `${activity.name} ${position}/${totalAssigned}`
                : `${position}/${totalAssigned}`;
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: fillColor }
            };
            cell.font = { bold: false, color: { argb: textColor } };
          } else if (isWeekend(day)) {
            cell.fill = weekendFill;
            cell.border = border;
          }
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: isDetailedZoom };
        });
      });

      worksheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const now = new Date().toISOString().slice(0, 10);
      const projectName = sanitizeFilePart(board.project.name) || 'project';
      const filename = `${projectName}-schedule-${now}.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
      setStatus(`Exported ${filename}`);
    } catch (error) {
      setStatus(error?.message || 'Unable to export schedule.');
    }
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
          <p className="eyebrow">His plan leads the way.</p>
          <h1>Matthiance</h1>
          <p className="subhead">
            Build project timelines, define activities, and export schedules to Excel.
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
          </div>
          <div className="projects-actions">
            <button type="button" className="primary with-icon" onClick={openCreateProjectModal}>
              <FontAwesomeIcon icon={faPlus} className="icon" aria-hidden="true" />
              New project
            </button>
            <span
              className="button-tooltip-wrap"
              title={!selectedProject ? 'Select a project first.' : 'Edit selected project'}
            >
              <button
                type="button"
                className="ghost with-icon"
                onClick={openEditProjectModal}
                disabled={!selectedProject}
              >
                <FontAwesomeIcon icon={faPen} className="icon" aria-hidden="true" />
                Edit project
              </button>
            </span>
            <span
              className="button-tooltip-wrap"
              title={!selectedProject ? 'Select a project first.' : 'Delete selected project'}
            >
              <button
                type="button"
                className="ghost with-icon"
                onClick={handleDeleteProject}
                disabled={!selectedProject}
              >
                <FontAwesomeIcon icon={faTrash} className="icon" aria-hidden="true" />
                Delete project
              </button>
            </span>
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
                  {option === 'detailed' ? 'Detailed' : option === 'standard' ? 'Standard' : 'Overview'}
                </button>
              ))}
            </div>
            <span
              className="button-tooltip-wrap"
              title={
                !selectedProjectId || !board?.project
                  ? 'Select a project first.'
                  : 'Open export options'
              }
            >
              <button
                type="button"
                className="ghost with-icon"
                onClick={openExportModal}
                aria-label="Open export options"
                title={!selectedProjectId || !board?.project ? undefined : 'Open export options'}
                disabled={!selectedProjectId || !board?.project}
              >
                <FontAwesomeIcon icon={faFileExcel} className="icon" aria-hidden="true" />
                Export
              </button>
            </span>
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
            className={`schedule-scroll ${isOverviewZoom ? 'mode-overview' : ''}`}
            style={{
              '--day-col-width': `${scheduleLayout.dayWidth}px`,
              '--weekend-width-factor': scheduleLayout.weekendFactor
            }}
          >
            <ScheduleGrid
              board={board}
              monthGroups={monthGroups}
              dayHeaderMode={dayHeaderMode}
              isDetailedZoom={isDetailedZoom}
              isOverviewZoom={isOverviewZoom}
              isWeekend={isWeekend}
              formatDayHeader={formatDayHeader}
              formatDayTooltip={formatDayTooltip}
              onMoveActivity={handleMoveActivity}
              onEditActivity={openEditActivityModal}
              onDeleteActivity={handleDeleteActivity}
              onCellClick={handleCellClick}
              onCreateActivity={openCreateActivityModal}
              selectedProjectId={selectedProjectId}
              bindRowRef={bindScheduleRowRef}
            />
          </div>
        )}
      </section>

      <ProjectModal
        show={showProjectModal}
        isEditingProject={isEditingProject}
        projectForm={projectForm}
        onFieldChange={handleProjectFieldChange}
        onClose={() => setShowProjectModal(false)}
        onSubmit={handleProjectSubmit}
      />

      <ScheduleFullscreenModal
        show={showScheduleFullscreen}
        onClose={() => setShowScheduleFullscreen(false)}
        zoomOptions={SCHEDULE_ZOOM_OPTIONS}
        scheduleZoom={scheduleZoom}
        onScheduleZoomChange={setScheduleZoom}
        selectedProjectId={selectedProjectId}
        board={board}
        onOpenExport={openExportModal}
        isOverviewZoom={isOverviewZoom}
        fullscreenDayWidth={fullscreenDayWidth}
        weekendWidthFactor={scheduleLayout.weekendFactor}
        monthGroups={monthGroups}
        dayHeaderMode={dayHeaderMode}
        isDetailedZoom={isDetailedZoom}
        isWeekend={isWeekend}
        formatDayHeader={formatDayHeader}
        formatDayTooltip={formatDayTooltip}
        onMoveActivity={handleMoveActivity}
        onEditActivity={openEditActivityModal}
        onDeleteActivity={handleDeleteActivity}
        onCellClick={handleCellClick}
        onCreateActivity={openCreateActivityModal}
        bindRowRef={bindFullscreenScheduleRowRef}
      />

      <ExportModal
        show={showExportModal}
        board={board}
        exportDeselectedActivityIds={exportDeselectedActivityIds}
        onToggleActivity={toggleExportActivity}
        onClose={() => setShowExportModal(false)}
        onExport={handleExportSchedule}
      />

      <ActivityModal
        show={showActivityModal}
        isEditingActivity={isEditingActivity}
        activityForm={activityForm}
        onChange={(field, value) =>
          setActivityForm((current) => ({
            ...current,
            [field]: value
          }))
        }
        onClose={closeActivityModal}
        onSubmit={handleActivitySubmit}
      />

      <SettingsModal
        show={showSettings}
        settingsStatus={settingsStatus}
        onClose={() => setShowSettings(false)}
        onOpenDataFolder={handleOpenDataFolder}
        onExportBackup={handleExportBackup}
      />
    </div>
  );
}
