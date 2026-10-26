import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

const API_URL = 'https://promptgate-api.ekansh-gupta.workers.dev';

interface PromptResult {
  id: number;
  prompt_name: string;
  prompt_path: string;
  model: string;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  critical_failures: number;
  flaky_count: number;
  base_pass_rate: number;
  head_pass_rate: number;
  pass_rate_delta: number;
  total_cost_base: number;
  total_cost_head: number;
  avg_latency_base: number;
  avg_latency_head: number;
}

export function RunDetail() {
  const { owner, name, runId } = useParams();
  const [results, setResults] = useState<PromptResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRunDetail();
  }, [runId]);

  const fetchRunDetail = async () => {
    try {
      const token = localStorage.getItem('promptgate_session');
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(
        `${API_URL}/api/repos/${owner}/${name}/runs/${runId}/details`,
        { headers }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch run details');
      }

      const data = await response.json();
      setResults(data.prompts || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading run details...</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <Link to={`/repos/${owner}/${name}`} style={{ color: '#6e6e73' }}>
          ← Back to runs
        </Link>
      </div>
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        Run #{runId}
      </h1>
      {results.length === 0 ? (
        <div className="card">
          <p style={{ color: '#6e6e73' }}>No details available for this run.</p>
        </div>
      ) : (
        results.map((prompt) => (
          <div key={prompt.id} className="card">
            <h2 style={{ marginBottom: '16px' }}>{prompt.prompt_name}</h2>
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Base</th>
                  <th>Head</th>
                  <th>Delta</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Pass Rate</td>
                  <td>{(prompt.base_pass_rate * 100).toFixed(1)}%</td>
                  <td>{(prompt.head_pass_rate * 100).toFixed(1)}%</td>
                  <td>
                    <span
                      style={{
                        color:
                          prompt.pass_rate_delta < -0.05
                            ? '#c41e3a'
                            : prompt.pass_rate_delta > 0.05
                            ? '#0f8043'
                            : '#6e6e73',
                      }}
                    >
                      {prompt.pass_rate_delta >= 0 ? '+' : ''}
                      {(prompt.pass_rate_delta * 100).toFixed(1)}%
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Avg Latency</td>
                  <td>{prompt.avg_latency_base.toFixed(0)}ms</td>
                  <td>{prompt.avg_latency_head.toFixed(0)}ms</td>
                  <td>
                    {(prompt.avg_latency_head - prompt.avg_latency_base).toFixed(
                      0
                    )}
                    ms
                  </td>
                </tr>
                <tr>
                  <td>Cost</td>
                  <td>${prompt.total_cost_base.toFixed(4)}</td>
                  <td>${prompt.total_cost_head.toFixed(4)}</td>
                  <td>
                    $
                    {(prompt.total_cost_head - prompt.total_cost_base).toFixed(4)}
                  </td>
                </tr>
              </tbody>
            </table>
            {prompt.critical_failures > 0 && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: '#fee',
                  borderRadius: '8px',
                  color: '#c41e3a',
                }}
              >
                ⚠️ {prompt.critical_failures} critical failure(s)
              </div>
            )}
            {prompt.flaky_count > 0 && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: '#fff4e6',
                  borderRadius: '8px',
                  color: '#b76e00',
                }}
              >
                🎲 {prompt.flaky_count} flaky case(s) detected
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
