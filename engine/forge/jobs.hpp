// Deterministic work units: definitions, canonical identifiers, planning and resumable stepping.
#pragma once
#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#include "chess.hpp"
#include "json.hpp"
#include "nqueens.hpp"
#include "sha256.hpp"

namespace forge::jobs {

constexpr const char* engine_version = "forge-engine/1";
constexpr const char* nqueens_solver = "nqueens-bitmask-prefix/1";
constexpr const char* chess_solver = "chess-perft/1";
constexpr int max_chess_depth = 8;

inline const char* const definition_keys[9] = {"algorithm", "depth", "parameters", "partition", "problem",
                                              "problem_version", "range", "root_state", "solver_version"};

inline std::string canonical(const Json& def) { return def.dump(); }
inline std::string job_id(const Json& def) { return sha256_hex(canonical(def)); }

inline Json make_definition(const std::string& problem, const std::string& solver, const std::string& algorithm,
                            Json parameters, Json root_state, Json partition, Json depth) {
    Json def = Json::object();
    def.set("problem", problem);
    def.set("problem_version", "1");
    def.set("solver_version", solver);
    def.set("algorithm", algorithm);
    def.set("parameters", std::move(parameters));
    def.set("root_state", std::move(root_state));
    def.set("partition", std::move(partition));
    def.set("range", Json());
    def.set("depth", std::move(depth));
    return def;
}

inline std::vector<int> int_list(const Json& value, size_t max_len, const char* what) {
    std::vector<int> out;
    if (!value.is_array() || value.items().size() > max_len) throw std::invalid_argument(std::string(what) + " must be a short array");
    for (const Json& item : value.items()) {
        if (!item.is_int() || item.as_int() < 0 || item.as_int() > 63) throw std::invalid_argument(std::string(what) + " entries must be small integers");
        out.push_back(int(item.as_int()));
    }
    return out;
}

inline std::vector<std::string> move_list(const Json& value) {
    std::vector<std::string> out;
    if (!value.is_array() || value.items().size() > 16) throw std::invalid_argument("path must be an array of at most 16 moves");
    for (const Json& item : value.items()) {
        if (!item.is_string() || item.as_string().size() < 4 || item.as_string().size() > 5)
            throw std::invalid_argument("path entries must be UCI moves");
        out.push_back(item.as_string());
    }
    return out;
}

// Throws std::invalid_argument unless `def` is a well-formed, supported job definition.
inline void validate(const Json& def) {
    if (!def.is_object() || def.members().size() != 9) throw std::invalid_argument("job definition must have exactly 9 fields");
    for (const char* key : definition_keys) if (!def.has(key)) throw std::invalid_argument(std::string("missing field: ") + key);
    const std::string problem = def.at("problem").as_string();
    if (def.at("problem_version").as_string() != "1") throw std::invalid_argument("unsupported problem_version");
    if (!def.at("range").is_null()) throw std::invalid_argument("range is not used by this solver version");
    if (problem == "nqueens") {
        if (def.at("solver_version").as_string() != nqueens_solver) throw std::invalid_argument("unsupported solver_version");
        if (def.at("algorithm").as_string() != "bitmask-prefix") throw std::invalid_argument("unsupported algorithm");
        if (!def.at("root_state").is_null() || !def.at("depth").is_null()) throw std::invalid_argument("root_state and depth must be null for nqueens");
        const Json& params = def.at("parameters");
        if (!params.is_object() || params.members().size() != 1 || !params.has("n")) throw std::invalid_argument("parameters must be {n}");
        int64_t n = params.at("n").as_int();
        if (n < 1 || n > nqueens::max_n) throw std::invalid_argument("n out of range");
        const Json& partition = def.at("partition");
        if (!partition.is_object() || partition.members().size() != 1 || !partition.has("prefix")) throw std::invalid_argument("partition must be {prefix}");
        nqueens::make_prefix(int(n), int_list(partition.at("prefix"), size_t(n), "prefix"));
    } else if (problem == "chess") {
        if (def.at("solver_version").as_string() != chess_solver) throw std::invalid_argument("unsupported solver_version");
        if (def.at("algorithm").as_string() != "perft") throw std::invalid_argument("unsupported algorithm");
        const Json& params = def.at("parameters");
        if (!params.is_object() || !params.members().empty()) throw std::invalid_argument("chess parameters must be {}");
        const Json& root = def.at("root_state");
        if (!root.is_object() || root.members().size() != 1 || !root.has("epd") || !root.at("epd").is_string() || root.at("epd").as_string().size() > 100)
            throw std::invalid_argument("root_state must be {epd}");
        const Json& partition = def.at("partition");
        if (!partition.is_object() || partition.members().size() != 1 || !partition.has("path")) throw std::invalid_argument("partition must be {path}");
        move_list(partition.at("path"));
        if (!def.at("depth").is_int() || def.at("depth").as_int() < 0 || def.at("depth").as_int() > max_chess_depth)
            throw std::invalid_argument("depth out of range");
        chess::parse_fen(root.at("epd").as_string());
    } else {
        throw std::invalid_argument("unknown problem");
    }
}

inline Json counts_json(const chess::PerftCounts& c) {
    Json out = Json::object();
    out.set("nodes", c.nodes); out.set("captures", c.captures); out.set("en_passant", c.en_passant);
    out.set("castles", c.castles); out.set("promotions", c.promotions);
    return out;
}

struct Step {
    bool done = false;
    Json state;
    int64_t progress_permille = 0;
    uint64_t nodes = 0;
    Json result;
    Json to_json() const {
        Json out = Json::object();
        out.set("done", done); out.set("state", state); out.set("progress_permille", progress_permille);
        out.set("nodes", nodes); out.set("result", result);
        return out;
    }
};

inline int64_t state_int(const Json& state, const char* key) {
    return state.is_object() && state.has(key) ? state.at(key).as_int() : 0;
}

inline Step step_nqueens(const Json& def, const Json& state, uint64_t budget) {
    const int n = int(def.at("parameters").at("n").as_int());
    const std::vector<int> columns = int_list(def.at("partition").at("prefix"), size_t(n), "prefix");
    const nqueens::Prefix base = nqueens::make_prefix(n, columns);
    std::vector<std::vector<int>> subtrees;
    nqueens::expand(n, base, {}, std::min(3, n - base.depth), subtrees);
    int64_t cursor = state_int(state, "cursor");
    uint64_t count = uint64_t(state_int(state, "count")), nodes = uint64_t(state_int(state, "nodes"));
    if (cursor < 0 || cursor > int64_t(subtrees.size())) throw std::invalid_argument("checkpoint cursor out of range");
    uint64_t used = 0;
    while (cursor < int64_t(subtrees.size()) && (used < budget || used == 0)) {
        nqueens::Prefix p = base;
        for (int col : subtrees[size_t(cursor)]) nqueens::place(n, p, col);
        uint64_t visited = 0;
        count += nqueens::count(p, n, visited);
        used += visited; nodes += visited; ++cursor;
    }
    Step step;
    step.done = cursor == int64_t(subtrees.size());
    Json s = Json::object();
    s.set("cursor", cursor); s.set("count", count); s.set("nodes", nodes);
    step.state = s;
    step.nodes = nodes;
    step.progress_permille = subtrees.empty() ? 1000 : cursor * 1000 / int64_t(subtrees.size());
    if (step.done) { Json r = Json::object(); r.set("solutions", count); step.result = r; }
    return step;
}

inline Step step_chess(const Json& def, const Json& state, uint64_t budget) {
    chess::Position root = chess::parse_fen(def.at("root_state").at("epd").as_string());
    for (const std::string& text : move_list(def.at("partition").at("path")))
        root = chess::normalize(chess::make(root, chess::parse_uci(root, text)));
    const int depth = int(def.at("depth").as_int());
    Step step;
    if (depth == 0) {
        chess::PerftCounts c; c.nodes = 1;
        step.done = true; step.state = Json::object(); step.nodes = 1; step.progress_permille = 1000;
        step.result = counts_json(c);
        return step;
    }
    const int split = std::max(0, std::min(depth - 1, 2));
    std::vector<chess::Position> frontier{root};
    for (int level = 0; level < split; ++level) {
        std::vector<chess::Position> next;
        for (const auto& p : frontier)
            for (const chess::Move& m : chess::legal_moves(p)) next.push_back(chess::make(p, m));
        frontier.swap(next);
    }
    int64_t cursor = state_int(state, "cursor");
    if (cursor < 0 || cursor > int64_t(frontier.size())) throw std::invalid_argument("checkpoint cursor out of range");
    chess::PerftCounts total;
    total.nodes = uint64_t(state_int(state, "nodes")); total.captures = uint64_t(state_int(state, "captures"));
    total.en_passant = uint64_t(state_int(state, "en_passant")); total.castles = uint64_t(state_int(state, "castles"));
    total.promotions = uint64_t(state_int(state, "promotions"));
    uint64_t used = 0;
    while (cursor < int64_t(frontier.size()) && (used < budget || used == 0)) {
        chess::PerftCounts part = chess::perft(frontier[size_t(cursor)], depth - split);
        total.add(part);
        used += part.nodes; ++cursor;
    }
    step.done = cursor == int64_t(frontier.size());
    Json s = counts_json(total);
    s.set("cursor", cursor);
    step.state = s;
    step.nodes = total.nodes;
    step.progress_permille = frontier.empty() ? 1000 : cursor * 1000 / int64_t(frontier.size());
    if (step.done) step.result = counts_json(total);
    return step;
}

inline Step step(const Json& def, const Json& state, uint64_t budget) {
    validate(def);
    return def.at("problem").as_string() == "nqueens" ? step_nqueens(def, state, budget) : step_chess(def, state, budget);
}

// Runs a job to completion (no checkpoint needed for native batch use).
inline Json run_to_completion(const Json& def, uint64_t& nodes) {
    Json state;
    for (;;) {
        Step s = step(def, state, uint64_t(1) << 40);
        state = s.state;
        if (s.done) { nodes = s.nodes; return s.result; }
    }
}

inline std::vector<Json> plan_nqueens(int n, int depth) {
    if (n < 1 || n > nqueens::max_n || depth < 0 || depth > 6 || depth > n) throw std::invalid_argument("bad nqueens plan parameters");
    std::vector<std::vector<int>> prefixes;
    nqueens::expand(n, nqueens::Prefix{}, {}, depth, prefixes);
    std::vector<Json> defs;
    for (const auto& columns : prefixes) {
        Json params = Json::object(); params.set("n", n);
        Json prefix = Json::array();
        for (int c : columns) prefix.push(c);
        Json partition = Json::object(); partition.set("prefix", prefix);
        defs.push_back(make_definition("nqueens", nqueens_solver, "bitmask-prefix", params, Json(), partition, Json()));
    }
    return defs;
}

inline std::vector<Json> plan_chess(int path_depth, int depth) {
    if (path_depth < 0 || path_depth > 4 || depth < path_depth || depth > max_chess_depth) throw std::invalid_argument("bad chess plan parameters");
    struct Node { chess::Position pos; std::vector<std::string> path; };
    std::vector<Node> frontier{{chess::start_position(), {}}};
    for (int level = 0; level < path_depth; ++level) {
        std::vector<Node> next;
        for (const Node& node : frontier)
            for (const chess::Move& m : chess::legal_moves(node.pos)) {
                Node child{chess::normalize(chess::make(node.pos, m)), node.path};
                child.path.push_back(chess::uci(m));
                next.push_back(std::move(child));
            }
        frontier.swap(next);
    }
    const std::string root_epd = chess::epd(chess::start_position());
    std::vector<Json> defs;
    for (const Node& node : frontier) {
        Json root = Json::object(); root.set("epd", root_epd);
        Json path = Json::array();
        for (const auto& move : node.path) path.push(move);
        Json partition = Json::object(); partition.set("path", path);
        defs.push_back(make_definition("chess", chess_solver, "perft", Json::object(), root, partition, depth - path_depth));
    }
    return defs;
}

}  // namespace forge::jobs
