"use strict";

const fs = require("node:fs");
const path = require("node:path");

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

function resolvePublicFile(publicRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) return null;

  let root;
  try {
    root = fs.realpathSync(path.resolve(publicRoot));
  } catch {
    return null;
  }

  const relativePath = decoded.replace(/^[/\\]+/, "");
  const requested = path.resolve(root, relativePath);
  if (!isWithin(root, requested)) return null;

  // Resolve existing symlinks before serving a file. A lexical path can be
  // inside public/ while a symlink inside public/ points outside it.
  try {
    const canonical = fs.realpathSync(requested);
    return isWithin(root, canonical) ? canonical : null;
  } catch {
    // Preserve normal 404 behavior for missing files; the caller still checks
    // existence before serving. Broken symlinks also fail that check.
    return requested;
  }
}

module.exports = { resolvePublicFile };
