type AccountIdentity = {
  name?: string | null;
  email?: string | null;
};

export function getAccountDisplayName(
  identity?: AccountIdentity | null,
  fallback = 'Explorer',
) {
  const profileName = identity?.name?.trim();

  if (profileName) {
    return profileName;
  }

  const accountName = identity?.email?.split('@')[0]?.split('+')[0];

  if (!accountName) {
    return fallback;
  }

  return accountName
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getAccountInitial(identity?: AccountIdentity | null) {
  return getAccountDisplayName(identity).charAt(0).toUpperCase();
}
