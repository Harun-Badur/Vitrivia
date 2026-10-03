import type { User } from '@supabase/supabase-js';
import { getRequiredSupabaseClient } from '../lib/supabase';
import { toTurkishAuthMessage } from '../lib/authError';

export interface AccountDetails {
  id: string;
  username: string;
  email: string;
  pendingEmail: string | null;
}

const accountDetails = (user: User): AccountDetails => {
  const metadata = user.user_metadata;
  const username = [
    metadata.username,
    metadata.display_name,
    metadata.full_name,
    metadata.name,
  ].find(
    (value): value is string => typeof value === 'string' && !!value.trim(),
  );
  return {
    id: user.id,
    username: username?.trim() || user.email?.split('@')[0] || 'Kullanıcı',
    email: user.email ?? '',
    pendingEmail: user.new_email || null,
  };
};

export async function fetchAccountDetails(
  userId: string,
): Promise<AccountDetails> {
  const { data, error } = await getRequiredSupabaseClient().auth.getUser();
  if (error) throw new Error(toTurkishAuthMessage(error));
  if (!data.user || data.user.id !== userId)
    throw new Error('Hesap bilgileri için geçerli oturum gerekli.');
  return accountDetails(data.user);
}

export async function saveAccountDetails(
  userId: string,
  input: Pick<AccountDetails, 'username' | 'email'>,
): Promise<AccountDetails> {
  const username = input.username.trim();
  const email = input.email.trim();
  if (!username || username.length > 80)
    throw new Error('Kullanıcı adı 1–80 karakter olmalı.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Geçerli bir e-posta adresi gir.');
  const current = await fetchAccountDetails(userId);
  const { data, error } = await getRequiredSupabaseClient().auth.updateUser({
    data: { username },
    ...(email.toLowerCase() !== current.email.toLowerCase() &&
    email.toLowerCase() !== current.pendingEmail?.toLowerCase()
      ? { email }
      : {}),
  });
  if (error) throw new Error(toTurkishAuthMessage(error));
  if (!data.user || data.user.id !== userId)
    throw new Error('Oturum değişti. Hesap bilgilerini tekrar aç.');
  return accountDetails(data.user);
}
