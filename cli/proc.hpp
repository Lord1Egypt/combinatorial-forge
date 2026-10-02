// Spawn an external program with an argument vector (no shell involved).
#pragma once
#include <cstdio>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <process.h>
#else
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace forge::cli {

// Returns the child's exit status, or -1 if it could not be started.
inline int run_process(const std::vector<std::string>& args) {
    if (args.empty()) return -1;
#if defined(_WIN32)
    std::vector<std::string> quoted;
    for (const auto& a : args) quoted.push_back(a.find(' ') == std::string::npos ? a : "\"" + a + "\"");
    std::vector<const char*> argv;
    for (const auto& a : quoted) argv.push_back(a.c_str());
    argv.push_back(nullptr);
    return int(_spawnvp(_P_WAIT, argv[0], argv.data()));
#else
    std::vector<char*> argv;
    for (const auto& a : args) argv.push_back(const_cast<char*>(a.c_str()));
    argv.push_back(nullptr);
    pid_t pid = fork();
    if (pid < 0) return -1;
    if (pid == 0) {
        execvp(argv[0], argv.data());
        _exit(127);
    }
    int status = 0;
    if (waitpid(pid, &status, 0) < 0) return -1;
    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
#endif
}

inline bool ends_with(const std::string& text, const std::string& suffix) {
    return text.size() >= suffix.size() && text.compare(text.size() - suffix.size(), suffix.size(), suffix) == 0;
}

}  // namespace forge::cli
