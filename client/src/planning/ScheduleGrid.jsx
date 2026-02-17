import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faArrowRight,
  faArrowDown,
  faArrowUp,
  faChevronDown,
  faChevronRight,
  faCopy,
  faEllipsisVertical,
  faPen,
  faPlus,
  faTrash
} from '@fortawesome/free-solid-svg-icons';

const buildPositionByDay = (assignedDays) => {
  const totalAssigned = assignedDays.length;
  const positionByDay = assignedDays.reduce((acc, date, index) => {
    acc[date] = index + 1;
    return acc;
  }, {});
  return { totalAssigned, positionByDay };
};

const buildActivityPositionMetaBySubProjectDayMap = (dayMap) => {
  const daysByActivityId = {};
  Object.entries(dayMap || {}).forEach(([day, entries]) => {
    (entries || []).forEach((entry) => {
      if (!daysByActivityId[entry.activityId]) {
        daysByActivityId[entry.activityId] = [];
      }
      daysByActivityId[entry.activityId].push(day);
    });
  });

  const meta = {};
  Object.entries(daysByActivityId).forEach(([activityId, days]) => {
    const uniqueDays = [...new Set(days)].sort((left, right) => left.localeCompare(right));
    meta[activityId] = buildPositionByDay(uniqueDays);
  });
  return meta;
};

const normalizeHexColor = (value) => {
  const raw = String(value || '')
    .trim()
    .replace(/^#/, '');
  if (raw.length === 3 && /^[0-9a-fA-F]{3}$/.test(raw)) {
    return raw
      .split('')
      .map((part) => `${part}${part}`)
      .join('')
      .toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toUpperCase();
  }
  return '1B5C4F';
};

const channelToLinear = (channel) => {
  const normalized = channel / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
};

const getContrastTextColor = (hexColor) => {
  const normalized = normalizeHexColor(hexColor);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance =
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue);
  return luminance < 0.45 ? '#FFFFFF' : '#1F1A14';
};

export default function ScheduleGrid({
  board,
  scheduleMode = 'activity',
  keyPrefix = '',
  monthGroups,
  dayHeaderMode,
  isDetailedZoom,
  isOverviewZoom,
  isWeekend,
  formatDayHeader,
  formatDayTooltip,
  onMoveActivity,
  onEditActivity,
  onDeleteActivity,
  onCellClick,
  onCreateActivity,
  onMoveSubProject,
  onEditSubProject,
  onDeleteSubProject,
  onDuplicateSubProject,
  onShiftSubProject,
  onToggleSubProjectCollapse,
  onCreateSubProject,
  onSubProjectAddInstance,
  onSubProjectDeleteInstance,
  selectedProjectId,
  collapsedSubProjectIds = [],
  isSubProjectActionPending = () => false,
  bindRowRef
}) {
  const tableRef = useRef(null);
  const [openAddMenu, setOpenAddMenu] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 8, left: 8 });
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [rowMenuPosition, setRowMenuPosition] = useState({ top: 8, left: 8 });
  const addMenuRef = useRef(null);
  const rowMenuRef = useRef(null);
  const menuTriggerRefMap = useRef(new Map());
  const rowMenuTriggerRefMap = useRef(new Map());

  useEffect(() => {
    setOpenAddMenu(null);
    setOpenRowMenu(null);
  }, [scheduleMode, board?.project?.id]);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (addMenuRef.current?.contains(event.target)) {
        return;
      }
      if (rowMenuRef.current?.contains(event.target)) {
        return;
      }
      if (event.target?.closest?.('.subproject-add-menu-wrap')) {
        return;
      }
      if (event.target?.closest?.('.row-action-menu-trigger-wrap')) {
        return;
      }
      setOpenAddMenu(null);
      setOpenRowMenu(null);
    };

    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    if (!openAddMenu && !openRowMenu) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpenAddMenu(null);
        setOpenRowMenu(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openAddMenu, openRowMenu]);

  const setMenuTriggerRef = (key) => (element) => {
    if (element) {
      menuTriggerRefMap.current.set(key, element);
      return;
    }
    menuTriggerRefMap.current.delete(key);
  };

  const setRowMenuTriggerRef = (key) => (element) => {
    if (element) {
      rowMenuTriggerRefMap.current.set(key, element);
      return;
    }
    rowMenuTriggerRefMap.current.delete(key);
  };

  useLayoutEffect(() => {
    if (!openAddMenu) {
      return;
    }

    const triggerKey = `${openAddMenu.subProjectId}:${openAddMenu.day}`;
    const triggerElement = menuTriggerRefMap.current.get(triggerKey);
    if (!triggerElement) {
      return;
    }

    const positionMenu = () => {
      const rect = triggerElement.getBoundingClientRect();
      const viewportPadding = 8;
      const estimatedWidth = 220;
      const measuredHeight = addMenuRef.current?.offsetHeight || 220;
      const menuHeight = Math.max(120, measuredHeight);

      let left = rect.left;
      if (left + estimatedWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - estimatedWidth - viewportPadding;
      }
      left = Math.max(viewportPadding, left);

      const preferredTop = rect.bottom + 4;
      const fitsBelow = preferredTop + menuHeight <= window.innerHeight - viewportPadding;
      let top = fitsBelow ? preferredTop : rect.top - menuHeight - 4;
      top = Math.max(viewportPadding, top);

      setMenuPosition({ top, left });
    };

    positionMenu();
    const rafId = window.requestAnimationFrame(positionMenu);
    const onWindowChange = () => positionMenu();
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
    };
  }, [openAddMenu]);

  useLayoutEffect(() => {
    if (!openRowMenu) {
      return;
    }

    const triggerElement = rowMenuTriggerRefMap.current.get(openRowMenu.key);
    if (!triggerElement) {
      return;
    }

    const positionMenu = () => {
      const rect = triggerElement.getBoundingClientRect();
      const viewportPadding = 8;
      const estimatedWidth = 224;
      const measuredHeight = rowMenuRef.current?.offsetHeight || 260;
      const menuHeight = Math.max(120, measuredHeight);

      let left = rect.right - estimatedWidth;
      if (left + estimatedWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - estimatedWidth - viewportPadding;
      }
      left = Math.max(viewportPadding, left);

      const preferredTop = rect.bottom + 4;
      const fitsBelow = preferredTop + menuHeight <= window.innerHeight - viewportPadding;
      let top = fitsBelow ? preferredTop : rect.top - menuHeight - 4;
      top = Math.max(viewportPadding, top);

      setRowMenuPosition({ top, left });
    };

    positionMenu();
    const rafId = window.requestAnimationFrame(positionMenu);
    const onWindowChange = () => positionMenu();
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
    };
  }, [openRowMenu]);

  const activityById = useMemo(
    () =>
      (board?.activities || []).reduce((acc, activity) => {
        acc[activity.id] = activity;
        return acc;
      }, {}),
    [board?.activities]
  );

  const activeMenuData = useMemo(() => {
    if (!openAddMenu) {
      return null;
    }
    const dayEntries =
      board?.subProjectDayMap?.[String(openAddMenu.subProjectId)]?.[openAddMenu.day] || [];
    const occupied = new Set(dayEntries.map((entry) => entry.activityId));
    const availableActivities = (board?.activities || []).filter(
      (activity) => !occupied.has(activity.id)
    );
    const occupiedActivities = dayEntries
      .map((entry) => ({
        activityId: entry.activityId,
        activity: activityById[entry.activityId]
      }))
      .filter((entry) => Boolean(entry.activity));
    return {
      ...openAddMenu,
      occupiedActivities,
      availableActivities
    };
  }, [openAddMenu, board?.subProjectDayMap, board?.activities, activityById]);

  useEffect(() => {
    if (!activeMenuData || !addMenuRef.current) {
      return;
    }
    const firstAction = addMenuRef.current.querySelector('button');
    if (firstAction) {
      firstAction.focus();
    }
  }, [activeMenuData]);

  useEffect(() => {
    if (!openRowMenu || !rowMenuRef.current) {
      return;
    }
    const firstAction = rowMenuRef.current.querySelector('button');
    if (firstAction) {
      firstAction.focus();
    }
  }, [openRowMenu]);

  const openRowActionsMenu = (rowMenuPayload, key) => {
    setOpenRowMenu((current) => {
      if (current?.key === key) {
        return null;
      }
      return { key, ...rowMenuPayload };
    });
  };

  const renderRowActionMenuTrigger = (key, menuPayload, label) => (
    <span className="row-action-menu-trigger-wrap">
      <button
        type="button"
        className="ghost with-icon event-action icon-only-action"
        ref={setRowMenuTriggerRef(key)}
        onClick={() => openRowActionsMenu(menuPayload, key)}
        aria-label={label}
        title={label}
      >
        <FontAwesomeIcon icon={faEllipsisVertical} className="icon" aria-hidden="true" />
      </button>
    </span>
  );

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) {
      return undefined;
    }

    const updateMeasuredMonthHeight = () => {
      const monthRow = table.querySelector('thead tr.month-row');
      if (!monthRow) {
        return;
      }
      const measured = monthRow.getBoundingClientRect().height;
      table.style.setProperty('--computed-month-row-height', `${Math.round(measured)}px`);
    };

    updateMeasuredMonthHeight();
    const rafId = window.requestAnimationFrame(updateMeasuredMonthHeight);
    const ResizeObserverCtor =
      typeof window !== 'undefined' ? window.ResizeObserver : undefined;
    const resizeObserver = ResizeObserverCtor
      ? new ResizeObserverCtor(() => updateMeasuredMonthHeight())
      : null;
    if (resizeObserver) {
      resizeObserver.observe(table);
    }
    window.addEventListener('resize', updateMeasuredMonthHeight);

    return () => {
      window.cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateMeasuredMonthHeight);
    };
  }, [
    board?.days?.length,
    board?.activities?.length,
    board?.subprojects?.length,
    scheduleMode,
    isDetailedZoom,
    isOverviewZoom
  ]);

  const renderCommonHead = () => (
    <thead>
      <tr className="month-row">
        <th className="activity-column schedule-grid-actions-head" rowSpan={2}>
          <div className="schedule-grid-head-actions">
            <button
              type="button"
              className="ghost with-icon schedule-grid-head-action is-activity"
              onClick={onCreateActivity}
              disabled={!selectedProjectId}
            >
              <FontAwesomeIcon icon={faPlus} className="icon" aria-hidden="true" />
              New activity
            </button>
            <button
              type="button"
              className="ghost with-icon schedule-grid-head-action is-subproject"
              onClick={onCreateSubProject}
              disabled={!selectedProjectId}
            >
              <FontAwesomeIcon icon={faPlus} className="icon" aria-hidden="true" />
              New sub-project
            </button>
          </div>
        </th>
        {monthGroups.map((group) => (
          <th key={`${keyPrefix}${group.key}`} className="month-group" colSpan={group.span}>
            <span className="month-label">{group.label}</span>
          </th>
        ))}
      </tr>
      <tr className="day-row">
        {board.days.map((day) => (
          <th
            key={`${keyPrefix}${day.date}`}
            className={isWeekend(day) ? 'is-weekend' : ''}
            title={formatDayTooltip(day.date)}
          >
            {formatDayHeader(day.date, dayHeaderMode)}
          </th>
        ))}
      </tr>
    </thead>
  );

  const renderActivityRows = () => (
    <>
      {(board.subprojects || []).map((subproject, subprojectIndex) => {
        const canDeleteSubProject = (board.subprojects || []).length > 1;
        const collapsed = collapsedSubProjectIds.includes(subproject.id);
        const subProjectPending = isSubProjectActionPending(subproject.id);
        const subProjectDayMap = board.subProjectDayMap?.[String(subproject.id)] || {};
        return (
          <Fragment key={`${keyPrefix}activity-group-${subproject.id}`}>
            <tr
              className="subproject-group-row"
              ref={bindRowRef(`subproject-group-${subproject.id}`)}
            >
              <th>
                <div className="schedule-activity-head">
                  <button
                    type="button"
                    className="ghost with-icon event-action icon-only-action subproject-collapse-toggle"
                    onClick={() => onToggleSubProjectCollapse(subproject.id)}
                    aria-label={collapsed ? 'Expand sub-project' : 'Collapse sub-project'}
                    title={collapsed ? 'Expand sub-project' : 'Collapse sub-project'}
                  >
                    <FontAwesomeIcon
                      icon={collapsed ? faChevronRight : faChevronDown}
                      className="icon"
                      aria-hidden="true"
                    />
                  </button>
                  <span className="activity-label subproject-group-label">
                    <span className="activity-name" title={subproject.name}>
                      {subproject.name}
                    </span>
                  </span>
                  <div className="schedule-row-actions">
                    <button
                      type="button"
                      className="ghost with-icon event-action icon-only-action"
                      onClick={() => onShiftSubProject(subproject.id, -1)}
                      aria-label="Shift sub-project back one day"
                      title="Shift sub-project back one day"
                      disabled={subProjectPending}
                    >
                      <FontAwesomeIcon icon={faArrowLeft} className="icon" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ghost with-icon event-action icon-only-action"
                      onClick={() => onShiftSubProject(subproject.id, 1)}
                      aria-label="Shift sub-project forward one day"
                      title="Shift sub-project forward one day"
                      disabled={subProjectPending}
                    >
                      <FontAwesomeIcon icon={faArrowRight} className="icon" aria-hidden="true" />
                    </button>
                    {renderRowActionMenuTrigger(
                      `${keyPrefix}subproject-group-${subproject.id}-actions`,
                      {
                        items: [
                          {
                            label: 'Edit sub-project',
                            icon: faPen,
                            onSelect: () => onEditSubProject(subproject)
                          },
                          {
                            label: 'Duplicate sub-project',
                            icon: faCopy,
                            disabled: subProjectPending,
                            onSelect: () => onDuplicateSubProject(subproject)
                          },
                          {
                            label: 'Move sub-project up',
                            icon: faArrowUp,
                            disabled: subprojectIndex === 0,
                            onSelect: () => onMoveSubProject(subproject.id, 'up')
                          },
                          {
                            label: 'Move sub-project down',
                            icon: faArrowDown,
                            disabled: subprojectIndex === (board.subprojects || []).length - 1,
                            onSelect: () => onMoveSubProject(subproject.id, 'down')
                          },
                          { type: 'divider' },
                          {
                            label: 'Delete sub-project',
                            icon: faTrash,
                            disabled: !canDeleteSubProject,
                            danger: true,
                            onSelect: () => onDeleteSubProject(subproject)
                          }
                        ]
                      },
                      'Open sub-project actions'
                    )}
                  </div>
                </div>
              </th>
              {board.days.map((day) => (
                <td
                  key={`${keyPrefix}subproject-group-${subproject.id}-${day.date}`}
                  className={`subproject-group-cell ${isWeekend(day) ? 'is-weekend' : ''}`}
                >
                  <span className="subproject-group-cell-fill" />
                </td>
              ))}
            </tr>
            {!collapsed &&
              (board.activities || []).map((activity, activityIndex) => {
              const assignedDays = Object.keys(subProjectDayMap)
                .filter((date) =>
                  (subProjectDayMap[date] || []).some((entry) => entry.activityId === activity.id)
                )
                .sort((left, right) => left.localeCompare(right));
              const { totalAssigned, positionByDay } = buildPositionByDay(assignedDays);
              return (
                <tr
                  key={`${keyPrefix}activity-${subproject.id}-${activity.id}`}
                  ref={bindRowRef(`activity-${subproject.id}-${activity.id}`)}
                  className="subproject-activity-row"
                >
                  <th>
                    <div className="schedule-activity-head">
                      <span className="activity-label subproject-activity-label">
                        <span className="activity-color" style={{ backgroundColor: activity.color }} />
                        <span className="activity-name" title={activity.name}>
                          {activity.name}
                        </span>
                      </span>
                      <div className="schedule-row-actions">
                        {renderRowActionMenuTrigger(
                          `${keyPrefix}activity-${subproject.id}-${activity.id}-actions`,
                          {
                            items: [
                              {
                                label: 'Move activity up',
                                icon: faArrowUp,
                                disabled: activityIndex === 0,
                                onSelect: () => onMoveActivity(activity.id, 'up')
                              },
                              {
                                label: 'Move activity down',
                                icon: faArrowDown,
                                disabled: activityIndex === (board.activities || []).length - 1,
                                onSelect: () => onMoveActivity(activity.id, 'down')
                              },
                              {
                                label: 'Edit activity',
                                icon: faPen,
                                onSelect: () => onEditActivity(activity)
                              },
                              { type: 'divider' },
                              {
                                label: 'Delete activity',
                                icon: faTrash,
                                danger: true,
                                onSelect: () => onDeleteActivity(activity)
                              }
                            ]
                          },
                          'Open activity actions'
                        )}
                      </div>
                    </div>
                  </th>
                  {board.days.map((day) => {
                    const dayEntries = subProjectDayMap[day.date] || [];
                    const filled = dayEntries.some((entry) => entry.activityId === activity.id);
                    const position = filled ? positionByDay[day.date] : null;

                    return (
                      <td
                        key={`${keyPrefix}activity-${subproject.id}-${activity.id}-${day.date}`}
                        className={`activity-day-cell ${isWeekend(day) ? 'is-weekend' : ''}`}
                      >
                        <button
                          type="button"
                          className={`instance-cell ${filled ? 'is-filled' : 'is-empty activity-empty-action'} ${
                            isDetailedZoom ? 'is-detailed' : ''
                          }`}
                          style={
                            filled
                              ? {
                                  '--cell-color': activity.color,
                                  '--cell-text-color': getContrastTextColor(activity.color)
                                }
                              : undefined
                          }
                          onClick={() => onCellClick(activity.id, day.date, filled, subproject.id)}
                          aria-label={`${subproject.name} ${activity.name} on ${day.date}`}
                          title={filled ? 'Delete activity instance' : 'Add activity instance'}
                        >
                          {filled ? (
                            isOverviewZoom ? (
                              ''
                            ) : isDetailedZoom ? (
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
                            <>
                              <FontAwesomeIcon icon={faPlus} className="icon" aria-hidden="true" />
                              {!isOverviewZoom && 'Add'}
                            </>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );

  const renderSubProjectRows = () => (
    <>
      {(board.subprojects || []).map((subproject, index) => {
        const canDeleteSubProject = (board.subprojects || []).length > 1;
        const subProjectPending = isSubProjectActionPending(subproject.id);
        const subProjectDayMap = board.subProjectDayMap?.[String(subproject.id)] || {};
        const activityPositionMetaById =
          buildActivityPositionMetaBySubProjectDayMap(subProjectDayMap);

        return (
          <tr
            key={`${keyPrefix}subproject-${subproject.id}`}
            ref={bindRowRef(`subproject-${subproject.id}`)}
            className="subproject-row"
          >
            <th>
              <div className="schedule-activity-head">
                <span className="activity-label">
                  <span className="activity-name" title={subproject.name}>
                    {subproject.name}
                  </span>
                </span>
                <div className="schedule-row-actions">
                  <button
                    type="button"
                    className="ghost with-icon event-action icon-only-action"
                    onClick={() => onShiftSubProject(subproject.id, -1)}
                    aria-label="Shift sub-project back one day"
                    title="Shift sub-project back one day"
                    disabled={subProjectPending}
                  >
                    <FontAwesomeIcon icon={faArrowLeft} className="icon" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ghost with-icon event-action icon-only-action"
                    onClick={() => onShiftSubProject(subproject.id, 1)}
                    aria-label="Shift sub-project forward one day"
                    title="Shift sub-project forward one day"
                    disabled={subProjectPending}
                  >
                    <FontAwesomeIcon icon={faArrowRight} className="icon" aria-hidden="true" />
                  </button>
                  {renderRowActionMenuTrigger(
                    `${keyPrefix}subproject-${subproject.id}-actions`,
                    {
                      items: [
                        {
                          label: 'Edit sub-project',
                          icon: faPen,
                          onSelect: () => onEditSubProject(subproject)
                        },
                        {
                          label: 'Duplicate sub-project',
                          icon: faCopy,
                          disabled: subProjectPending,
                          onSelect: () => onDuplicateSubProject(subproject)
                        },
                        {
                          label: 'Move sub-project up',
                          icon: faArrowUp,
                          disabled: index === 0,
                          onSelect: () => onMoveSubProject(subproject.id, 'up')
                        },
                        {
                          label: 'Move sub-project down',
                          icon: faArrowDown,
                          disabled: index === (board.subprojects || []).length - 1,
                          onSelect: () => onMoveSubProject(subproject.id, 'down')
                        },
                        { type: 'divider' },
                        {
                          label: 'Delete sub-project',
                          icon: faTrash,
                          disabled: !canDeleteSubProject,
                          danger: true,
                          onSelect: () => onDeleteSubProject(subproject)
                        }
                      ]
                    },
                    'Open sub-project actions'
                  )}
                </div>
              </div>
            </th>
            {board.days.map((day) => {
              const entries = subProjectDayMap?.[day.date] || [];
              const occupied = new Set(entries.map((entry) => entry.activityId));
              const availableActivities = (board.activities || []).filter(
                (activity) => !occupied.has(activity.id)
              );
              const occupiedActivities = entries
                .map((entry) => ({
                  activityId: entry.activityId,
                  activity: activityById[entry.activityId]
                }))
                .filter((entry) => Boolean(entry.activity));
              const hasExistingEntries = occupiedActivities.length > 0;
              const menuOpen =
                openAddMenu?.subProjectId === subproject.id && openAddMenu?.day === day.date;

              return (
                <td
                  key={`${keyPrefix}subproject-${subproject.id}-${day.date}`}
                  className={`subproject-day-cell ${isWeekend(day) ? 'is-weekend' : ''} ${
                    menuOpen ? 'is-menu-open' : ''
                  }`}
                >
                  <div className="subproject-add-menu-wrap">
                    <div className="subproject-cell-stack">
                      {occupiedActivities.map(({ activityId, activity }) => {
                        const positionMeta = activityPositionMetaById[String(activityId)];
                        const position = positionMeta?.positionByDay?.[day.date];
                        const compactValue =
                          typeof position === 'number' && positionMeta?.totalAssigned
                            ? `${position}/${positionMeta.totalAssigned}`
                            : '';
                        return (
                          <button
                            key={`${keyPrefix}instance-${subproject.id}-${day.date}-${activityId}`}
                            type="button"
                            className={`subproject-instance-block ${
                              !isDetailedZoom && !isOverviewZoom ? 'is-compact' : ''
                            }`}
                            style={{
                              '--cell-color': activity.color,
                              '--cell-text-color': getContrastTextColor(activity.color)
                            }}
                            onClick={() =>
                              setOpenAddMenu({ subProjectId: subproject.id, day: day.date })
                            }
                            aria-label={`${subproject.name} ${activity.name} on ${day.date}`}
                            title={activity.name}
                          >
                            {isOverviewZoom ? '' : isDetailedZoom ? activity.name : compactValue}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="instance-cell is-empty subproject-hover-action"
                      ref={setMenuTriggerRef(`${subproject.id}:${day.date}`)}
                      onClick={() =>
                        setOpenAddMenu((current) =>
                          current?.subProjectId === subproject.id && current?.day === day.date
                            ? null
                            : { subProjectId: subproject.id, day: day.date }
                        )
                      }
                      title={hasExistingEntries ? 'Edit cell activities' : 'Add activity instance'}
                      aria-label={`Add instance for ${subproject.name} on ${day.date}`}
                    >
                      <FontAwesomeIcon
                        icon={hasExistingEntries ? faPen : faPlus}
                        className="icon"
                        aria-hidden="true"
                      />
                      {!isOverviewZoom && (hasExistingEntries ? 'Edit' : 'Add')}
                    </button>
                  </div>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );

  return (
    <>
      <table className="schedule-grid" ref={tableRef}>
        <colgroup>
          <col className="activity-column-col" />
          {board.days.map((day) => (
            <col
              key={`${keyPrefix}col-${day.date}`}
              className={`day-column-col ${isWeekend(day) ? 'is-weekend-col' : ''}`}
            />
          ))}
        </colgroup>
        {renderCommonHead()}
        <tbody>{scheduleMode === 'activity' ? renderActivityRows() : renderSubProjectRows()}</tbody>
      </table>
      {activeMenuData &&
        createPortal(
          <div
            ref={addMenuRef}
            className="subproject-add-menu"
            role="menu"
            style={{
              position: 'fixed',
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`
            }}
          >
            {activeMenuData.occupiedActivities.length > 0 &&
              activeMenuData.occupiedActivities.map(({ activityId, activity }) => (
                <button
                  key={`${keyPrefix}delete-choice-${activeMenuData.subProjectId}-${activeMenuData.day}-${activityId}`}
                  type="button"
                  className="subproject-add-choice is-delete"
                  aria-label={`Delete ${activity.name}`}
                  onClick={() => {
                    setOpenAddMenu(null);
                    onSubProjectDeleteInstance(activeMenuData.subProjectId, activeMenuData.day, activityId);
                  }}
                >
                  <FontAwesomeIcon icon={faTrash} className="icon" aria-hidden="true" />
                  <span className="activity-color" style={{ backgroundColor: activity.color }} />
                  {activity.name}
                </button>
              ))}
            {activeMenuData.occupiedActivities.length > 0 &&
              activeMenuData.availableActivities.length > 0 && (
                <span className="subproject-add-menu-divider" aria-hidden="true" />
              )}
            {activeMenuData.availableActivities.length === 0 &&
            activeMenuData.occupiedActivities.length === 0 ? (
              <span className="subproject-add-menu-empty">No available activities</span>
            ) : (
              activeMenuData.availableActivities.map((activity) => (
                <button
                  key={`${keyPrefix}add-choice-${activeMenuData.subProjectId}-${activeMenuData.day}-${activity.id}`}
                  type="button"
                  className="subproject-add-choice"
                  onClick={() => {
                    setOpenAddMenu(null);
                    onSubProjectAddInstance(activeMenuData.subProjectId, activeMenuData.day, activity.id);
                  }}
                >
                  <FontAwesomeIcon icon={faPlus} className="icon" aria-hidden="true" />
                  <span className="activity-color" style={{ backgroundColor: activity.color }} />
                  {activity.name}
                </button>
              ))
            )}
          </div>,
          document.body
        )}
      {openRowMenu &&
        createPortal(
          <div
            ref={rowMenuRef}
            className="row-action-menu"
            role="menu"
            style={{
              position: 'fixed',
              top: `${rowMenuPosition.top}px`,
              left: `${rowMenuPosition.left}px`
            }}
          >
            {(openRowMenu.items || []).map((item, index) => {
              if (item?.type === 'divider') {
                return (
                  <span
                    key={`${openRowMenu.key}-divider-${index}`}
                    className="row-action-menu-divider"
                    aria-hidden="true"
                  />
                );
              }
              return (
                <button
                  key={`${openRowMenu.key}-item-${index}-${item.label}`}
                  type="button"
                  className={`row-action-menu-item ${item.danger ? 'is-danger' : ''}`}
                  disabled={Boolean(item.disabled)}
                  onClick={() => {
                    setOpenRowMenu(null);
                    item.onSelect?.();
                  }}
                >
                  {item.icon && <FontAwesomeIcon icon={item.icon} className="icon" aria-hidden="true" />}
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
