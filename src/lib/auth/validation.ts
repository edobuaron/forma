/** Only app-relative redirects; backslashes can otherwise become an external host. */
export function safeRedirect(value?: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/';
  return value;
}

export function passwordProblem(password: string, confirmation: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (password !== confirmation) return 'The passwords do not match.';
  return null;
}
