"use strict";

const path = require("node:path");

function resolvePublicFile(publicRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) return null;

  const root = path.resolve(publicRoot);
  const relativePath = decoded.replace(/^[/\\]+/, "");
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

module.exports = { resolvePublicFile };
