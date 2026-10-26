import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

const API_URL = 'https://promptgate-api.ekansh-gupta.workers.dev';

export function App() {
  const [session, setSession] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('promptgate_session');
    if (token) {
      setSession(token);
      try {
        const payload = JSON.parse(atob(token.split('.')[0]));
        setUsername(payload.username);
      } catch {
        localStorage.removeItem('promptgate_session');
      }
    }
  }, []);

  const handleLogin = () => {
    window.location.href = `${API_URL}/auth/github`;
  };

  const handleLogout = () => {
    localStorage.removeItem('promptgate_session');
    setSession(null);
    setUsername(null);
    navigate('/repos');
  };

  return (
    <div>
      <header
        style={{
          background: 'white',
          borderBottom: '1px solid #e5e5e7',
          padding: '16px 0',
        }}
      >
        <div
          className="container"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
            <Link
              to="/"
              style={{
                fontSize: '24px',
                fontWeight: '700',
                color: '#1d1d1f',
                textDecoration: 'none',
              }}
            >
              ⚡ PromptGate
            </Link>
            <nav style={{ display: 'flex', gap: '24px' }}>
              <Link to="/repos">Repositories</Link>
            </nav>
          </div>
          <div>
            {session ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{ color: '#6e6e73' }}>@{username}</span>
                <button className="btn btn-primary" onClick={handleLogout}>
                  Logout
                </button>
              </div>
            ) : (
              <button className="btn btn-primary" onClick={handleLogin}>
                Login with GitHub
              </button>
            )}
          </div>
        </div>
      </header>
      <main style={{ padding: '40px 0' }}>
        <div className="container">
          <Outlet />
        </div>
      </main>
      <footer
        style={{
          textAlign: 'center',
          padding: '40px 0',
          color: '#6e6e73',
          fontSize: '14px',
        }}
      >
        PromptGate v1.0 • Public repos only (OAuth <code>read:user</code>) • MIT License
      </footer>
    </div>
  );
}
