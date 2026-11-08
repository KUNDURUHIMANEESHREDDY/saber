"use strict";

// Observe fire-and-forget work without allowing either the task or its
// notification callback to create an unhandled rejection.
function runBackgroundTask(task, onError) {
  return Promise.resolve()
    .then(task)
    .catch((error) => {
      try {
        onError(error);
      } catch {
        // Reporting must never turn a handled task failure into a process crash.
      }
    });
}

module.exports = { runBackgroundTask };
