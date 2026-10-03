import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync } from 'expo-image-manipulator';
import type { StoreApi } from 'zustand';
import {
  wardrobeImage,
  wardrobeProduct,
  type WardrobeItem,
} from '../types/wardrobe';
import { createWardrobeSlice } from '../store/wardrobeSlice';
import type { AppState } from '../store/useAppStore';
import {
  createWardrobeCutout,
  uploadWardrobeCutout,
} from '../services/wardrobeCutoutService';
import { loadWardrobe, saveWardrobe } from '../services/wardrobeService';
import { getProductImages } from '../types/product';

const mockUpload = jest.fn().mockResolvedValue({ error: null });
const mockSigned = jest.fn().mockResolvedValue({
  data: { signedUrl: 'https://storage/cutout.png?token=signed' },
  error: null,
});
const mockSession = jest.fn().mockResolvedValue({
  data: { session: { user: { id: 'owner' }, access_token: 'token' } },
  error: null,
});
const mockTaskUpload = jest.fn();
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn(() => Promise.resolve(png)),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  createUploadTask: jest.fn(() => ({
    uploadAsync: mockTaskUpload,
    cancelAsync: jest.fn(),
  })),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest
    .fn()
    .mockResolvedValue({ uri: 'file:///temp/normalized.jpg' }),
}));
jest.mock('../lib/supabase', () => ({
  getRequiredSupabaseClient: () => ({
    auth: { getSession: mockSession },
    storage: {
      from: () => ({ upload: mockUpload, createSignedUrl: mockSigned }),
    },
  }),
}));
jest.mock('../lib/logger', () => ({ logger: { warn: jest.fn() } }));
jest.mock('../services/wardrobeService', () => ({
  storeWardrobePhoto: jest
    .fn()
    .mockResolvedValue('file:///documents/original.jpg'),
  saveWardrobe: jest.fn().mockResolvedValue(undefined),
  loadWardrobe: jest.fn(),
}));
jest.mock('../services/wardrobeCutoutService', () => ({
  ...jest.requireActual('../services/wardrobeCutoutService'),
  createWardrobeCutout: jest.fn(),
  uploadWardrobeCutout: jest.fn(),
  wardrobeCutoutConfigured: () => true,
}));
const actual = jest.requireActual<
  typeof import('../services/wardrobeCutoutService')
>('../services/wardrobeCutoutService');
const item: WardrobeItem = {
  id: 'owned',
  title: 'Gömlek',
  brand: '',
  category: 'upper_body',
  imageUrl: 'file:///original.jpg',
  createdAt: '2026-09-30',
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function store() {
  const state = {
    sessionUserId: 'owner',
    wardrobeItems: [],
    savedOutfits: [],
    wardrobeStatus: 'ready',
  } as unknown as AppState;
  Object.assign(
    state,
    createWardrobeSlice(
      (patch) =>
        Object.assign(
          state,
          typeof patch === 'function' ? patch(state) : patch,
        ),
      () => state,
      {} as StoreApi<AppState>,
    ),
  );
  state.wardrobeStatus = 'ready';
  return state;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_WARDROBE_CUTOUT_URL =
    'http://localhost:7010/v1/wardrobe/cutout';
  mockTaskUpload.mockResolvedValue({
    status: 200,
    body: JSON.stringify({ pngBase64: png }),
  });
  mockSession.mockResolvedValue({
    data: { session: { user: { id: 'owner' }, access_token: 'token' } },
    error: null,
  });
  jest
    .mocked(createWardrobeCutout)
    .mockResolvedValue('file:///documents/cutout.png');
  jest.mocked(uploadWardrobeCutout).mockResolvedValue({
    cutoutUrl: 'https://storage/cutout.png',
    cutoutStoragePath: 'owner/owned/cutout.png',
    cutoutUrlExpiresAt: Date.now() + 60000,
  });
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_WARDROBE_CUTOUT_URL;
});

describe('owned wardrobe cutout service', () => {
  it('preserves legacy originals and prefers cutouts only in the wardrobe adapter', () => {
    expect(wardrobeImage(item)).toBe(item.imageUrl);
    const processed = {
      ...item,
      cutoutUrl: 'https://storage/cutout.png',
      cutoutLocalUri: 'file:///cutout.png',
    };
    expect(wardrobeImage(processed)).toBe(processed.cutoutUrl);
    expect(getProductImages(wardrobeProduct(processed))).toEqual([
      processed.cutoutUrl,
      processed.cutoutLocalUri,
      item.imageUrl,
    ]);
    expect(processed.imageUrl).toBe(item.imageUrl);
  });
  it('normalizes a separate copy, writes a PNG and removes only the temporary copy', async () => {
    const uri = await actual.createWardrobeCutout('owner', item);
    expect(manipulateAsync).toHaveBeenCalledWith(item.imageUrl, [], {
      format: 'jpeg',
      compress: 0.9,
    });
    expect(uri).toMatch(/-cutout\.png$/);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(uri, png, {
      encoding: 'base64',
    });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///temp/normalized.jpg',
      { idempotent: true },
    );
  });
  it('rejects a different account before sending any photo', async () => {
    await expect(
      actual.createWardrobeCutout('another-user', item),
    ).rejects.toThrow('oturum');
    expect(manipulateAsync).not.toHaveBeenCalled();
  });
  it('uploads PNG bytes to the owner folder and signs a private URL', async () => {
    const result = await actual.uploadWardrobeCutout('owner', {
      ...item,
      cutoutLocalUri: 'file:///cutout.png',
    });
    expect(mockUpload).toHaveBeenCalledWith(
      'owner/owned/cutout.png',
      expect.any(ArrayBuffer),
      { contentType: 'image/png', upsert: true },
    );
    expect(result.cutoutUrl).toContain('?token=signed');
    expect(mockSigned).toHaveBeenCalledWith('owner/owned/cutout.png', 604800);
    await actual.uploadWardrobeCutout('owner', { ...item, ...result });
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });
  it('rejects non-PNG processor responses', async () => {
    mockTaskUpload.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ pngBase64: 'bm90IGEgcG5n' }),
    });
    await expect(actual.createWardrobeCutout('owner', item)).rejects.toThrow(
      'PNG',
    );
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  });
  it('saves the original before inference and persists the cutout on the same item', async () => {
    const state = store();
    await state.addWardrobeItem(item);
    await tick();
    expect(saveWardrobe).toHaveBeenCalled();
    expect(state.wardrobeItems[0]).toMatchObject({
      imageUrl: 'file:///documents/original.jpg',
      cutoutLocalUri: 'file:///documents/cutout.png',
      cutoutStatus: 'ready',
    });
    expect(uploadWardrobeCutout).toHaveBeenCalledTimes(1);
  });
  it('keeps the original and local PNG when Storage fails', async () => {
    jest
      .mocked(uploadWardrobeCutout)
      .mockRejectedValueOnce(new Error('offline'));
    const state = store();
    await state.addWardrobeItem(item);
    await tick();
    expect(state.wardrobeItems[0]).toMatchObject({
      imageUrl: 'file:///documents/original.jpg',
      cutoutLocalUri: 'file:///documents/cutout.png',
      cutoutStatus: 'error',
    });
  });
  it('retries upload after hydration without reprocessing the PNG or legacy clothes', async () => {
    const legacy = { ...item, id: 'legacy' };
    const retry = {
      ...item,
      cutoutLocalUri: 'file:///existing-cutout.png',
      cutoutStatus: 'error' as const,
    };
    jest.mocked(loadWardrobe).mockResolvedValueOnce({
      wardrobeItems: [legacy, retry],
      savedOutfits: [],
    });
    const state = store();
    const favorites = (state.likedProducts = []);
    await state.hydrateWardrobe('owner');
    await tick();
    expect(createWardrobeCutout).not.toHaveBeenCalled();
    expect(uploadWardrobeCutout).toHaveBeenCalledTimes(1);
    expect(state.wardrobeItems[0]).toEqual(legacy);
    expect(state.wardrobeItems[1].cutoutStatus).toBe('ready');
    expect(state.likedProducts).toBe(favorites);
  });
  it('does not attach a result after the active account changes', async () => {
    let finish!: (uri: string) => void;
    jest.mocked(createWardrobeCutout).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const state = store();
    await state.addWardrobeItem(item);
    await tick();
    state.sessionUserId = 'other';
    state.wardrobeItems = [];
    finish('file:///documents/cutout.png');
    await tick();
    expect(state.wardrobeItems).toEqual([]);
    expect(uploadWardrobeCutout).not.toHaveBeenCalled();
  });
});
