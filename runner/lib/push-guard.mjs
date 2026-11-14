// Classifies a Bash command line for the session push policy (spec call #4):
// pushing the session's own branch is free; pushing to the default branch,
// force-pushing, deleting remote branches, merging PRs and deleting repos ask.

const OPERATORS = ["&&", "||", ";", "|", "&", "\n"];

/** Splits a command line into segments of words, honoring quotes and escapes. */
export function tokenize(command) {
  const segments = [];
  let words = [];
  let word = "";
  let inWord = false;
  let quote = null;

  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      word += command[++i];
      inWord = true;
      continue;
    }
    const op = OPERATORS.find((o) => command.startsWith(o, i));
    if (op) {
      endSegment();
      i += op.length - 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "(" || ch === ")") {
      endWord();
      continue;
    }
    word += ch;
    inWord = true;
  }
  endSegment();
  return segments;
}

const GIT_OPTS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);
const PUSH_OPTS_WITH_VALUE = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec", "--signed"]);

const stripHeads = (ref) => ref.replace(/^refs\/heads\//, "");

function classifyPush(args, defaultBranch, currentBranch, ownBranch) {
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const name = arg.split("=")[0];
      if (name === "--force" || name.startsWith("--force-with-lease") || name === "--force-if-includes") {
        return { decision: "ask", reason: "Force-push requires the user's confirmation." };
      }
      if (name === "--delete") return { decision: "ask", reason: "Deleting a remote branch requires the user's confirmation." };
      if (name === "--all" || name === "--mirror") {
        return { decision: "ask", reason: `${name} pushes every branch, including ${defaultBranch}.` };
      }
      if (PUSH_OPTS_WITH_VALUE.has(name) && !arg.includes("=")) i++;
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const flags = arg.slice(1);
      if (flags.includes("f")) return { decision: "ask", reason: "Force-push requires the user's confirmation." };
      if (flags.includes("d")) return { decision: "ask", reason: "Deleting a remote branch requires the user's confirmation." };
      if (flags.endsWith("o")) i++;
      continue;
    }
    positional.push(arg);
  }

  const refspecs = positional.slice(1);
  const onDefault = currentBranch === defaultBranch && currentBranch !== ownBranch;
  if (refspecs.length === 0) {
    return onDefault
      ? { decision: "ask", reason: `This pushes the current branch, which is the default branch ${defaultBranch}.` }
      : { decision: "allow" };
  }

  for (const spec of refspecs) {
    if (spec.startsWith("+")) return { decision: "ask", reason: "Force-push (+refspec) requires the user's confirmation." };
    if (spec.startsWith(":")) return { decision: "ask", reason: "Deleting a remote branch requires the user's confirmation." };
    const [src, dst] = spec.includes(":") ? spec.split(":", 2) : [spec, spec];
    const target = stripHeads(dst === "HEAD" || (src === "HEAD" && dst === spec) ? currentBranch ?? "" : dst);
    if (target === defaultBranch && target !== ownBranch) {
      return { decision: "ask", reason: `Pushing to the default branch ${defaultBranch} requires the user's confirmation.` };
    }
  }
  return { decision: "allow" };
}

function classifyGit(args, defaultBranch, currentBranch, ownBranch) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    const name = args[i].split("=")[0];
    i += GIT_OPTS_WITH_VALUE.has(name) && !args[i].includes("=") ? 2 : 1;
  }
  if (args[i] !== "push") return { decision: "allow" };
  return classifyPush(args.slice(i + 1), defaultBranch, currentBranch, ownBranch);
}

function classifyGh(args) {
  const [group, action] = args.filter((a) => !a.startsWith("-"));
  if (group === "pr" && action === "merge") return { decision: "ask", reason: "Merging a pull request requires the user's confirmation." };
  if (group === "repo" && action === "delete") return { decision: "ask", reason: "Deleting a repository requires the user's confirmation." };
  return { decision: "allow" };
}

/** `ownBranch` (push-mode sessions) is exempt from the default-branch rule; force/delete/all rules still apply. */
export function classifyCommand(command, defaultBranch, currentBranch, { ownBranch } = {}) {
  for (const words of tokenize(command)) {
    let i = 0;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
    const [program, ...args] = words.slice(i);
    let result = { decision: "allow" };
    if (program === "git") result = classifyGit(args, defaultBranch, currentBranch, ownBranch);
    else if (program === "gh") result = classifyGh(args);
    if (result.decision === "ask") return result;
  }
  return { decision: "allow" };
}
