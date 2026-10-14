const pct = (v) => `${(v * 100).toFixed(1)}%`;

export default function Comparison({ rows }) {
  const best = Math.min(...rows.map((r) => r.robustness.meanCost));
  return (
    <div className="comparison">
      <table>
        <thead>
          <tr>
            <th>Метод</th>
            <th>Середній штраф</th>
            <th>CVaR 90%</th>
            <th>P(збій приладу)</th>
            <th>P(вимкнення навантажень)</th>
            <th>Час, мс</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.algorithm} className={r.robustness.meanCost === best ? 'best' : ''}>
              <td>{r.algorithmName}</td>
              <td>{r.robustness.meanCost.toFixed(1)}</td>
              <td>{r.robustness.cvarCost.toFixed(1)}</td>
              <td>{pct(r.robustness.failureProbability)}</td>
              <td>{pct(r.robustness.shedProbability)}</td>
              <td>{r.elapsedMs.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
