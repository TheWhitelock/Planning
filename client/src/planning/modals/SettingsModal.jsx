import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';

export default function SettingsModal({
  show,
  settingsStatus,
  onClose,
  onOpenDataFolder,
  onExportBackup
}) {
  if (!show) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-popover" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Desktop tools</h2>
            <p className="card-subtitle">Open local data folder and export a backup.</p>
          </div>
          <button type="button" className="ghost with-icon" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
          </button>
        </div>
        <div className="settings-actions">
          <button type="button" className="ghost" onClick={onOpenDataFolder}>
            Open data folder
          </button>
          <button type="button" className="primary" onClick={onExportBackup}>
            Export backup
          </button>
        </div>
        {settingsStatus && <p className="settings-status">{settingsStatus}</p>}
      </div>
    </div>
  );
}
