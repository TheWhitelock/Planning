import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPen, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';

export default function ProjectModal({
  show,
  isEditingProject,
  projectForm,
  onFieldChange,
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
            <h2>{isEditingProject ? 'Edit project' : 'Create project'}</h2>
            <p className="card-subtitle">
              Set start and end date or start and length. The third value is derived.
            </p>
          </div>
          <button type="button" className="ghost with-icon" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} className="icon" aria-hidden="true" />
          </button>
        </div>
        <form className="project-form" onSubmit={onSubmit}>
          <div className="project-form-row project-form-row-single">
            <label>
              Project name
              <input
                value={projectForm.name}
                placeholder="Enter a name for the project..."
                onChange={(event) => onFieldChange('name', event.target.value)}
                required
              />
            </label>
          </div>
          <div className="project-form-row project-form-row-dates">
            <label>
              Start date
              <input
                type="date"
                value={projectForm.startDate}
                onChange={(event) => onFieldChange('startDate', event.target.value)}
                required
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={projectForm.endDate}
                min={projectForm.startDate || undefined}
                onChange={(event) => onFieldChange('endDate', event.target.value)}
              />
            </label>
            <label>
              Length (days)
              <input
                type="number"
                placeholder="Enter the length of the project..."
                min="1"
                step="1"
                value={projectForm.lengthDays}
                onChange={(event) => onFieldChange('lengthDays', event.target.value)}
              />
            </label>
          </div>
          {!isEditingProject && (
            <div className="project-form-row project-form-row-single">
              <label>
                First sub-project name
                <input
                  value={projectForm.subProjectName}
                  placeholder="Enter a name for the first sub-project..."
                  onChange={(event) => onFieldChange('subProjectName', event.target.value)}
                />
              </label>
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary with-icon">
              <FontAwesomeIcon
                icon={isEditingProject ? faPen : faPlus}
                className="icon"
                aria-hidden="true"
              />
              {isEditingProject ? 'Save project' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
