import {
  getPostAuthDestination,
  getPostAuthIntent,
  PHOTO_IMPORT_INTENT,
  withPostAuthIntent,
} from '@/app/lib/auth/post-auth-intent';

describe('post-auth intent', () => {
  it('carries the photo-import journey to the import workspace', () => {
    expect(getPostAuthIntent(PHOTO_IMPORT_INTENT)).toBe(PHOTO_IMPORT_INTENT);
    expect(getPostAuthDestination(PHOTO_IMPORT_INTENT)).toBe(
      '/dashboard/import',
    );
    expect(
      withPostAuthIntent('/verify-email?sent=1', PHOTO_IMPORT_INTENT),
    ).toBe('/verify-email?sent=1&intent=photo-import');
  });

  it('ignores arbitrary destinations instead of creating an open redirect', () => {
    expect(getPostAuthIntent('https://attacker.example')).toBeUndefined();
    expect(getPostAuthDestination('/dashboard/owner/users')).toBe('/dashboard');
    expect(withPostAuthIntent('/login', '//attacker.example')).toBe('/login');
  });
});
