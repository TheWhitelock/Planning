import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExcel, faXmark } from '@fortawesome/free-solid-svg-icons';

export default function ExportModal({
  show,
  board,
  exportDeselectedActivityIds,
  onToggleActivity,
  onClose,
  onExport
}) {
  if (!show) {
    return null;
  }

  const selectedCount =
    (board?.activities?.length || 0) - (exportDeselectedActivityIds?.length || 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Export</h2>
            <p className="card-subtitle">Select which activities to include in the Excel export.</p>
          </div>
          <button type="button" className="ghost with-icon" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
          </button>
        </div>
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
        </div>
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
