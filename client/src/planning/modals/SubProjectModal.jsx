import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faPen, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';

export default function SubProjectModal({
  show,
  mode = 'create',
  isEditingSubProject,
  subProjectForm,
  activities = [],
  duplicateDeselectedActivityIds = [],
  onChange,
  onToggleDuplicateActivity,
  onClose,
  onSubmit
}) {
  if (!show) {
    return null;
  }

  const isDuplicateMode = mode === 'duplicate';
  const isEditMode = mode === 'edit' || (mode !== 'duplicate' && isEditingSubProject);
  const selectedCount = activities.length - duplicateDeselectedActivityIds.length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>
              {isDuplicateMode
                ? 'Duplicate sub-project'
                : isEditMode
                  ? 'Edit sub-project'
                  : 'Create sub-project'}
            </h2>
            <p className="card-subtitle">
              {isDuplicateMode
                ? 'Choose the new sub-project name and activities to copy instances from.'
                : 'Create the project partition used for grouped schedule mode.'}
            </p>
          </div>
          <button type="button" className="ghost with-icon" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
          </button>
        </div>
        <form className="project-form" onSubmit={onSubmit}>
          <label>
            Sub-project name
            <input
              value={subProjectForm.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="Enter sub-project name..."
              required
            />
          </label>
          {isDuplicateMode && (
            <label>
              Activities to duplicate the instances of
              <div className="export-activity-list">
                {activities.map((activity) => {
                  const checked = !duplicateDeselectedActivityIds.includes(activity.id);
                  return (
                    <label
                      key={`duplicate-activity-${activity.id}`}
                      className={`export-activity-item ${checked ? 'is-selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          onToggleDuplicateActivity?.(activity.id, event.target.checked)
                        }
                      />
                      <span className="activity-label">
                        <span className="activity-color" style={{ backgroundColor: activity.color }} />
                        <span>{activity.name}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </label>
          )}
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary with-icon"
              disabled={isDuplicateMode && activities.length > 0 && selectedCount < 1}
            >
              <FontAwesomeIcon
                icon={isDuplicateMode ? faCopy : isEditMode ? faPen : faPlus}
                className="icon"
                aria-hidden="true"
              />
              {isDuplicateMode
                ? 'Duplicate sub-project'
                : isEditMode
                  ? 'Save sub-project'
                  : 'Create sub-project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
