export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { registerGitCredentialMinter, startRunnerApi } = await import('@/runner-api/runner-api-server');
  const { mintGitCredential } = await import('@/github/tokens');
  registerGitCredentialMinter((repoFullName) => mintGitCredential(repoFullName));
  startRunnerApi();

  const { restoreCredentialsIfMissing, startCredentialsWatcher } = await import('@/claude/credentials-volume');
  try {
    await restoreCredentialsIfMissing();
  } catch (error) {
    console.warn('[claude] credentials restore failed:', error instanceof Error ? error.name : 'error');
  }
  startCredentialsWatcher();

  // Migrations already ran (the image runs them before the server starts). Adopt running sessions now
  // and keep rows in line with Docker every 60 s.
  try {
    const { startReconcileLoop } = await import('@/sessions/reconcile');
    startReconcileLoop();
  } catch (error) {
    console.warn('[sessions] reconcile loop failed to start:', error instanceof Error ? error.name : 'error');
  }

  try {
    const { removeStaleLoginHelpers } = await import('@/claude/login-helper');
    await removeStaleLoginHelpers();
  } catch (error) {
    console.warn('[claude] stale login helper cleanup failed:', error instanceof Error ? error.name : 'error');
  }

  try {
    const { removeStaleKickoffContainers } = await import('@/kickoffs/kickoff-container');
    await removeStaleKickoffContainers();
  } catch (error) {
    console.warn('[kickoffs] stale kick-off container cleanup failed:', error instanceof Error ? error.name : 'error');
  }
}
