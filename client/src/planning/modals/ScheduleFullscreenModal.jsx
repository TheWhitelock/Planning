import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExcel, faXmark } from '@fortawesome/free-solid-svg-icons';
import ScheduleGrid from '../ScheduleGrid.jsx';
import ScheduleLegend from '../ScheduleLegend.jsx';

export default function ScheduleFullscreenModal({
  show,
  onClose,
  modeOptions,
  scheduleMode,
  onScheduleModeChange,
  zoomOptions,
  scheduleZoom,
  onScheduleZoomChange,
  selectedProjectId,
  board,
  onOpenExport,
  isOverviewZoom,
  fullscreenDayWidth,
  weekendWidthFactor,
  monthGroups,
  dayHeaderMode,
  isDetailedZoom,
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
  collapsedSubProjectIds,
  isSubProjectActionPending,
  bindRowRef
}) {
  if (!show) {
    return null;
  }

  return (
    <div className="modal-backdrop schedule-fullscreen-backdrop" onClick={onClose}>
      <div className="schedule-fullscreen-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Schedule</h2>
          </div>
          <div className="projects-actions">
            <div className="mode-toggle" role="group" aria-label="Schedule mode">
              {modeOptions.map((option) => (
                <button
                  key={`fullscreen-mode-${option}`}
                  type="button"
                  className={`mode-option ${scheduleMode === option ? 'is-active' : ''}`}
                  onClick={() => onScheduleModeChange(option)}
                >
                  {option === 'activity' ? 'Activity mode' : 'Sub-project mode'}
                </button>
              ))}
            </div>
            <div className="zoom-toggle" role="group" aria-label="Schedule zoom level">
              {zoomOptions.map((option) => (
                <button
                  key={`fullscreen-zoom-${option}`}
                  type="button"
                  className={`zoom-option ${scheduleZoom === option ? 'is-active' : ''}`}
                  onClick={() => onScheduleZoomChange(option)}
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
                onClick={onOpenExport}
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
              onClick={onClose}
              aria-label="Close fullscreen schedule"
            >
              <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
            </button>
          </div>
        </div>
        {!board?.project ? (
          <p className="empty-state">Select a project to view its timeline.</p>
        ) : (
          <div className="schedule-pane is-fullscreen">
            <div
              className={`schedule-scroll fullscreen ${isOverviewZoom ? 'mode-overview' : ''}`}
              style={{
                '--day-col-width': `${fullscreenDayWidth}px`,
                '--weekend-width-factor': weekendWidthFactor
              }}
            >
              <ScheduleGrid
                board={board}
                scheduleMode={scheduleMode}
                keyPrefix="fullscreen-"
                monthGroups={monthGroups}
                dayHeaderMode={dayHeaderMode}
                isDetailedZoom={isDetailedZoom}
                isOverviewZoom={isOverviewZoom}
                isWeekend={isWeekend}
                formatDayHeader={formatDayHeader}
                formatDayTooltip={formatDayTooltip}
                onMoveActivity={onMoveActivity}
                onEditActivity={onEditActivity}
                onDeleteActivity={onDeleteActivity}
                onCellClick={onCellClick}
                onCreateActivity={onCreateActivity}
                onMoveSubProject={onMoveSubProject}
                onEditSubProject={onEditSubProject}
                onDeleteSubProject={onDeleteSubProject}
                onDuplicateSubProject={onDuplicateSubProject}
                onShiftSubProject={onShiftSubProject}
                onToggleSubProjectCollapse={onToggleSubProjectCollapse}
                onCreateSubProject={onCreateSubProject}
                onSubProjectAddInstance={onSubProjectAddInstance}
                onSubProjectDeleteInstance={onSubProjectDeleteInstance}
                selectedProjectId={selectedProjectId}
                collapsedSubProjectIds={collapsedSubProjectIds}
                isSubProjectActionPending={isSubProjectActionPending}
                bindRowRef={bindRowRef}
              />
            </div>
            <ScheduleLegend activities={board.activities || []} />
          </div>
        )}
      </div>
    </div>
  );
}
