import { buildInviteShareMessage } from '../lib/inviteShare';

describe('buildInviteShareMessage', () => {
  it('başlık ve mağaza linkini birleştirir', () => {
    expect(buildInviteShareMessage('https://example.com/privacy')).toBe(
      "Vitirify'da kıyafetleri üzerinde dene! 🎽\nhttps://example.com/privacy",
    );
  });
});
