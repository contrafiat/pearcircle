// PearCircle Watcher.app main executable.
//
// Starts the bundled Node on host-bundled.js in the background and exits, so
// macOS treats every launch as a new one. The host opens the map in the
// default browser, and a launch while it already runs just reopens the page.
// Output goes to ~/Library/Logs/PearCircle Watcher.log.
//
// A compiled stub instead of a shell script: codesign and notarization expect
// a Mach-O main executable.

#include <fcntl.h>
#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main (void) {
  char exe[PATH_MAX];
  uint32_t size = sizeof(exe);
  if (_NSGetExecutablePath(exe, &size) != 0) return 1;
  char real[PATH_MAX];
  if (!realpath(exe, real)) return 1;

  char app[PATH_MAX], node[PATH_MAX], host[PATH_MAX];
  snprintf(app, sizeof(app), "%s/../Resources/app", dirname(real));
  snprintf(node, sizeof(node), "%s/node", app);
  snprintf(host, sizeof(host), "%s/host-bundled.js", app);

  pid_t pid = fork();
  if (pid < 0) return 1;
  if (pid > 0) return 0;

  setsid();
  const char *home = getenv("HOME");
  char log[PATH_MAX];
  snprintf(log, sizeof(log), "%s/Library/Logs/PearCircle Watcher.log", home ? home : "/tmp");
  int in = open("/dev/null", O_RDONLY);
  int out = open(log, O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (in >= 0) dup2(in, 0);
  if (out >= 0) { dup2(out, 1); dup2(out, 2); }
  if (chdir(app) != 0) return 1;
  execl(node, node, host, (char *)NULL);
  return 127;
}
