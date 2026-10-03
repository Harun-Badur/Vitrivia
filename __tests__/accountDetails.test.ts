import {
  fetchAccountDetails,
  saveAccountDetails,
} from '../services/accountDetailsService';

const mockGetUser = jest.fn();
const mockUpdateUser = jest.fn();
jest.mock('../lib/supabase', () => ({
  getRequiredSupabaseClient: () => ({
    auth: { getUser: mockGetUser, updateUser: mockUpdateUser },
  }),
}));
const user = {
  id: 'owner',
  email: 'owner@example.invalid',
  user_metadata: { full_name: 'Mevcut Ad', avatar_url: 'existing-photo' },
};
beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user }, error: null });
  mockUpdateUser.mockResolvedValue({
    data: {
      user: {
        ...user,
        user_metadata: { ...user.user_metadata, username: 'Yeni Ad' },
      },
    },
    error: null,
  });
});
it('reads the actual Auth metadata and email', async () => {
  expect(await fetchAccountDetails('owner')).toMatchObject({
    username: 'Mevcut Ad',
    email: user.email,
  });
});
it('rejects a different account before updating Auth', async () => {
  await expect(
    saveAccountDetails('other', { username: 'Yeni Ad', email: user.email }),
  ).rejects.toThrow('oturum');
  expect(mockUpdateUser).not.toHaveBeenCalled();
});
it('saves a trimmed username without changing email or photo metadata', async () => {
  expect(
    await saveAccountDetails('owner', {
      username: ' Yeni Ad ',
      email: ` ${user.email} `,
    }),
  ).toMatchObject({ username: 'Yeni Ad', email: user.email });
  expect(mockUpdateUser).toHaveBeenCalledWith({
    data: { username: 'Yeni Ad' },
  });
});
it('shows the confirmed email while an Auth email change is pending', async () => {
  mockUpdateUser.mockResolvedValueOnce({
    data: { user: { ...user, new_email: 'new@example.invalid' } },
    error: null,
  });
  const result = await saveAccountDetails('owner', {
    username: 'Yeni Ad',
    email: 'new@example.invalid',
  });
  expect(mockUpdateUser).toHaveBeenCalledWith({
    data: { username: 'Yeni Ad' },
    email: 'new@example.invalid',
  });
  expect(result).toMatchObject({
    email: user.email,
    pendingEmail: 'new@example.invalid',
  });
});
it('does not resend an already pending email change during a username edit', async () => {
  mockGetUser.mockResolvedValueOnce({
    data: { user: { ...user, new_email: 'new@example.invalid' } },
    error: null,
  });
  await saveAccountDetails('owner', {
    username: 'Yeni Ad',
    email: 'new@example.invalid',
  });
  expect(mockUpdateUser).toHaveBeenCalledWith({
    data: { username: 'Yeni Ad' },
  });
});
it('rejects invalid input without contacting Auth', async () => {
  await expect(
    saveAccountDetails('owner', { username: '', email: user.email }),
  ).rejects.toThrow('Kullanıcı adı');
  await expect(
    saveAccountDetails('owner', { username: 'Ad', email: 'invalid' }),
  ).rejects.toThrow('e-posta');
  expect(mockGetUser).not.toHaveBeenCalled();
});
it('does not report a rejected Auth update as saved', async () => {
  mockUpdateUser.mockResolvedValueOnce({
    data: { user: null },
    error: new Error('Network request failed'),
  });
  await expect(
    saveAccountDetails('owner', { username: 'Yeni Ad', email: user.email }),
  ).rejects.toThrow('İnternet');
});
