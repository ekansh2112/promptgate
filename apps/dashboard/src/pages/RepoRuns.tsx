import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

const API_URL = 'https://promptgate-api.ekansh-gupta.workers.dev';

interface Run {
  id: number;
  pr_number: number | null;
  base_ref: string;
  head_ref: string;
  passed: number;
  total_cost: number;
  timestamp: string;
  created_at: number;
}

export function RepoRuns() {
  const { owner, name } = useParams<{ owner: string; name: string }>();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuns();
  }, [owner, name]);

  const fetchRuns = async () => {
    try {
      const token = localStorage.getItem('promptgate_session');
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(
        `${API_URL}/api/repos/${owner}/${name}/runs`,
        { headers }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch runs');
      }

      const data = await response.json();
      setRuns(data.runs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading runs...</div>;
  }

  if (error) {
    return <div className="card" style={{ color: '#c41e3a' }}>{error}</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <Link to="/repos" style={{ color: '#6e6e73' }}>
          ← Back to repositories
        </Link>
      </div>
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        {owner}/{name}
      </h1>
      {runs.length === 0 ? (
        <div className="card">
          <p style={{ color: '#6e6e73' }}>No runs yet for this repository.</p>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>PR</th>
                <th>Base</th>
                <th>Head</th>
                <th>Cost</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <span
                      className={
                        run.passed ? 'badge badge-success' : 'badge badge-error'
                      }
                    >
                      {run.passed ? '✓ Passed' : '✗ Failed'}
                    </span>
                  </td>
                  <td>{run.pr_number ? `#${run.pr_number}` : '—'}</td>
                  <td>
                    <code>{run.base_ref.slice(0, 7)}</code>
                  </td>
                  <td>
                    <code>{run.head_ref.slice(0, 7)}</code>
                  </td>
                  <td>${run.total_cost.toFixed(4)}</td>
                  <td>{new Date(run.timestamp).toLocaleString()}</td>
                  <td>
                    <Link
                      to={`/repos/${owner}/${name}/runs/${run.id}`}
                      style={{ color: '#0071e3', fontWeight: '500' }}
                    >
                      Details →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
