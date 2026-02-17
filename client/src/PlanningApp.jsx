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
import ScheduleLegend from './planning/ScheduleLegend.jsx';
import ProjectModal from './planning/modals/ProjectModal.jsx';
import ActivityModal from './planning/modals/ActivityModal.jsx';
import ExportModal from './planning/modals/ExportModal.jsx';
import SettingsModal from './planning/modals/SettingsModal.jsx';
import ScheduleFullscreenModal from './planning/modals/ScheduleFullscreenModal.jsx';
import SubProjectModal from './planning/modals/SubProjectModal.jsx';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_ZOOM_KEY = 'matthiance.scheduleZoom.v2';
const SCHEDULE_MODE_KEY = 'matthiance.scheduleMode.v1';
const EXPORT_INCLUDE_UNUSED_KEY = 'matthiance.export.includeUnusedActivities.v1';
const SCHEDULE_ZOOM_OPTIONS = ['detailed', 'standard', 'overview'];
const SCHEDULE_MODE_OPTIONS = ['activity', 'subproject'];
const SUBPROJECT_MODAL_MODES = {
  create: 'create',
  edit: 'edit',
  duplicate: 'duplicate'
};
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
  lengthDays: '',
  subProjectName: ''
});

const defaultActivityForm = () => ({
  name: '',
  color: '#1b5c4f'
});

const defaultSubProjectForm = () => ({
  name: ''
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

  const subProjectNameRaw = typeof form.subProjectName === 'string' ? form.subProjectName.trim() : '';

  return {
    value: {
      name,
      startDate,
      endDate,
      lengthDays,
      ...(subProjectNameRaw ? { subProjectName: subProjectNameRaw } : {})
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
const subprojectFilterStorageKey = (projectId) => `matthiance.subprojectFilter.${projectId}`;
const collapsedSubprojectStorageKey = (projectId) =>
  `matthiance.activityCollapsedSubprojects.${projectId}`;

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

const buildActivityPositionMetaBySubProjectDayMap = (dayMap, allowedActivityIds = null) => {
  const daysByActivityId = {};
  Object.entries(dayMap || {}).forEach(([day, entries]) => {
    (entries || []).forEach((entry) => {
      if (
        !entry ||
        (allowedActivityIds && !allowedActivityIds.has(entry.activityId))
      ) {
        return;
      }
      if (!daysByActivityId[entry.activityId]) {
        daysByActivityId[entry.activityId] = [];
      }
      daysByActivityId[entry.activityId].push(day);
    });
  });

  return Object.entries(daysByActivityId).reduce((acc, [activityId, days]) => {
    const uniqueDays = [...new Set(days)].sort((left, right) => left.localeCompare(right));
    acc[activityId] = {
      totalAssigned: uniqueDays.length,
      positionByDay: uniqueDays.reduce((positionAcc, day, index) => {
        positionAcc[day] = index + 1;
        return positionAcc;
      }, {})
    };
    return acc;
  }, {});
};

const packSubProjectInstanceRows = (dayMap, boardDays, selectedActivityIds, activityById) => {
  const rowSlots = [];
  boardDays.forEach((day) => {
    const entries = (dayMap?.[day.date] || []).filter(
      (entry) =>
        selectedActivityIds.has(entry.activityId) &&
        Boolean(activityById[entry.activityId])
    );
    entries.forEach((entry) => {
      let target = rowSlots.find((slot) => !slot.occupiedDays.has(day.date));
      if (!target) {
        target = { occupiedDays: new Set(), entries: [] };
        rowSlots.push(target);
      }
      target.occupiedDays.add(day.date);
      target.entries.push({ day: day.date, activityId: entry.activityId });
    });
  });

  if (rowSlots.length === 0) {
    return [[{ day: null, activityId: null }]];
  }
  return rowSlots.map((slot) => slot.entries);
};

const scheduleAnimationClass = (element, className) => {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  const cleanup = () => {
    element.classList.remove(className);
    element.removeEventListener('animationend', cleanup);
  };
  element.addEventListener('animationend', cleanup);
};

const clearRowAnimationClasses = (element) => {
  element.classList.remove(
    'row-fade-swap',
    'row-fade-out-phase',
    'row-fade-in-phase',
    'row-faded-state'
  );
};

const schedulePhaseClass = (element, className) => {
  element.classList.remove('row-fade-out-phase', 'row-fade-in-phase');
  void element.offsetWidth;
  element.classList.add(className);
};

const animateReorderedRows = (
  rowsMap,
  previousIndexByIdRef,
  sequence,
  animationTimersRef
) => {
  const nextIndexById = new Map();
  let index = 0;
  rowsMap.forEach((_element, id) => {
    nextIndexById.set(id, index);
    index += 1;
  });

  const changedIds = [];
  nextIndexById.forEach((nextIndex, id) => {
    const previousIndex = previousIndexByIdRef.current.get(id);
    if (typeof previousIndex === 'number' && previousIndex !== nextIndex) {
      changedIds.push(id);
    }
  });

  animationTimersRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
  animationTimersRef.current = [];
  rowsMap.forEach((element) => clearRowAnimationClasses(element));

  if (sequence?.firstIds?.length && sequence?.secondIds?.length) {
    const fadeOutMs = 110;
    const fadeInMs = 130;
    const phaseDelay = fadeOutMs;
    const playFadeInOnly = sequence.mode === 'in-only';
    const allPhaseIds = [...new Set([...sequence.firstIds, ...sequence.secondIds])];

    if (playFadeInOnly) {
      allPhaseIds.forEach((id) => {
        const element = rowsMap.get(id);
        if (!element) {
          return;
        }
        element.classList.add('row-faded-state');
      });
    }

    const phases = playFadeInOnly
      ? [
          { ids: sequence.firstIds, className: 'row-fade-in-phase', delay: 0 },
          { ids: sequence.secondIds, className: 'row-fade-in-phase', delay: phaseDelay }
        ]
      : [
          { ids: sequence.firstIds, className: 'row-fade-out-phase', delay: 0 },
          { ids: sequence.secondIds, className: 'row-fade-out-phase', delay: phaseDelay },
          { ids: sequence.firstIds, className: 'row-fade-in-phase', delay: phaseDelay * 2 },
          { ids: sequence.secondIds, className: 'row-fade-in-phase', delay: phaseDelay * 3 }
        ];

    phases.forEach(({ ids, className, delay }) => {
      const timeoutId = window.setTimeout(() => {
        ids.forEach((id) => {
          const element = rowsMap.get(id);
          if (!element) {
            return;
          }
          if (className === 'row-fade-in-phase') {
            element.classList.remove('row-faded-state');
          }
          schedulePhaseClass(element, className);
        });
      }, delay);
      animationTimersRef.current.push(timeoutId);
    });

    const cleanupDelay = playFadeInOnly
      ? phaseDelay + fadeInMs + 16
      : phaseDelay * 3 + fadeInMs + 16;
    const cleanupId = window.setTimeout(() => {
      allPhaseIds.forEach((id) => {
        const element = rowsMap.get(id);
        if (!element) {
          return;
        }
        element.classList.remove('row-fade-out-phase', 'row-fade-in-phase', 'row-faded-state');
      });
    }, cleanupDelay);
    animationTimersRef.current.push(cleanupId);
  } else {
    changedIds.forEach((id) => {
      const element = rowsMap.get(id);
      if (!element) {
        return;
      }
      scheduleAnimationClass(element, 'row-fade-swap');
    });
  }

  previousIndexByIdRef.current = nextIndexById;
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
  const [showSubProjectModal, setShowSubProjectModal] = useState(false);
  const [isEditingSubProject, setIsEditingSubProject] = useState(false);
  const [editingSubProjectId, setEditingSubProjectId] = useState(null);
  const [subProjectModalMode, setSubProjectModalMode] = useState(SUBPROJECT_MODAL_MODES.create);
  const [duplicatingSubProjectId, setDuplicatingSubProjectId] = useState(null);
  const [duplicateDeselectedActivityIds, setDuplicateDeselectedActivityIds] = useState([]);
  const [subProjectForm, setSubProjectForm] = useState(defaultSubProjectForm);
  const [activeSubProjectId, setActiveSubProjectId] = useState(null);
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
  const [scheduleMode, setScheduleMode] = useState(() => {
    if (typeof window === 'undefined') {
      return 'activity';
    }
    const storedMode = localStorage.getItem(SCHEDULE_MODE_KEY);
    if (SCHEDULE_MODE_OPTIONS.includes(storedMode)) {
      return storedMode;
    }
    return 'activity';
  });

  const [showSettings, setShowSettings] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [showScheduleFullscreen, setShowScheduleFullscreen] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel'
  });
  const [exportDeselectedActivityIds, setExportDeselectedActivityIds] = useState([]);
  const [includeUnusedActivitiesInExport, setIncludeUnusedActivitiesInExport] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    const stored = localStorage.getItem(EXPORT_INCLUDE_UNUSED_KEY);
    if (stored === null) {
      return true;
    }
    try {
      return JSON.parse(stored) !== false;
    } catch {
      return stored !== 'false';
    }
  });
  const [exportScheduleMode, setExportScheduleMode] = useState(scheduleMode);
  const [exportScheduleZoom, setExportScheduleZoom] = useState(scheduleZoom);
  const [collapsedSubProjectIds, setCollapsedSubProjectIds] = useState([]);
  const [pendingSubProjectActionIds, setPendingSubProjectActionIds] = useState([]);
  const scheduleRowRefs = useRef(new Map());
  const fullscreenScheduleRowRefs = useRef(new Map());
  const previousScheduleTopByIdRef = useRef(new Map());
  const previousFullscreenScheduleTopByIdRef = useRef(new Map());
  const scheduleAnimationTimersRef = useRef([]);
  const fullscreenAnimationTimersRef = useRef([]);
  const preSwapAnimationTimersRef = useRef([]);
  const pendingReorderSequenceRef = useRef(null);
  const confirmResolverRef = useRef(null);

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
  const getPersistedSubProjectFilter = (projectId) => {
    if (typeof window === 'undefined' || !projectId) {
      return null;
    }
    const raw = localStorage.getItem(subprojectFilterStorageKey(projectId));
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };
  const persistSubProjectFilter = (projectId, subProjectId) => {
    if (typeof window === 'undefined' || !projectId) {
      return;
    }
    if (!subProjectId) {
      localStorage.removeItem(subprojectFilterStorageKey(projectId));
      return;
    }
    localStorage.setItem(subprojectFilterStorageKey(projectId), String(subProjectId));
  };
  const getPersistedCollapsedSubProjects = (projectId) => {
    if (typeof window === 'undefined' || !projectId) {
      return [];
    }
    const raw = localStorage.getItem(collapsedSubprojectStorageKey(projectId));
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
    } catch {
      return [];
    }
  };
  const persistCollapsedSubProjects = (projectId, collapsedIds) => {
    if (typeof window === 'undefined' || !projectId) {
      return;
    }
    localStorage.setItem(collapsedSubprojectStorageKey(projectId), JSON.stringify(collapsedIds));
  };
  const toggleSubProjectCollapsed = (subProjectId) => {
    if (!selectedProjectId || !subProjectId) {
      return;
    }
    setCollapsedSubProjectIds((current) => {
      const currentSet = new Set(current);
      if (currentSet.has(subProjectId)) {
        currentSet.delete(subProjectId);
      } else {
        currentSet.add(subProjectId);
      }
      const next = [...currentSet];
      persistCollapsedSubProjects(selectedProjectId, next);
      return next;
    });
  };
  const setSubProjectActionPending = (subProjectId, pending) => {
    setPendingSubProjectActionIds((current) => {
      const set = new Set(current);
      if (pending) {
        set.add(subProjectId);
      } else {
        set.delete(subProjectId);
      }
      return [...set];
    });
  };
  const isSubProjectActionPending = (subProjectId) =>
    pendingSubProjectActionIds.includes(subProjectId);
  const buildSubProjectGroupRowIds = (subProjectId) => [
    `subproject-group-${subProjectId}`,
    ...(board?.activities || []).map((activity) => `activity-${subProjectId}-${activity.id}`)
  ];
  const buildSubProjectModeRowIds = (subProjectId) => [`subproject-${subProjectId}`];
  const buildActivityRowIds = (activityId) =>
    (board?.subprojects || []).map((subproject) => `activity-${subproject.id}-${activityId}`);
  const clearPreSwapTimers = () => {
    preSwapAnimationTimersRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    preSwapAnimationTimersRef.current = [];
  };
  const applyAnimationToRowId = (rowId, className) => {
    const scheduleElement = scheduleRowRefs.current.get(rowId);
    if (scheduleElement) {
      schedulePhaseClass(scheduleElement, className);
    }
    const fullscreenElement = fullscreenScheduleRowRefs.current.get(rowId);
    if (fullscreenElement) {
      schedulePhaseClass(fullscreenElement, className);
    }
  };
  const clearAnimationForRowId = (rowId) => {
    const scheduleElement = scheduleRowRefs.current.get(rowId);
    if (scheduleElement) {
      clearRowAnimationClasses(scheduleElement);
    }
    const fullscreenElement = fullscreenScheduleRowRefs.current.get(rowId);
    if (fullscreenElement) {
      clearRowAnimationClasses(fullscreenElement);
    }
  };
  const playPreSwapFadeOut = (sequence) =>
    new Promise((resolve) => {
      if (!sequence?.firstIds?.length || !sequence?.secondIds?.length) {
        resolve();
        return;
      }

      const phaseDelay = 110;
      const allRowIds = [...new Set([...sequence.firstIds, ...sequence.secondIds])];
      clearPreSwapTimers();
      allRowIds.forEach((rowId) => clearAnimationForRowId(rowId));

      const firstPhaseId = window.setTimeout(() => {
        sequence.firstIds.forEach((rowId) => applyAnimationToRowId(rowId, 'row-fade-out-phase'));
      }, 0);
      const secondPhaseId = window.setTimeout(() => {
        sequence.secondIds.forEach((rowId) => applyAnimationToRowId(rowId, 'row-fade-out-phase'));
      }, phaseDelay);
      const doneId = window.setTimeout(() => {
        resolve();
      }, phaseDelay * 2 + 16);

      preSwapAnimationTimersRef.current.push(firstPhaseId, secondPhaseId, doneId);
    });
  const restoreRowsFromPreSwap = (sequence) =>
    new Promise((resolve) => {
      if (!sequence?.firstIds?.length || !sequence?.secondIds?.length) {
        resolve();
        return;
      }

      const phaseDelay = 110;
      clearPreSwapTimers();

      const firstPhaseId = window.setTimeout(() => {
        sequence.firstIds.forEach((rowId) => applyAnimationToRowId(rowId, 'row-fade-in-phase'));
      }, 0);
      const secondPhaseId = window.setTimeout(() => {
        sequence.secondIds.forEach((rowId) => applyAnimationToRowId(rowId, 'row-fade-in-phase'));
      }, phaseDelay);
      const doneId = window.setTimeout(() => {
        [...new Set([...sequence.firstIds, ...sequence.secondIds])].forEach((rowId) =>
          clearAnimationForRowId(rowId)
        );
        resolve();
      }, phaseDelay + 130 + 16);

      preSwapAnimationTimersRef.current.push(firstPhaseId, secondPhaseId, doneId);
    });

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
      setActiveSubProjectId(null);
      setBoard(null);
      return;
    }

    setSelectedProjectId((current) => {
      const exists = result.some((project) => project.id === current);
      return exists ? current : result[0].id;
    });
  };

  const loadBoard = async (projectId, requestedSubProjectId) => {
    if (!projectId) {
      setBoard(null);
      return;
    }

    const result = await withApi(async () => {
      const boardPath =
        scheduleMode === 'activity' && requestedSubProjectId
          ? `/api/projects/${projectId}/board?subProjectId=${encodeURIComponent(requestedSubProjectId)}`
          : `/api/projects/${projectId}/board`;
      const response = await fetch(apiUrl(boardPath));
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to load project board.'));
      }
      return response.json();
    });

    if (!result) {
      return;
    }

    if (result.activeSubProjectId !== activeSubProjectId) {
      setActiveSubProjectId(result.activeSubProjectId || null);
      persistSubProjectFilter(projectId, result.activeSubProjectId || null);
    }

    setBoard(result);
  };

  const requestConfirmation = ({
    title = 'Please confirm',
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel'
  }) =>
    new Promise((resolve) => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
      }
      confirmResolverRef.current = resolve;
      setConfirmDialog({
        open: true,
        title,
        message,
        confirmLabel,
        cancelLabel
      });
    });

  const resolveConfirmation = (accepted) => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(accepted);
      confirmResolverRef.current = null;
    }
    setConfirmDialog((current) => ({ ...current, open: false }));
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    setCollapsedSubProjectIds(getPersistedCollapsedSubProjects(selectedProjectId));
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || !board?.subprojects) {
      return;
    }
    const validSubProjectIds = new Set((board.subprojects || []).map((subproject) => subproject.id));
    setCollapsedSubProjectIds((current) => {
      const next = current.filter((id) => validSubProjectIds.has(id));
      if (next.length !== current.length) {
        persistCollapsedSubProjects(selectedProjectId, next);
      }
      return next;
    });
  }, [selectedProjectId, board?.subprojects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setActiveSubProjectId(null);
      return;
    }
    setActiveSubProjectId(getPersistedSubProjectFilter(selectedProjectId));
  }, [selectedProjectId]);

  useEffect(() => {
    loadBoard(selectedProjectId, activeSubProjectId);
  }, [selectedProjectId, activeSubProjectId, scheduleMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    localStorage.setItem(SCHEDULE_ZOOM_KEY, scheduleZoom);
  }, [scheduleZoom]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    localStorage.setItem(SCHEDULE_MODE_KEY, scheduleMode);
  }, [scheduleMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    localStorage.setItem(
      EXPORT_INCLUDE_UNUSED_KEY,
      JSON.stringify(includeUnusedActivitiesInExport)
    );
  }, [includeUnusedActivitiesInExport]);

  useEffect(
    () => () => {
      clearPreSwapTimers();
      scheduleAnimationTimersRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      fullscreenAnimationTimersRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    },
    []
  );

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const hasOpenModal =
      showProjectModal ||
      showActivityModal ||
      showSubProjectModal ||
      showSettings ||
      showScheduleFullscreen ||
      showExportModal ||
      confirmDialog.open;
    const previousOverflow = document.body.style.overflow;

    if (hasOpenModal) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [
    showProjectModal,
    showActivityModal,
    showSubProjectModal,
    showSettings,
    showScheduleFullscreen,
    showExportModal,
    confirmDialog.open
  ]);

  useEffect(
    () => () => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
        confirmResolverRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    const hasKeyboardModal =
      showProjectModal ||
      showActivityModal ||
      showSubProjectModal ||
      showSettings ||
      showScheduleFullscreen ||
      showExportModal ||
      confirmDialog.open;
    if (!hasKeyboardModal) {
      return;
    }

    const isTextEntryTarget = (target) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tag = target.tagName;
      return (
        target.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT'
      );
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (confirmDialog.open) {
          resolveConfirmation(false);
          return;
        }
        if (showSubProjectModal) {
          closeSubProjectModal();
          return;
        }
        if (showActivityModal) {
          closeActivityModal();
          return;
        }
        if (showProjectModal) {
          setShowProjectModal(false);
          return;
        }
        if (showExportModal) {
          setShowExportModal(false);
          return;
        }
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (showScheduleFullscreen) {
          setShowScheduleFullscreen(false);
        }
      }

      if (event.key !== 'Enter' || isTextEntryTarget(event.target)) {
        return;
      }

      if (confirmDialog.open) {
        event.preventDefault();
        resolveConfirmation(true);
        return;
      }

      if (showExportModal) {
        const selectedCount =
          (board?.activities?.length || 0) - (exportDeselectedActivityIds?.length || 0);
        if (selectedCount > 0) {
          event.preventDefault();
          handleExportSchedule();
        }
        return;
      }

      if (showSettings) {
        event.preventDefault();
        handleExportBackup();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    showProjectModal,
    showActivityModal,
    showSubProjectModal,
    showSettings,
    showScheduleFullscreen,
    showExportModal,
    confirmDialog.open,
    board?.activities,
    exportDeselectedActivityIds
  ]);

  useLayoutEffect(() => {
    const rowIds =
      scheduleMode === 'activity'
        ? (board?.subprojects || []).flatMap((subproject) => [
            `subproject-group-${subproject.id}`,
            ...(board?.activities || []).map((activity) => `activity-${subproject.id}-${activity.id}`)
          ])
        : (board?.subprojects || []).map((subproject) => `subproject-${subproject.id}`);
    if (rowIds.length === 0) {
      previousScheduleTopByIdRef.current = new Map();
      previousFullscreenScheduleTopByIdRef.current = new Map();
      return;
    }

    const scheduleRows = new Map();
    const fullscreenScheduleRows = new Map();
    for (const id of rowIds) {
      const scheduleElement = scheduleRowRefs.current.get(id);
      if (scheduleElement) {
        scheduleRows.set(id, scheduleElement);
      }
      const fullscreenScheduleElement = fullscreenScheduleRowRefs.current.get(id);
      if (fullscreenScheduleElement) {
        fullscreenScheduleRows.set(id, fullscreenScheduleElement);
      }
    }

    const sequence = pendingReorderSequenceRef.current;
    pendingReorderSequenceRef.current = null;

    animateReorderedRows(
      scheduleRows,
      previousScheduleTopByIdRef,
      sequence,
      scheduleAnimationTimersRef
    );
    animateReorderedRows(
      fullscreenScheduleRows,
      previousFullscreenScheduleTopByIdRef,
      sequence,
      fullscreenAnimationTimersRef
    );
  }, [board?.activities, board?.subprojects, scheduleMode]);

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
      lengthDays: String(selectedProject.lengthDays),
      subProjectName: ''
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
      const confirmTrim = await requestConfirmation({
        title: 'Confirm Project Update',
        message:
        `Shortening or shifting this project will remove ${count} activity ${instanceLabel} outside the new date range. Continue?`
      });
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

    const ok = await requestConfirmation({
      title: 'Delete Project',
      confirmLabel: 'Delete',
      message:
      `Delete project \"${selectedProject.name}\" and all related sub-projects, activities, and instances?`
    });
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
      `Project deleted (${deleted.deletedSubprojects || 0} sub-projects, ${deleted.deletedActivities} activities, ${deleted.deletedInstances} instances).`
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

    const ok = await requestConfirmation({
      title: 'Delete Activity',
      confirmLabel: 'Delete',
      message:
      `Delete activity \"${activity.name}\" and all of its instances?`
    });
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

    const activityRows = board?.activities || [];
    const currentIndex = activityRows.findIndex((activity) => activity.id === activityId);
    const neighborIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    const neighbor = activityRows[neighborIndex];
    const sequence =
      scheduleMode === 'activity' && neighbor && currentIndex >= 0
        ? {
            firstIds: buildActivityRowIds(activityId),
            secondIds: buildActivityRowIds(neighbor.id)
          }
        : null;
    if (sequence) {
      await playPreSwapFadeOut(sequence);
      pendingReorderSequenceRef.current = { ...sequence, mode: 'in-only' };
    } else {
      pendingReorderSequenceRef.current = null;
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
      pendingReorderSequenceRef.current = null;
      if (sequence) {
        await restoreRowsFromPreSwap(sequence);
      }
      return;
    }

    if (!moved.moved) {
      pendingReorderSequenceRef.current = null;
      if (sequence) {
        await restoreRowsFromPreSwap(sequence);
      }
      setStatus(direction === 'up' ? 'Activity is already at the top.' : 'Activity is already at the bottom.');
      return;
    }

    await loadBoard(selectedProjectId);
  };

  const closeSubProjectModal = () => {
    setShowSubProjectModal(false);
    setIsEditingSubProject(false);
    setEditingSubProjectId(null);
    setSubProjectModalMode(SUBPROJECT_MODAL_MODES.create);
    setDuplicatingSubProjectId(null);
    setDuplicateDeselectedActivityIds([]);
  };

  const openCreateSubProjectModal = () => {
    if (!selectedProjectId) {
      setStatus('Select or create a project first.');
      return;
    }
    setSubProjectModalMode(SUBPROJECT_MODAL_MODES.create);
    setIsEditingSubProject(false);
    setEditingSubProjectId(null);
    setSubProjectForm(defaultSubProjectForm());
    setShowSubProjectModal(true);
  };

  const openEditSubProjectModal = (subproject) => {
    if (!subproject) {
      return;
    }
    setSubProjectModalMode(SUBPROJECT_MODAL_MODES.edit);
    setIsEditingSubProject(true);
    setEditingSubProjectId(subproject.id);
    setSubProjectForm({ name: subproject.name });
    setShowSubProjectModal(true);
  };

  const openDuplicateSubProjectModal = (subproject) => {
    if (!subproject) {
      return;
    }
    setSubProjectModalMode(SUBPROJECT_MODAL_MODES.duplicate);
    setIsEditingSubProject(false);
    setEditingSubProjectId(null);
    setDuplicatingSubProjectId(subproject.id);
    setDuplicateDeselectedActivityIds([]);
    setSubProjectForm({ name: `${subproject.name} (copy)` });
    setShowSubProjectModal(true);
  };

  const toggleDuplicateActivity = (activityId, checked) => {
    setDuplicateDeselectedActivityIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.delete(activityId);
      } else {
        next.add(activityId);
      }
      return [...next];
    });
  };

  const handleSubProjectSubmit = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) {
      setStatus('Select or create a project first.');
      return;
    }

    const name = subProjectForm.name.trim();
    if (!name) {
      setStatus('Sub-project name is required.');
      return;
    }

    if (
      subProjectModalMode === SUBPROJECT_MODAL_MODES.edit &&
      !editingSubProjectId
    ) {
      setStatus('No sub-project selected for editing.');
      return;
    }

    if (
      subProjectModalMode === SUBPROJECT_MODAL_MODES.duplicate &&
      !duplicatingSubProjectId
    ) {
      setStatus('No sub-project selected for duplication.');
      return;
    }

    let endpoint = `/api/projects/${selectedProjectId}/subprojects`;
    let method = 'POST';
    let payload = { name };

    if (subProjectModalMode === SUBPROJECT_MODAL_MODES.edit) {
      endpoint = `/api/projects/${selectedProjectId}/subprojects/${editingSubProjectId}`;
      method = 'PUT';
    } else if (subProjectModalMode === SUBPROJECT_MODAL_MODES.duplicate) {
      endpoint = `/api/projects/${selectedProjectId}/subprojects/${duplicatingSubProjectId}/duplicate`;
      const selectedActivityIds = (board?.activities || [])
        .filter((activity) => !duplicateDeselectedActivityIds.includes(activity.id))
        .map((activity) => activity.id);
      payload = { name, activityIds: selectedActivityIds };
      setSubProjectActionPending(duplicatingSubProjectId, true);
    }

    const saved = await withApi(async () => {
      const response = await fetch(apiUrl(endpoint), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to save sub-project.'));
      }
      return response.json();
    });

    if (subProjectModalMode === SUBPROJECT_MODAL_MODES.duplicate && duplicatingSubProjectId) {
      setSubProjectActionPending(duplicatingSubProjectId, false);
    }

    if (!saved) {
      return;
    }

    closeSubProjectModal();
    setSubProjectForm(defaultSubProjectForm());
    if (subProjectModalMode === SUBPROJECT_MODAL_MODES.create) {
      setActiveSubProjectId(saved.id);
      persistSubProjectFilter(selectedProjectId, saved.id);
    }
    if (subProjectModalMode === SUBPROJECT_MODAL_MODES.edit) {
      setStatus('Sub-project updated.');
    } else if (subProjectModalMode === SUBPROJECT_MODAL_MODES.duplicate) {
      setStatus(`Sub-project duplicated (${saved.copiedInstances || 0} instances copied).`);
    } else {
      setStatus('Sub-project added.');
    }
    await loadBoard(
      selectedProjectId,
      subProjectModalMode === SUBPROJECT_MODAL_MODES.create ? saved.id : activeSubProjectId
    );
  };

  const handleMoveSubProject = async (subProjectId, direction) => {
    if (!selectedProjectId) {
      return;
    }

    const subprojectRows = board?.subprojects || [];
    const currentIndex = subprojectRows.findIndex((subproject) => subproject.id === subProjectId);
    const neighborIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    const neighbor = subprojectRows[neighborIndex];
    const sequence =
      neighbor && currentIndex >= 0
        ? {
            firstIds:
              scheduleMode === 'activity'
                ? buildSubProjectGroupRowIds(subProjectId)
                : buildSubProjectModeRowIds(subProjectId),
            secondIds:
              scheduleMode === 'activity'
                ? buildSubProjectGroupRowIds(neighbor.id)
                : buildSubProjectModeRowIds(neighbor.id)
          }
        : null;
    if (sequence) {
      await playPreSwapFadeOut(sequence);
      pendingReorderSequenceRef.current = { ...sequence, mode: 'in-only' };
    } else {
      pendingReorderSequenceRef.current = null;
    }

    const moved = await withApi(async () => {
      const response = await fetch(
        apiUrl(`/api/projects/${selectedProjectId}/subprojects/${subProjectId}/reorder`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction })
        }
      );
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to reorder sub-project.'));
      }
      return response.json();
    });

    if (!moved) {
      pendingReorderSequenceRef.current = null;
      if (sequence) {
        await restoreRowsFromPreSwap(sequence);
      }
      return;
    }

    if (!moved.moved) {
      pendingReorderSequenceRef.current = null;
      if (sequence) {
        await restoreRowsFromPreSwap(sequence);
      }
      setStatus(
        direction === 'up'
          ? 'Sub-project is already at the top.'
          : 'Sub-project is already at the bottom.'
      );
      return;
    }

    await loadBoard(selectedProjectId);
  };

  const handleDeleteSubProject = async (subproject) => {
    if (!selectedProjectId || !subproject) {
      return;
    }

    const ok = await requestConfirmation({
      title: 'Delete Sub-project',
      confirmLabel: 'Delete',
      message:
      `Delete sub-project \"${subproject.name}\" and all of its activity instances?`
    });
    if (!ok) {
      return;
    }

    const deleted = await withApi(async () => {
      const response = await fetch(
        apiUrl(`/api/projects/${selectedProjectId}/subprojects/${subproject.id}`),
        { method: 'DELETE' }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && body?.code === 'SUBPROJECT_MINIMUM_REQUIRED') {
          throw new Error('At least one sub-project is required.');
        }
        throw new Error(body?.error || 'Unable to delete sub-project.');
      }
      return body;
    });

    if (!deleted) {
      return;
    }

    setStatus(`Sub-project deleted (${deleted.deletedInstances} instances removed).`);
    await loadBoard(selectedProjectId);
  };

  const handleDuplicateSubProject = async (subproject) => {
    if (!selectedProjectId || !subproject) {
      return;
    }
    openDuplicateSubProjectModal(subproject);
  };

  const handleShiftSubProject = async (subProjectId, days) => {
    if (!selectedProjectId || !subProjectId) {
      return;
    }

    const submitShift = async (confirmDeleteOutOfRangeInstances = false) =>
      withApi(async () => {
        const response = await fetch(
          apiUrl(`/api/projects/${selectedProjectId}/subprojects/${subProjectId}/shift`),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days, confirmDeleteOutOfRangeInstances })
          }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (
            response.status === 409 &&
            body?.code === 'SUBPROJECT_SHIFT_OUT_OF_RANGE_DELETE_REQUIRED'
          ) {
            return {
              requiresOutOfRangeDeleteConfirmation: true,
              outOfRangeInstances: body.outOfRangeInstances || 0
            };
          }
          throw new Error(body?.error || 'Unable to shift sub-project.');
        }
        return { shiftResult: body };
      });

    setSubProjectActionPending(subProjectId, true);
    let shiftResponse = await submitShift(false);
    if (!shiftResponse) {
      setSubProjectActionPending(subProjectId, false);
      return;
    }

    if (shiftResponse.requiresOutOfRangeDeleteConfirmation) {
      const count = shiftResponse.outOfRangeInstances || 0;
      const instanceLabel = count === 1 ? 'instance' : 'instances';
      const confirmed = await requestConfirmation({
        title: 'Confirm Sub-project Shift',
        message: `Shifting this sub-project will remove ${count} activity ${instanceLabel} outside the project date range. Continue?`,
        confirmLabel: 'Shift and delete'
      });
      if (!confirmed) {
        setSubProjectActionPending(subProjectId, false);
        setStatus('Sub-project shift canceled.');
        return;
      }
      shiftResponse = await submitShift(true);
      if (!shiftResponse || shiftResponse.requiresOutOfRangeDeleteConfirmation) {
        setSubProjectActionPending(subProjectId, false);
        return;
      }
    }

    setSubProjectActionPending(subProjectId, false);
    const shiftResult = shiftResponse.shiftResult;
    const signed = days > 0 ? `+${days}` : String(days);
    setStatus(
      `Shifted ${signed} day(s): moved ${shiftResult.movedCount || 0}, removed ${shiftResult.deletedOutOfRangeCount || 0} out-of-range, ${shiftResult.skippedDuplicateCount || 0} duplicates.`
    );
    await loadBoard(selectedProjectId);
  };

  const createActivityInstance = async (activityId, day, subProjectId) => {
    if (!selectedProjectId || !subProjectId) {
      return false;
    }

    const created = await withApi(async () => {
      const response = await fetch(
        apiUrl(`/api/projects/${selectedProjectId}/activities/${activityId}/instances`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: day, subProjectId })
        }
      );
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to assign activity.'));
      }
      return response.json();
    });

    if (!created) {
      return false;
    }
    setStatus('Activity assigned.');
    await loadBoard(selectedProjectId);
    return true;
  };

  const deleteActivityInstance = async (activityId, day, subProjectId) => {
    if (!selectedProjectId || !subProjectId) {
      return false;
    }

    const deleted = await withApi(async () => {
      const response = await fetch(
        apiUrl(
          `/api/projects/${selectedProjectId}/activities/${activityId}/instances/${encodeURIComponent(day)}?subProjectId=${encodeURIComponent(subProjectId)}`
        ),
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Unable to delete activity instance.'));
      }
      return response.json();
    });

    if (!deleted) {
      return false;
    }

    setStatus('Activity instance removed.');
    await loadBoard(selectedProjectId);
    return true;
  };

  const handleActivityCellClick = async (activityId, day, filled, subProjectId = null) => {
    const targetSubProjectId = subProjectId || activeSubProjectId;
    if (!targetSubProjectId) {
      setStatus('Select a sub-project first.');
      return;
    }
    if (filled) {
      await deleteActivityInstance(activityId, day, targetSubProjectId);
      return;
    }
    await createActivityInstance(activityId, day, targetSubProjectId);
  };

  const handleSubProjectAddInstance = async (subProjectId, day, activityId) => {
    await createActivityInstance(activityId, day, subProjectId);
  };

  const handleSubProjectBlockDelete = async (subProjectId, day, activityId) => {
    await deleteActivityInstance(activityId, day, subProjectId);
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
    setExportScheduleMode(scheduleMode);
    setExportScheduleZoom(scheduleZoom);
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

    const exportIsDetailedZoom = exportScheduleZoom === 'detailed';
    const exportIsOverviewZoom = exportScheduleZoom === 'overview';
    const exportDayHeaderMode = exportIsDetailedZoom
      ? 'full'
      : exportIsOverviewZoom
        ? 'day-only'
        : 'compact';
    const exportLayout = SCHEDULE_ZOOM_LAYOUT[exportScheduleZoom] || SCHEDULE_ZOOM_LAYOUT.standard;

    const selectedActivities = board.activities.filter(
      (activity) => !exportDeselectedActivityIds.includes(activity.id)
    );
    const selectedActivityIds = new Set(selectedActivities.map((activity) => activity.id));
    const usedSelectedActivityIds = new Set();
    if (!includeUnusedActivitiesInExport) {
      (board.subprojects || []).forEach((subproject) => {
        const dayMap = board.subProjectDayMap?.[String(subproject.id)] || {};
        Object.values(dayMap).forEach((entries) => {
          (entries || []).forEach((entry) => {
            if (selectedActivityIds.has(entry.activityId)) {
              usedSelectedActivityIds.add(entry.activityId);
            }
          });
        });
      });
    }
    const selectedActivitiesForLegend =
      !includeUnusedActivitiesInExport && exportScheduleMode === 'subproject'
        ? selectedActivities.filter((activity) => usedSelectedActivityIds.has(activity.id))
        : selectedActivities;
    const selectedActivityIdsForSubProjectMode = new Set(
      selectedActivitiesForLegend.map((activity) => activity.id)
    );
    const activityById = (board.activities || []).reduce((acc, activity) => {
      acc[activity.id] = activity;
      return acc;
    }, {});
    if (selectedActivities.length === 0) {
      setStatus('Select at least one activity to export.');
      return;
    }

    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const infoSheet = workbook.addWorksheet('Project Info');
      const worksheet = workbook.addWorksheet(
        exportScheduleMode === 'activity' ? 'Activity schedule' : 'Sub-project schedule'
      );

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

      const firstColumnWidth = Math.max(18, Math.round((exportLayout.dayWidth || 120) / 8) + 10) * 2;
      const dayColumnWidth = Math.max(4, Math.round((exportLayout.dayWidth || 120) / 8));

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
      const dayIndexByDate = board.days.reduce((acc, day, index) => {
        acc[day.date] = index;
        return acc;
      }, {});
      const applyWeekendCellStyle = (cell) => {
        cell.fill = weekendFill;
        cell.border = border;
      };

      const writeScheduleHeader = ({
        leftColumnCount,
        leftHeaderLabel,
        leftColumnWidths,
        headerStartRow = 1
      }) => {
        leftColumnWidths.forEach((width, index) => {
          worksheet.getColumn(index + 1).width = width;
        });
        for (let index = 0; index < board.days.length; index += 1) {
          worksheet.getColumn(leftColumnCount + index + 1).width = dayColumnWidth;
        }

        const headerRow1 = worksheet.getRow(headerStartRow);
        const headerRow2 = worksheet.getRow(headerStartRow + 1);
        headerRow1.getCell(1).value = leftHeaderLabel;
        worksheet.mergeCells(headerStartRow, 1, headerStartRow + 1, leftColumnCount);

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
            parseDateKey(board.days[end + 1].date)?.getUTCMonth() ===
              parseDateKey(day.date)?.getUTCMonth() &&
            parseDateKey(board.days[end + 1].date)?.getUTCFullYear() ===
              parseDateKey(day.date)?.getUTCFullYear()
          ) {
            end += 1;
          }
          const startCol = leftColumnCount + cursor + 1;
          const endCol = leftColumnCount + end + 1;
          headerRow1.getCell(startCol).value = monthLabel || '';
          if (endCol > startCol) {
            worksheet.mergeCells(headerStartRow, startCol, headerStartRow, endCol);
          }
          cursor = end + 1;
        }

        board.days.forEach((day, index) => {
          headerRow2.getCell(leftColumnCount + index + 1).value = formatDayHeader(
            day.date,
            exportDayHeaderMode
          );
        });

        for (let rowIndex = headerStartRow; rowIndex <= headerStartRow + 1; rowIndex += 1) {
          const row = worksheet.getRow(rowIndex);
          for (let col = 1; col <= leftColumnCount + board.days.length; col += 1) {
            const cell = row.getCell(col);
            cell.fill = headerFill;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.font = { bold: true };
          }
        }
        return headerStartRow + 2;
      };

      if (exportScheduleMode === 'activity') {
        let rowNumber = writeScheduleHeader({
          leftColumnCount: 1,
          leftHeaderLabel: 'Sub-project / Activity',
          leftColumnWidths: [firstColumnWidth]
        });
        (board.subprojects || []).forEach((subproject) => {
          const blockStartRow = rowNumber;
          const subprojectRow = worksheet.getRow(rowNumber);
          subprojectRow.getCell(1).value = subproject.name;
          subprojectRow.getCell(1).font = { bold: true };
          subprojectRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
          subprojectRow.getCell(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF6EDE1' }
          };
          subprojectRow.getCell(1).border = border;
          board.days.forEach((day, dayIndex) => {
            const cell = subprojectRow.getCell(dayIndex + 2);
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF6EDE1' }
            };
            cell.border = border;
          });
          rowNumber += 1;

          const dayMap = board.subProjectDayMap?.[String(subproject.id)] || {};
          const selectedActivitiesForSubProject = !includeUnusedActivitiesInExport
            ? selectedActivities.filter((activity) =>
                Object.keys(dayMap).some((date) =>
                  (dayMap[date] || []).some((entry) => entry.activityId === activity.id)
                )
              )
            : selectedActivities;

          selectedActivitiesForSubProject.forEach((activity) => {
            const row = worksheet.getRow(rowNumber);
            row.getCell(1).value = `  ${activity.name}`;
            row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
            row.getCell(1).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: `FF${normalizeHexColor(activity.color, '1B5C4F')}` }
            };
            row.getCell(1).font = {
              bold: false,
              color: { argb: getExcelContrastTextArgb(activity.color) }
            };
            row.getCell(1).border = border;

            const assignedDays = Object.keys(dayMap)
              .filter((date) =>
                (dayMap[date] || []).some((entry) => entry.activityId === activity.id)
              )
              .sort((left, right) => left.localeCompare(right));
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
              const filled = Boolean(
                (dayMap[day.date] || []).some((entry) => entry.activityId === activity.id)
              );

              if (filled) {
                const position = positionByDay[day.date];
                cell.value = exportIsOverviewZoom
                  ? ''
                  : exportIsDetailedZoom
                    ? `${activity.name} ${position}/${totalAssigned}`
                    : `${position}/${totalAssigned}`;
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: fillColor }
                };
                cell.font = { bold: false, color: { argb: textColor } };
              } else if (isWeekend(day)) {
                applyWeekendCellStyle(cell);
              }
              cell.alignment = {
                vertical: 'middle',
                horizontal: 'center',
                wrapText: exportIsDetailedZoom
              };
            });
            rowNumber += 1;
          });

          const blockEndRow = rowNumber - 1;
          const blockLastCol = 1 + board.days.length;
          for (let blockRow = blockStartRow; blockRow <= blockEndRow; blockRow += 1) {
            for (let blockCol = 1; blockCol <= blockLastCol; blockCol += 1) {
              const cell = worksheet.getRow(blockRow).getCell(blockCol);
              const current = cell.border || {};
              cell.border = {
                top:
                  blockRow === blockStartRow
                    ? { style: 'medium', color: { argb: 'FFB9A58A' } }
                    : current.top || { style: 'thin', color: { argb: 'FFE1E1E1' } },
                bottom:
                  blockRow === blockEndRow
                    ? { style: 'medium', color: { argb: 'FFB9A58A' } }
                    : current.bottom || { style: 'thin', color: { argb: 'FFE1E1E1' } },
                left:
                  blockCol === 1
                    ? { style: 'medium', color: { argb: 'FFB9A58A' } }
                    : current.left || { style: 'thin', color: { argb: 'FFE1E1E1' } },
                right:
                  blockCol === blockLastCol
                    ? { style: 'medium', color: { argb: 'FFB9A58A' } }
                    : current.right || { style: 'thin', color: { argb: 'FFE1E1E1' } }
              };
            }
          }
        });

        worksheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
      } else {
        if (!includeUnusedActivitiesInExport && selectedActivitiesForLegend.length === 0) {
          setStatus('No used activities found for the selected export settings.');
          return;
        }
        const legendColumnWidth = Math.max(20, firstColumnWidth);
        const subProjectColumnWidth = Math.max(22, firstColumnWidth * 0.8);
        worksheet.getColumn(1).width = legendColumnWidth;
        worksheet.getColumn(2).width = subProjectColumnWidth;
        for (let index = 0; index < board.days.length; index += 1) {
          worksheet.getColumn(index + 3).width = dayColumnWidth;
        }

        const monthRow = worksheet.getRow(1);
        const dayRow = worksheet.getRow(2);
        monthRow.getCell(1).value = 'Legend';
        monthRow.getCell(2).value = 'Sub-project';
        worksheet.mergeCells(1, 1, 2, 1);
        worksheet.mergeCells(1, 2, 2, 2);

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
            parseDateKey(board.days[end + 1].date)?.getUTCMonth() ===
              parseDateKey(day.date)?.getUTCMonth() &&
            parseDateKey(board.days[end + 1].date)?.getUTCFullYear() ===
              parseDateKey(day.date)?.getUTCFullYear()
          ) {
            end += 1;
          }
          const startCol = cursor + 3;
          const endCol = end + 3;
          monthRow.getCell(startCol).value = monthLabel || '';
          if (endCol > startCol) {
            worksheet.mergeCells(1, startCol, 1, endCol);
          }
          cursor = end + 1;
        }

        board.days.forEach((day, index) => {
          dayRow.getCell(index + 3).value = formatDayHeader(day.date, exportDayHeaderMode);
        });

        for (let rowIndex = 1; rowIndex <= 2; rowIndex += 1) {
          const row = worksheet.getRow(rowIndex);
          for (let col = 1; col <= board.days.length + 2; col += 1) {
            const cell = row.getCell(col);
            cell.fill = headerFill;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.font = { bold: true };
          }
        }
        monthRow.getCell(2).border = {
          ...(monthRow.getCell(2).border || {}),
          left: { style: 'medium', color: { argb: 'FFB9A58A' } }
        };

        selectedActivitiesForLegend.forEach((activity, index) => {
          const cell = worksheet.getRow(index + 3).getCell(1);
          const activityColor = normalizeHexColor(activity.color, '1B5C4F');
          cell.value = activity.name;
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: `FF${activityColor}` }
          };
          cell.font = { bold: false, color: { argb: getExcelContrastTextArgb(activityColor) } };
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
          cell.border = border;
        });

        let rowNumber = 3;

        (board.subprojects || []).forEach((subproject) => {
          const dayMap = board.subProjectDayMap?.[String(subproject.id)] || {};
          const activityPositionMetaById = buildActivityPositionMetaBySubProjectDayMap(
            dayMap,
            selectedActivityIdsForSubProjectMode
          );

          const packedRows = packSubProjectInstanceRows(
            dayMap,
            board.days,
            selectedActivityIdsForSubProjectMode,
            activityById
          );

          const startRow = rowNumber;
          packedRows.forEach((packedRow) => {
            const row = worksheet.getRow(rowNumber);
            board.days.forEach((day, dayIndex) => {
              const cell = row.getCell(dayIndex + 3);
              if (isWeekend(day)) {
                applyWeekendCellStyle(cell);
              }
              cell.alignment = {
                vertical: 'middle',
                horizontal: 'center',
                wrapText: exportIsDetailedZoom
              };
            });

            packedRow.forEach((instanceRow) => {
              if (!instanceRow.day || !instanceRow.activityId) {
                return;
              }
              const activity = activityById[instanceRow.activityId];
              const activityColor = normalizeHexColor(activity.color, '1B5C4F');
              const fillColor = `FF${activityColor}`;
              const textColor = getExcelContrastTextArgb(activityColor);
              const dayIndex = dayIndexByDate[instanceRow.day];
              const targetCell = row.getCell(dayIndex + 3);
              const positionMeta = activityPositionMetaById[String(instanceRow.activityId)] || {};
              const position = positionMeta.positionByDay?.[instanceRow.day];
              const compactValue =
                typeof position === 'number' && positionMeta.totalAssigned
                  ? `${position}/${positionMeta.totalAssigned}`
                  : '';

              targetCell.value = exportIsOverviewZoom
                ? ''
                : exportIsDetailedZoom
                  ? activity.name
                  : compactValue;
              targetCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: fillColor }
              };
              targetCell.font = { bold: false, color: { argb: textColor } };
            });

            rowNumber += 1;
          });

          const endRow = rowNumber - 1;
          worksheet.mergeCells(startRow, 2, endRow, 2);
          const mergedCell = worksheet.getRow(startRow).getCell(2);
          mergedCell.value = subproject.name;
          mergedCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
          mergedCell.font = { bold: true };
          mergedCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF6EDE1' }
          };
          mergedCell.border = border;

          const blockStartCol = 2;
          const blockLastCol = 2 + board.days.length;
          for (let blockRow = startRow; blockRow <= endRow; blockRow += 1) {
            for (let blockCol = blockStartCol; blockCol <= blockLastCol; blockCol += 1) {
              const cell = worksheet.getRow(blockRow).getCell(blockCol);
              const current = cell.border || {};
              cell.border = {
                top:
                  blockRow === startRow
                    ? { style: 'medium', color: { argb: 'FFB9A58A' } }
                    : current.top || { style: 'thin', color: { argb: 'FFE1E1E1' } },
                bottom:
                  blockRow === endRow
                    ? { style: 'medium', color: { argb: 'FFB9A58A' } }
                    : current.bottom || { style: 'thin', color: { argb: 'FFE1E1E1' } },
                left:
                  blockCol === blockStartCol
                    ? { style: 'medium', color: { argb: 'FFB9A58A' } }
                    : current.left || { style: 'thin', color: { argb: 'FFE1E1E1' } },
                right:
                  blockCol === blockLastCol
                    ? { style: 'medium', color: { argb: 'FFB9A58A' } }
                    : current.right || { style: 'thin', color: { argb: 'FFE1E1E1' } }
              };
            }
          }
        });

        worksheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
      }

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
            <div className="mode-toggle" role="group" aria-label="Schedule mode">
              {SCHEDULE_MODE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`mode-option ${scheduleMode === option ? 'is-active' : ''}`}
                  onClick={() => setScheduleMode(option)}
                >
                  {option === 'activity' ? 'Activity mode' : 'Sub-project mode'}
                </button>
              ))}
            </div>
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
          <div className="schedule-pane">
            <div
              className={`schedule-scroll ${isOverviewZoom ? 'mode-overview' : ''}`}
              style={{
                '--day-col-width': `${scheduleLayout.dayWidth}px`,
                '--weekend-width-factor': scheduleLayout.weekendFactor
              }}
            >
              <ScheduleGrid
                board={board}
                scheduleMode={scheduleMode}
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
                onCellClick={handleActivityCellClick}
                onCreateActivity={openCreateActivityModal}
                onMoveSubProject={handleMoveSubProject}
                onEditSubProject={openEditSubProjectModal}
                onDeleteSubProject={handleDeleteSubProject}
                onDuplicateSubProject={handleDuplicateSubProject}
                onShiftSubProject={handleShiftSubProject}
                onToggleSubProjectCollapse={toggleSubProjectCollapsed}
                onCreateSubProject={openCreateSubProjectModal}
                onSubProjectAddInstance={handleSubProjectAddInstance}
                onSubProjectDeleteInstance={handleSubProjectBlockDelete}
                selectedProjectId={selectedProjectId}
                collapsedSubProjectIds={collapsedSubProjectIds}
                isSubProjectActionPending={isSubProjectActionPending}
                bindRowRef={bindScheduleRowRef}
              />
            </div>
            <ScheduleLegend activities={board.activities || []} />
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
        modeOptions={SCHEDULE_MODE_OPTIONS}
        scheduleMode={scheduleMode}
        onScheduleModeChange={setScheduleMode}
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
        onCellClick={handleActivityCellClick}
        onCreateActivity={openCreateActivityModal}
        onMoveSubProject={handleMoveSubProject}
        onEditSubProject={openEditSubProjectModal}
        onDeleteSubProject={handleDeleteSubProject}
        onDuplicateSubProject={handleDuplicateSubProject}
        onShiftSubProject={handleShiftSubProject}
        onToggleSubProjectCollapse={toggleSubProjectCollapsed}
        onCreateSubProject={openCreateSubProjectModal}
        onSubProjectAddInstance={handleSubProjectAddInstance}
        onSubProjectDeleteInstance={handleSubProjectBlockDelete}
        collapsedSubProjectIds={collapsedSubProjectIds}
        isSubProjectActionPending={isSubProjectActionPending}
        bindRowRef={bindFullscreenScheduleRowRef}
      />

      <ExportModal
        show={showExportModal}
        board={board}
        scheduleMode={exportScheduleMode}
        scheduleZoom={exportScheduleZoom}
        modeOptions={SCHEDULE_MODE_OPTIONS}
        zoomOptions={SCHEDULE_ZOOM_OPTIONS}
        exportDeselectedActivityIds={exportDeselectedActivityIds}
        includeUnusedActivitiesInExport={includeUnusedActivitiesInExport}
        onToggleActivity={toggleExportActivity}
        onScheduleModeChange={setExportScheduleMode}
        onScheduleZoomChange={setExportScheduleZoom}
        onToggleIncludeUnusedActivities={setIncludeUnusedActivitiesInExport}
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

      <SubProjectModal
        show={showSubProjectModal}
        mode={subProjectModalMode}
        isEditingSubProject={isEditingSubProject}
        subProjectForm={subProjectForm}
        activities={board?.activities || []}
        duplicateDeselectedActivityIds={duplicateDeselectedActivityIds}
        onChange={(field, value) =>
          setSubProjectForm((current) => ({
            ...current,
            [field]: value
          }))
        }
        onToggleDuplicateActivity={toggleDuplicateActivity}
        onClose={closeSubProjectModal}
        onSubmit={handleSubProjectSubmit}
      />

      {confirmDialog.open && (
        <div className="modal-backdrop" onClick={() => resolveConfirmation(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>{confirmDialog.title}</h2>
                <p className="card-subtitle">{confirmDialog.message}</p>
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => resolveConfirmation(false)}
              >
                {confirmDialog.cancelLabel}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => resolveConfirmation(true)}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

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
