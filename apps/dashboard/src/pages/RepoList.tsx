import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'https://promptgate-api.ekansh-gupta.workers.dev';

interface Repository {
  id: number;
  full_name: string;
  is_private: number;
  run_count: number;
  last_run: number | null;
}

export function RepoList() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRepos();
  }, []);

  const fetchRepos = async () => {
    const token = localStorage.getItem('promptgate_session');
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_URL}/api/repos`, { headers });

      if (response.status === 401) {
        // Live API before this PR's deploy still requires login for /api/repos.
        // Public run routes work without auth — surface the dogfood repo.
        setRepos([
          {
            id: 0,
            full_name: 'ekansh2112/promptgate',
            is_private: 0,
            run_count: 0,
            last_run: null,
          },
        ]);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch repositories');
      }

      const data = await response.json();
      setRepos(data.repositories);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading repositories...</div>;
  }

  if (error) {
    return <div className="card" style={{ color: '#c41e3a' }}>{error}</div>;
  }

  if (repos.length === 0) {
    return (
      <div className="card">
        <h2>No Repositories Yet</h2>
        <p style={{ marginTop: '12px', color: '#6e6e73' }}>
          Public repositories appear here after a PromptGate run uploads results.
          v1 OAuth is <code>read:user</code> only (public repos). Private-repo
          dashboard access is not included in v1 — use BYOK in CI instead.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: '24px', fontSize: '32px', fontWeight: '700' }}>
        Repositories
      </h1>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Repository</th>
              <th>Runs</th>
              <th>Last Run</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {repos.map((repo) => (
              <tr key={repo.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong>{repo.full_name}</strong>
                    {repo.is_private === 1 && (
                      <span
                        style={{
                          fontSize: '12px',
                          color: '#6e6e73',
                          background: '#f5f5f7',
                          padding: '2px 8px',
                          borderRadius: '4px',
                        }}
                      >
                        Private
                      </span>
                    )}
                  </div>
                </td>
                <td>{repo.run_count}</td>
                <td>
                  {repo.last_run
                    ? new Date(repo.last_run * 1000).toLocaleString()
                    : 'Never'}
                </td>
                <td>
                  <Link
                    to={`/repos/${repo.full_name}`}
                    style={{ color: '#0071e3', fontWeight: '500' }}
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
