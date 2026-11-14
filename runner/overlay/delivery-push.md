- You work directly on `${WORK_BRANCH}`; there is no pull request. Commit after
  each logical step, then `git pull --rebase --autostash` and `git push`, so the
  remote is never far behind. Never open a pull request.
- If a rebase conflicts, resolve it when the intent of both sides is clear;
  otherwise ask the user (AskUserQuestion). Never `git reset --hard`,
  force-push or delete remote branches.
