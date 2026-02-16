import { useState } from 'react';

export default function ScheduleLegend({ activities = [] }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!activities.length) {
    return null;
  }

  if (collapsed) {
    return (
      <button
        type="button"
        className="schedule-legend-toggle"
        onClick={() => setCollapsed(false)}
        aria-label="Show activity legend"
      >
        Show legend
      </button>
    );
  }

  return (
    <aside className="schedule-legend" aria-label="Activity legend">
      <button
        type="button"
        className="schedule-legend-hide"
        onClick={() => setCollapsed(true)}
        aria-label="Hide activity legend"
        title="Hide legend"
      >
        Hide
      </button>
      <p className="schedule-legend-title">Legend</p>
      <div className="schedule-legend-list">
        {activities.map((activity) => (
          <div key={activity.id} className="schedule-legend-item" title={activity.name}>
            <span className="activity-color" style={{ backgroundColor: activity.color }} />
            <span className="schedule-legend-name">{activity.name}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
