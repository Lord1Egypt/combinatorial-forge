// WebAssembly entry point: the same JSON API as `forge call`, backed by the shared engine.
#include <emscripten/emscripten.h>

#include <string>

#include "forge/api.hpp"

namespace {
std::string reply;  // owned by the module; valid until the next call
}

extern "C" {

// Takes a UTF-8 JSON request and returns a pointer to a NUL-terminated JSON response.
EMSCRIPTEN_KEEPALIVE const char* forge_call(const char* request) {
    reply = forge::api::handle(request ? request : "");
    return reply.c_str();
}

}
