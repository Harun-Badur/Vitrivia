import {
  fetchStudioProfile,
  upsertStudioProfile,
} from '../services/profileService';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: null,
  downloadAsync: jest.fn(),
}));
jest.mock('../lib/personPhotoPrepare', () => ({
  preparePersonJpegUri: jest.fn(),
}));
jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), debug: jest.fn() },
}));
let mockMetadata: Record<string, unknown>;
let mockRow: Record<string, unknown>;
const mockUpdateUser = jest.fn(
  async ({ data }: { data: Record<string, unknown> }) => {
    mockMetadata = { ...mockMetadata, ...data };
    return {
      data: { user: { id: 'owner', user_metadata: mockMetadata } },
      error: null,
    };
  },
);
const mockUpsert = jest.fn((payload: Record<string, unknown>) => {
  mockRow = { ...mockRow, ...payload };
  return {
    select: () => ({ single: async () => ({ data: mockRow, error: null }) }),
  };
});
const mockRpc = jest.fn(async () => ({ error: null }));
jest.mock('../lib/supabase', () => ({
  getRequiredSupabaseClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: 'owner', user_metadata: mockMetadata } },
        error: null,
      }),
      updateUser: mockUpdateUser,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mockRow, error: null }),
        }),
      }),
      upsert: mockUpsert,
    }),
    rpc: mockRpc,
  }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockMetadata = { username: 'Existing name', avatar_url: 'existing-photo' };
  mockRow = {
    id: 'owner',
    height_cm: 181,
    weight_kg: 73,
    top_size: 'L',
    bottom_size: 'S',
    style_tags: ['sport'],
    model_photo_path: 'photo',
  };
});
it('persists each preference independently and restores it on subsequent profile fetches', async () => {
  await upsertStudioProfile('owner', { favoriteBrands: ['Mavi', 'Koton'] });
  await upsertStudioProfile('owner', { preferredColors: ['Yeşil', 'Mavi'] });
  await upsertStudioProfile('owner', { priceRange: { min: 100, max: 3000 } });
  expect(await fetchStudioProfile('owner')).toMatchObject({
    favoriteBrands: ['Mavi', 'Koton'],
    preferredColors: ['Yeşil', 'Mavi'],
    priceRange: { min: 100, max: 3000 },
    heightCm: 181,
    modelPhotoPath: 'photo',
    styleTags: ['sport'],
  });
  expect(mockMetadata).toMatchObject({
    username: 'Existing name',
    avatar_url: 'existing-photo',
  });
  expect(mockUpsert).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
});
it('keeps the existing body write and style write on profiles', async () => {
  await upsertStudioProfile('owner', { heightCm: 182 });
  expect(mockUpsert).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'owner', height_cm: 182 }),
    { onConflict: 'id' },
  );
  await upsertStudioProfile('owner', { styleTags: ['minimal'] });
  expect(mockUpsert).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'owner', style_tags: ['minimal'] }),
    { onConflict: 'id' },
  );
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(await fetchStudioProfile('owner')).toMatchObject({
    heightCm: 182,
    styleTags: ['minimal'],
  });
});
it('rejects invalid range and other-account writes', async () => {
  await expect(
    upsertStudioProfile('owner', { priceRange: { min: 1000, max: 200 } }),
  ).rejects.toThrow('fiyat');
  await expect(
    upsertStudioProfile('other', { favoriteBrands: ['Mavi'] }),
  ).rejects.toThrow('oturum');
  expect(mockUpdateUser).not.toHaveBeenCalled();
});
it('propagates failed persistence instead of reporting success', async () => {
  mockUpdateUser.mockResolvedValueOnce({
    data: { user: { id: 'owner', user_metadata: {} } },
    error: new Error('offline'),
  } as never);
  await expect(
    upsertStudioProfile('owner', { preferredColors: ['Mavi'] }),
  ).rejects.toThrow('kaydedilemedi');
});
