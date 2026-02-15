import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPen, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';

export default function ActivityModal({
  show,
  isEditingActivity,
  activityForm,
  onChange,
  onClose,
  onSubmit
}) {
  if (!show) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{isEditingActivity ? 'Edit activity' : 'Create activity'}</h2>
            <p className="card-subtitle">
              Set a unique activity name and color for the selected project.
            </p>
          </div>
          <button type="button" className="ghost with-icon" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
          </button>
        </div>
        <form className="project-form" onSubmit={onSubmit}>
          <label>
            Activity name
            <input
              value={activityForm.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="Enter activity name..."
              required
            />
          </label>
          <div className="field-group">
            <span className="field-label">Color</span>
            <input
              type="color"
              value={activityForm.color}
              onChange={(event) => onChange('color', event.target.value)}
              required
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>
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
  );
}
