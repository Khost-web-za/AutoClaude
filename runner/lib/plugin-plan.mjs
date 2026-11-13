// Derives the non-interactive plugin install steps from a settings.json
// (spike: "Plugin install"): `claude plugin marketplace add <source>` per
// extraKnownMarketplaces entry, then `claude plugin install <id>` per enabled plugin.

const WINDOWS_PATH = /\b[A-Za-z]:\\/;

function marketplaceSource({ source } = {}) {
  switch (source?.source) {
    case "github":
      return source.repo;
    case "git":
    case "url":
      return source.url;
    case "directory":
    case "file":
      return source.path;
    default:
      return undefined;
  }
}

export function pluginInstallPlan(settings) {
  const marketplaces = Object.values(settings.extraKnownMarketplaces ?? {})
    .map(marketplaceSource)
    .filter((src) => typeof src === "string" && src && !WINDOWS_PATH.test(src));
  const plugins = Object.entries(settings.enabledPlugins ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([id]) => id);
  return { marketplaces, plugins };
}
