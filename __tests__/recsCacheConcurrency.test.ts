import { clearRecsCaches, fetchRecsConfig, fetchStyleProfileSnapshot } from '../lib/recsConfig';
import { getSupabaseClient } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn() } }));

describe('recommendation query reuse', () => {
  beforeEach(async () => { await clearRecsCaches(); });
  afterEach(() => jest.restoreAllMocks());

  it('shares concurrent config/profile queries and briefly caches an absent profile', async () => {
    const from = jest.fn(() => {
      const query = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
      return query;
    });
    jest.mocked(getSupabaseClient).mockReturnValue({ from } as never);
    const profiles = await Promise.all([fetchStyleProfileSnapshot('a'), fetchStyleProfileSnapshot('a')]);
    expect(profiles[0]).toBe(profiles[1]);
    expect(from).toHaveBeenCalledTimes(1);
    await fetchStyleProfileSnapshot('a');
    expect(from).toHaveBeenCalledTimes(1);
    await Promise.all([fetchRecsConfig(), fetchRecsConfig()]);
    expect(from).toHaveBeenCalledTimes(3);
    await fetchRecsConfig();
    expect(from).toHaveBeenCalledTimes(3);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 60_001);
    await fetchStyleProfileSnapshot('a');
    expect(from).toHaveBeenCalledTimes(4);
  });

  it('does not let an old in-flight profile repopulate caches after invalidation', async () => {
    let finish: ((value: { data: null; error: null }) => void) | undefined;
    const maybeSingle = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const from = jest.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));
    jest.mocked(getSupabaseClient).mockReturnValue({ from } as never);
    const old = fetchStyleProfileSnapshot('a');
    await clearRecsCaches();
    finish?.({ data: null, error: null });
    await old;
    maybeSingle.mockImplementation(async () => ({ data: null, error: null }));
    await fetchStyleProfileSnapshot('a');
    expect(from).toHaveBeenCalledTimes(2);
  });
});
