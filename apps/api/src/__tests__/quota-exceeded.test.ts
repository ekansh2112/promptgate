import { describe, it, expect, beforeEach } from 'vitest';
import { checkQuota, incrementQuota } from '../quota.js';

describe('Quota exceeded scenarios', () => {
  let mockEnv: any;

  beforeEach(() => {
    const quotaData: any[] = [];
    const runsData: any[] = [];

    mockEnv = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => ({
            first: async () => {
              if (sql.includes('SELECT call_count')) {
                return quotaData.find(
                  (q) => q.repository === args[0] && q.date === args[1]
                );
              }
              if (sql.includes('SUM(total_cost)')) {
                return {
                  total: runsData.reduce((sum, r) => sum + (r.total_cost || 0), 0),
                };
              }
              return null;
            },
            run: async () => {
              if (sql.includes('INSERT INTO quotas')) {
                const existing = quotaData.find(
                  (q) => q.repository === args[0] && q.date === args[1]
                );
                if (existing) {
                  existing.call_count += 1;
                  existing.token_count += args[2];
                } else {
                  quotaData.push({
                    repository: args[0],
                    date: args[1],
                    call_count: 1,
                    token_count: args[2],
                  });
                }
              }
            },
          }),
        }),
      },
    };

    // Helper to set quota data
    (mockEnv as any).setQuotaData = (data: any[]) => {
      quotaData.length = 0;
      quotaData.push(...data);
    };

    (mockEnv as any).setRunsData = (data: any[]) => {
      runsData.length = 0;
      runsData.push(...data);
    };
  });

  it('should block when daily call limit is reached', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockEnv.setQuotaData([
      {
        repository: 'owner/repo',
        date: today,
        call_count: 1000,
        token_count: 50000,
      },
    ]);

    const result = await checkQuota(mockEnv, 'owner/repo');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily call limit');
    expect(result.reason).toContain('Add your own API key');
  });

  it('should block when daily token limit is reached', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockEnv.setQuotaData([
      {
        repository: 'owner/repo',
        date: today,
        call_count: 100,
        token_count: 500000,
      },
    ]);

    const result = await checkQuota(mockEnv, 'owner/repo');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily token limit');
  });

  it('should block when global daily budget is exceeded', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockEnv.setRunsData([
      { total_cost: 30.0, timestamp: today },
      { total_cost: 25.0, timestamp: today },
    ]);

    const result = await checkQuota(mockEnv, 'owner/repo');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Global daily budget');
    expect(result.reason).toContain('try again tomorrow');
  });

  it('should allow when under all limits', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockEnv.setQuotaData([
      {
        repository: 'owner/repo',
        date: today,
        call_count: 10,
        token_count: 5000,
      },
    ]);
    mockEnv.setRunsData([{ total_cost: 1.0, timestamp: today }]);

    const result = await checkQuota(mockEnv, 'owner/repo');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
