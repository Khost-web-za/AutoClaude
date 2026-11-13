// Creates bare git repos for integration tests, in one directory meant to be
// mounted at /repos: demo.git (one commit on main) and empty.git (no commits).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const git = (...args) => execFileSync("git", args, { stdio: "pipe" });

export function makeBareRepos() {
  const root = mkdtempSync(join(tmpdir(), "runner-repos-"));
  const work = mkdtempSync(join(tmpdir(), "runner-work-"));

  git("init", "-q", "-b", "main", work);
  writeFileSync(join(work, "README.md"), "# demo\n");
  git("-C", work, "add", "README.md");
  git("-C", work, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "init");
  git("clone", "-q", "--bare", work, join(root, "demo.git"));

  git("init", "-q", "--bare", "-b", "main", join(root, "empty.git"));
  // Bind-mounted repos are owned by another uid; tests point GIT_CONFIG_SYSTEM here.
  writeFileSync(join(root, "gitconfig"), "[safe]\n\tdirectory = *\n");
  return root;
}
