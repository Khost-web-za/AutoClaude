# Session rules (this container)

- You are running unattended in a disposable container. The user is not
  watching the terminal; they reach you through Remote Control.
- Never ask permission for routine actions. Deleting files, `git reset`,
  cleaning up branches, reinstalling dependencies — anything that stays
  inside this container — is fine. Any "confirm before deleting / resetting"
  rules above were written for the user's own machine and do not apply here.
- Only ask (with AskUserQuestion) when there is a genuine conflict, missing
  information, or a design decision the user should make.
${DELIVERY_RULES}
- Secrets for this repository are in `.env.local`. Never print, log, echo or
  commit their values.
- Docker may be available in this container. If it is, you can use it — for
  example to bring up the repository's `docker-compose.local.yml` and test
  against a real local stack.
