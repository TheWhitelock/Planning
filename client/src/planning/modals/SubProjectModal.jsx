import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPen, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';

export default function SubProjectModal({
  show,
  isEditingSubProject,
  subProjectForm,
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
            <h2>{isEditingSubProject ? 'Edit sub-project' : 'Create sub-project'}</h2>
            <p className="card-subtitle">Create the project partition used for grouped schedule mode.</p>
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
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary with-icon">
              <FontAwesomeIcon
                icon={isEditingSubProject ? faPen : faPlus}
                className="icon"
                aria-hidden="true"
              />
              {isEditingSubProject ? 'Save sub-project' : 'Create sub-project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
