import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

const API_URL = 'https://promptgate-api.ekansh-gupta.workers.dev';

interface CaseResult {
  id: number;
  case_name: string | null;
  inputs: Record<string, any>;
  critical: number;
  base_output: string;
  head_output: string;
  judge_result: {
    preferredVersion: string;
    reasoning: string;
    confidence: number;
  } | null;
  flaky: number;
}

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
  cases?: CaseResult[];
}

interface TrendPoint {
  run_id: number;
  timestamp: string;
  head_pass_rate: number;
}

export function RunDetail() {
  const { owner, name, runId } = useParams();
  const [results, setResults] = useState<PromptResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [trends, setTrends] = useState<Record<string, TrendPoint[]>>({});
  const [calibrationAgreement, setCalibrationAgreement] = useState<number | null>(
    null
  );
  const [calibrationSampleSize, setCalibrationSampleSize] = useState<
    number | null
  >(null);

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
      if (data.calibrationAgreement != null) {
        setCalibrationAgreement(data.calibrationAgreement);
        setCalibrationSampleSize(data.calibrationSampleSize ?? null);
      } else if (data.run?.calibration_agreement != null) {
        setCalibrationAgreement(data.run.calibration_agreement);
        setCalibrationSampleSize(data.run.calibration_sample_size ?? null);
      }

      // Fetch trends for each prompt
      const trendData: Record<string, TrendPoint[]> = {};
      for (const prompt of data.prompts || []) {
        const trendResponse = await fetch(
          `${API_URL}/api/repos/${owner}/${name}/prompts/${encodeURIComponent(
            prompt.prompt_name
          )}/trend`,
          { headers }
        );
        if (trendResponse.ok) {
          const trend = await trendResponse.json();
          trendData[prompt.prompt_name] = trend.dataPoints || [];
        }
      }
      setTrends(trendData);
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
      {calibrationAgreement != null && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <strong>Judge Calibration:</strong>{' '}
          {calibrationAgreement.toFixed(1)}% agreement
          {calibrationSampleSize != null
            ? ` (${calibrationSampleSize} labeled cases)`
            : ''}
        </div>
      )}
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
            {trends[prompt.prompt_name] && trends[prompt.prompt_name].length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>
                  Pass Rate Trend (Last {trends[prompt.prompt_name].length} runs)
                </h3>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    height: '120px',
                    gap: '4px',
                    padding: '12px',
                    background: '#f5f5f7',
                    borderRadius: '8px',
                  }}
                >
                  {trends[prompt.prompt_name].map((point, idx) => (
                    <div
                      key={idx}
                      title={`${new Date(
                        point.timestamp
                      ).toLocaleDateString()}: ${(
                        point.head_pass_rate * 100
                      ).toFixed(1)}%`}
                      style={{
                        flex: 1,
                        background: '#007aff',
                        height: `${point.head_pass_rate * 100}%`,
                        borderRadius: '2px',
                        minHeight: '2px',
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
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
            {prompt.cases && prompt.cases.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <h3 style={{ marginBottom: '16px', fontSize: '20px' }}>
                  Test Cases
                </h3>
                {prompt.cases.map((caseResult, idx) => (
                  <details
                    key={caseResult.id}
                    style={{
                      marginBottom: '12px',
                      border: '1px solid #d1d1d6',
                      borderRadius: '8px',
                      padding: '12px',
                    }}
                  >
                    <summary
                      style={{ cursor: 'pointer', fontWeight: '600' }}
                    >
                      {caseResult.case_name || `Case ${idx + 1}`}
                      {caseResult.critical === 1 && ' 🔴 CRITICAL'}
                      {caseResult.flaky === 1 && ' 🎲 FLAKY'}
                    </summary>
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ marginBottom: '12px' }}>
                        <strong>Base Output:</strong>
                        <pre
                          style={{
                            marginTop: '8px',
                            padding: '12px',
                            background: '#f5f5f7',
                            borderRadius: '4px',
                            overflow: 'auto',
                          }}
                        >
                          {caseResult.base_output}
                        </pre>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <strong>Head Output:</strong>
                        <pre
                          style={{
                            marginTop: '8px',
                            padding: '12px',
                            background: '#f5f5f7',
                            borderRadius: '4px',
                            overflow: 'auto',
                          }}
                        >
                          {caseResult.head_output}
                        </pre>
                      </div>
                      {caseResult.judge_result && (
                        <div>
                          <strong>Judge Decision:</strong>
                          <div
                            style={{
                              marginTop: '8px',
                              padding: '12px',
                              background:
                                caseResult.judge_result.preferredVersion ===
                                'head'
                                  ? '#e6f7ed'
                                  : caseResult.judge_result
                                      .preferredVersion === 'base'
                                  ? '#fee'
                                  : '#f5f5f7',
                              borderRadius: '4px',
                            }}
                          >
                            <div>
                              <strong>Preferred:</strong>{' '}
                              {caseResult.judge_result.preferredVersion}
                            </div>
                            <div style={{ marginTop: '8px' }}>
                              <strong>Reasoning:</strong>{' '}
                              {caseResult.judge_result.reasoning}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
