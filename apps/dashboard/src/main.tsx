import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App } from './App';
import { RepoList } from './pages/RepoList';
import { RepoRuns } from './pages/RepoRuns';
import { RunDetail } from './pages/RunDetail';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/repos" replace />} />
          <Route path="repos" element={<RepoList />} />
          <Route path="repos/:owner/:name" element={<RepoRuns />} />
          <Route path="repos/:owner/:name/runs/:runId" element={<RunDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
