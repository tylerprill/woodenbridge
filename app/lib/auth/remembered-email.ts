import { rememberedEmailSchema } from '@/app/lib/auth/login';

export const REMEMBERED_EMAIL_STORAGE_KEY = 'wooden-bridge:remembered-email:v1';

type EmailStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export function readRememberedEmail(storage: EmailStorage) {
  try {
    const storedEmail = storage.getItem(REMEMBERED_EMAIL_STORAGE_KEY);
    if (!storedEmail) return undefined;

    const parsedEmail = rememberedEmailSchema.safeParse(storedEmail);
    return parsedEmail.success ? parsedEmail.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeRememberedEmail(
  storage: EmailStorage,
  email: string | undefined,
) {
  try {
    const parsedEmail = rememberedEmailSchema.safeParse(email);

    if (parsedEmail.success) {
      storage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, parsedEmail.data);
    } else {
      storage.removeItem(REMEMBERED_EMAIL_STORAGE_KEY);
    }
  } catch {
    // Local storage can be unavailable or blocked; login must still work.
  }
}
