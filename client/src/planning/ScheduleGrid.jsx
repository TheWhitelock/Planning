import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowDown, faArrowUp, faPen, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';

const buildPositionByDay = (instanceMap) => {
  const assignedDays = Object.keys(instanceMap).sort((left, right) => left.localeCompare(right));
  const totalAssigned = assignedDays.length;
  const positionByDay = assignedDays.reduce((acc, date, index) => {
    acc[date] = index + 1;
    return acc;
  }, {});
  return { totalAssigned, positionByDay };
};

export default function ScheduleGrid({
  board,
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
  selectedProjectId,
  bindRowRef
}) {
  return (
    <table className="schedule-grid">
      <colgroup>
        <col className="activity-column-col" />
        {board.days.map((day) => (
          <col
            key={`${keyPrefix}col-${day.date}`}
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
      <tbody>
        {board.activities.map((activity, index) => {
          const instanceMap = board.instanceMap?.[String(activity.id)] || {};
          const { totalAssigned, positionByDay } = buildPositionByDay(instanceMap);
          return (
            <tr key={`${keyPrefix}${activity.id}`} ref={bindRowRef(activity.id)}>
              <th>
                <div className="schedule-activity-head">
                  <span className="activity-label">
                    <span className="activity-color" style={{ backgroundColor: activity.color }} />
                    <span className="activity-name" title={activity.name}>
                      {activity.name}
                    </span>
                  </span>
                  <div className="schedule-row-actions">
                    <button
                      type="button"
                      className="ghost with-icon event-action icon-only-action"
                      onClick={() => onMoveActivity(activity.id, 'up')}
                      disabled={index === 0}
                      aria-label="Move activity up"
                      title="Move activity up"
                    >
                      <FontAwesomeIcon icon={faArrowUp} className="icon" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ghost with-icon event-action icon-only-action"
                      onClick={() => onMoveActivity(activity.id, 'down')}
                      disabled={index === board.activities.length - 1}
                      aria-label="Move activity down"
                      title="Move activity down"
                    >
                      <FontAwesomeIcon icon={faArrowDown} className="icon" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ghost with-icon event-action icon-only-action"
                      onClick={() => onEditActivity(activity)}
                      aria-label="Edit activity"
                      title="Edit activity"
                    >
                      <FontAwesomeIcon icon={faPen} className="icon" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ghost with-icon event-action icon-only-action"
                      onClick={() => onDeleteActivity(activity)}
                      aria-label="Delete activity"
                      title="Delete activity"
                    >
                      <FontAwesomeIcon icon={faTrash} className="icon" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </th>
              {board.days.map((day) => {
                const filled = Boolean(instanceMap[day.date]);
                const position = filled ? positionByDay[day.date] : null;
                return (
                  <td
                    key={`${keyPrefix}${activity.id}-${day.date}`}
                    className={isWeekend(day) ? 'is-weekend' : ''}
                  >
                    <button
                      type="button"
                      className={`instance-cell ${filled ? 'is-filled' : 'is-empty'} ${
                        isDetailedZoom ? 'is-detailed' : ''
                      }`}
                      style={filled ? { '--cell-color': activity.color } : undefined}
                      onClick={() => onCellClick(activity.id, day.date, filled)}
                      aria-label={`${activity.name} on ${day.date}`}
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
                      ) : isOverviewZoom ? (
                        '+'
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
        <tr className="new-activity-row">
          <th>
            <button
              type="button"
              className="ghost with-icon new-activity-inline"
              onClick={onCreateActivity}
              disabled={!selectedProjectId}
            >
              <FontAwesomeIcon icon={faPlus} className="icon" aria-hidden="true" />
              New activity
            </button>
          </th>
          {board.days.map((day) => (
            <td key={`${keyPrefix}new-activity-${day.date}`} className={isWeekend(day) ? 'is-weekend' : ''}>
              <span className="unassigned-cell" />
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
