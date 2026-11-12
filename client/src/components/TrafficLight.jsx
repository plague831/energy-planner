import { trafficLight } from '../trafficLight.js';

const ORDER = { go: 0, wait: 1, stop: 2 };
const MARK = { go: '✅', wait: '⚠️', stop: '⛔' };

export default function TrafficLight({ household, result, now }) {
  const items = trafficLight(household, result, now).sort((x, y) => ORDER[x.status] - ORDER[y.status]);
  if (!items.length) return null;
  return (
    <ul className="traffic-light">
      {items.map((it) => (
        <li key={it.id} className={`tl-item ${it.status}`}>
          <span className="tl-icon" aria-hidden="true">
            {it.icon}
          </span>
          <div className="tl-body">
            <div className="tl-name">{it.name}</div>
            <div className="tl-detail">{it.detail}</div>
          </div>
          <div className="tl-verdict">
            <span aria-hidden="true">{MARK[it.status]}</span> {it.title}
          </div>
        </li>
      ))}
    </ul>
  );
}
