import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExcel, faXmark } from '@fortawesome/free-solid-svg-icons';

export default function ExportModal({
  show,
  board,
  scheduleMode = 'activity',
  scheduleZoom = 'standard',
  modeOptions = [],
  zoomOptions = [],
  exportDeselectedActivityIds,
  includeUnusedActivitiesInExport = true,
  onToggleActivity,
  onScheduleModeChange,
  onScheduleZoomChange,
  onToggleIncludeUnusedActivities,
  onClose,
  onExport
}) {
  if (!show) {
    return null;
  }

  const selectedCount =
    (board?.activities?.length || 0) - (exportDeselectedActivityIds?.length || 0);
  const modeLabel = scheduleMode === 'activity' ? 'activity mode' : 'sub-project mode';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Export</h2>
            <p className="card-subtitle">
              Configure the export layout, then choose which activities to include.
            </p>
          </div>
          <button type="button" className="ghost with-icon" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
          </button>
        </div>
        <section className="export-settings-card">
          <div className="export-settings-row">
            <span className="export-settings-label">Schedule mode</span>
            <div className="mode-toggle" role="group" aria-label="Export schedule mode">
              {modeOptions.map((option) => (
                <button
                  key={`export-mode-${option}`}
                  type="button"
                  className={`mode-option ${scheduleMode === option ? 'is-active' : ''}`}
                  onClick={() => onScheduleModeChange?.(option)}
                >
                  {option === 'activity' ? 'Activity mode' : 'Sub-project mode'}
                </button>
              ))}
            </div>
          </div>
          <div className="export-settings-row">
            <span className="export-settings-label">Viewing mode</span>
            <div className="zoom-toggle" role="group" aria-label="Export viewing mode">
              {zoomOptions.map((option) => (
                <button
                  key={`export-zoom-${option}`}
                  type="button"
                  className={`zoom-option ${scheduleZoom === option ? 'is-active' : ''}`}
                  onClick={() => onScheduleZoomChange?.(option)}
                >
                  {option === 'detailed' ? 'Detailed' : option === 'standard' ? 'Standard' : 'Overview'}
                </button>
              ))}
            </div>
          </div>
          <div className="export-settings-row">
            <span className="export-settings-label">Unused activities</span>
            <div className="mode-toggle" role="group" aria-label="Export unused activities option">
              <button
                type="button"
                className={`mode-option ${includeUnusedActivitiesInExport ? 'is-active' : ''}`}
                onClick={() => onToggleIncludeUnusedActivities?.(true)}
              >
                Include
              </button>
              <button
                type="button"
                className={`mode-option ${!includeUnusedActivitiesInExport ? 'is-active' : ''}`}
                onClick={() => onToggleIncludeUnusedActivities?.(false)}
              >
                Exclude
              </button>
            </div>
          </div>
        </section>
        {/* <p className="card-subtitle">
          Select activities to include in the export ({selectedCount} selected):
        </p>
        <div className="export-activity-list">
          {(board?.activities || []).map((activity) => {
            const checked = !exportDeselectedActivityIds.includes(activity.id);
            return (
              <label
                key={`export-${activity.id}`}
                className={`export-activity-item ${checked ? 'is-selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggleActivity(activity.id, event.target.checked)}
                />
                <span className="activity-label">
                  <span className="activity-color" style={{ backgroundColor: activity.color }} />
                  <span>{activity.name}</span>
                </span>
              </label>
            );
          })}
        </div> */}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <span
            className="button-tooltip-wrap"
            title={
              selectedCount < 1
                ? 'Select at least one activity to export.'
                : 'Export selected activities to Excel'
            }
          >
            <button type="button" className="primary with-icon" onClick={onExport} disabled={selectedCount < 1}>
              <FontAwesomeIcon icon={faFileExcel} className="icon" aria-hidden="true" />
              Export .xlsx
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
