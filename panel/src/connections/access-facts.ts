/** `abcd…wxyz`: enough to recognise the Access application tag without printing it. */
export function maskAud(aud: string): string {
  const value = aud.trim();
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
