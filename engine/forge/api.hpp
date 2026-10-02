// One JSON-in/JSON-out entry point shared by the native CLI, the WebAssembly module and tests.
#pragma once
#include <algorithm>
#include <set>
#include <string>

#include "chess.hpp"
#include "jobs.hpp"
#include "json.hpp"
#include "lights.hpp"
#include "nqueens.hpp"
#include "puzzle8.hpp"
#include "tictactoe.hpp"

namespace forge::api {

inline Json ok(Json result) {
    Json out = Json::object();
    out.set("ok", true); out.set("result", std::move(result));
    return out;
}

inline Json fail(const std::string& message) {
    Json out = Json::object();
    out.set("ok", false); out.set("error", message);
    return out;
}

inline Json string_array(const std::vector<std::string>& items) {
    Json out = Json::array();
    for (const auto& item : items) out.push(item);
    return out;
}

inline const tictactoe::Analysis& ttt() { static const tictactoe::Analysis analysis; return analysis; }
inline const puzzle8::Graph& eight() { static const puzzle8::Graph graph; return graph; }
inline const lights::Algebra& algebra() { static const lights::Algebra a; return a; }

inline const char* verdict(int v) { return v > 0 ? "x_win" : v < 0 ? "o_win" : "draw"; }

inline Json ttt_position(const std::string& board) {
    tictactoe::validate_board(board);
    const auto& analysis = ttt();
    Json out = Json::object();
    out.set("board", board);
    if (!analysis.is_reachable(board)) { out.set("reachable", false); return out; }
    const int x = int(std::count(board.begin(), board.end(), 'x')), o = int(std::count(board.begin(), board.end(), 'o'));
    const int winner = tictactoe::winner_of(board);
    const bool terminal = winner != 0 || x + o == 9;
    out.set("reachable", true);
    out.set("ply", x + o);
    out.set("turn", terminal ? Json() : Json(x == o ? "x" : "o"));
    out.set("winner", winner == 1 ? Json("x") : winner == 2 ? Json("o") : Json());
    out.set("terminal", terminal);
    out.set("minimax", verdict(analysis.minimax(board)));
    Json children = Json::array(), parents = Json::array();
    if (!terminal)
        for (int i = 0; i < 9; ++i) {
            if (board[i] != '-') continue;
            std::string next = board; next[i] = x == o ? 'x' : 'o';
            Json c = Json::object(); c.set("move", i); c.set("board", next); c.set("minimax", verdict(analysis.minimax(next)));
            children.push(c);
        }
    const char last = x == o + 1 ? 'x' : 'o';
    if (x + o > 0)
        for (int i = 0; i < 9; ++i) {
            if (board[i] != last) continue;
            std::string previous = board; previous[i] = '-';
            if (!analysis.is_reachable(previous) || tictactoe::winner_of(previous)) continue;
            Json p = Json::object(); p.set("move", i); p.set("board", previous); p.set("player", std::string(1, last));
            parents.push(p);
        }
    out.set("children", children); out.set("parents", parents);
    return out;
}

inline Json ttt_stats() {
    const auto& analysis = ttt();
    std::set<std::string> canonical, canonical_terminal;
    for (int c = 0; c < 19683; ++c) {
        if (!analysis.reachable[c]) continue;
        std::string board; int v = c;
        for (int i = 0; i < 9; ++i) { board += "-xo"[v % 3]; v /= 3; }
        std::string best = board;
        for (int s = 1; s < 8; ++s) best = std::min(best, tictactoe::transform(board, s));
        canonical.insert(best);
        bool terminal = tictactoe::winner_of(board) || std::count(board.begin(), board.end(), '-') == 0;
        if (terminal) canonical_terminal.insert(best);
    }
    Json out = Json::object();
    out.set("reachable_positions", analysis.reachable_count);
    out.set("terminal_positions", analysis.terminal);
    out.set("complete_games", analysis.games);
    out.set("x_wins", analysis.x_wins); out.set("o_wins", analysis.o_wins); out.set("draws", analysis.draws);
    out.set("maximum_depth", analysis.max_depth);
    out.set("canonical_positions", canonical.size());
    out.set("canonical_terminal_positions", canonical_terminal.size());
    out.set("perfect_play", verdict(analysis.minimax(std::string(9, '-'))));
    return out;
}

inline Json puzzle8_solve(const std::string& text) {
    const auto& graph = eight();
    puzzle8::Board board = puzzle8::parse(text);
    Json out = Json::object();
    out.set("board", text);
    if (!graph.solvable(board)) { out.set("solvable", false); return out; }
    std::string moves = graph.path(board);
    Json path = Json::array();
    path.push(text);
    puzzle8::Board replay = board;
    for (char move : moves) { puzzle8::apply(replay, move); path.push(puzzle8::format(replay)); }
    if (replay != puzzle8::goal) throw std::logic_error("path does not solve board");
    out.set("solvable", true); out.set("distance", moves.size()); out.set("moves", moves); out.set("path", path);
    return out;
}

inline Json puzzle8_stats() {
    const auto& graph = eight();
    Json hist = Json::array();
    for (uint64_t v : graph.histogram) hist.push(v);
    Json out = Json::object();
    out.set("reachable_states", graph.order.size()); out.set("diameter", graph.diameter); out.set("histogram", hist);
    return out;
}

inline Json lights_solve(const std::string& text) {
    const auto& a = algebra();
    uint32_t board = lights::parse_board(text), presses = 0;
    int length = 0;
    Json out = Json::object();
    out.set("board", text);
    if (!a.solve(board, presses, length)) { out.set("solvable", false); return out; }
    Json replay = Json::array();
    uint32_t state = board;
    replay.push(lights::format_board(state));
    for (int i = 0; i < lights::cells; ++i)
        if (presses & (uint32_t(1) << i)) { state ^= a.columns[i]; replay.push(lights::format_board(state)); }
    if (state != 0) throw std::logic_error("press sequence does not clear the board");
    out.set("solvable", true); out.set("minimum_moves", length);
    out.set("presses", lights::format_board(presses)); out.set("replay", replay);
    return out;
}

inline Json chess_position(const std::string& text) {
    chess::Position p = chess::parse_fen(text);
    Json out = Json::object();
    out.set("id", chess::position_id(p).hex());
    out.set("epd", chess::epd(p));
    out.set("side_to_move", p.white ? "white" : "black");
    out.set("in_check", chess::in_check(p));
    Json children = Json::array();
    auto next = chess::successors(p);
    for (const auto& [move, child] : next) {
        Json c = Json::object();
        c.set("uci", chess::uci(move)); c.set("id", chess::position_id(child).hex()); c.set("epd", chess::epd(child));
        children.push(c);
    }
    out.set("legal_moves", next.size());
    out.set("children", children);
    return out;
}

// First `limit` solutions in lexicographic order as column lists (one entry per row).
inline void collect_queens(int n, const nqueens::Prefix& p, std::vector<int>& columns, size_t limit, Json& out) {
    if (out.items().size() >= limit) return;
    if (p.depth == n) {
        Json solution = Json::array();
        for (int c : columns) solution.push(c);
        out.push(solution);
        return;
    }
    for (int col = 0; col < n && out.items().size() < limit; ++col) {
        nqueens::Prefix next = p;
        if (!nqueens::place(n, next, col)) continue;
        columns.push_back(col);
        collect_queens(n, next, columns, limit, out);
        columns.pop_back();
    }
}

inline Json queens_examples(int n, int limit) {
    if (n < 1 || n > 16 || limit < 1 || limit > 12) throw std::invalid_argument("n must be 1..16 and limit 1..12");
    Json solutions = Json::array();
    std::vector<int> columns;
    collect_queens(n, nqueens::Prefix{}, columns, size_t(limit), solutions);
    Json out = Json::object();
    out.set("n", n); out.set("solutions", solutions);
    return out;
}

inline Json dispatch(const Json& request) {
    const std::string method = request.at("method").as_string();
    const Json params = request.has("params") ? request.at("params") : Json::object();
    if (method == "engine.info") {
        Json out = Json::object();
        out.set("engine", jobs::engine_version);
        out.set("solvers", string_array({jobs::nqueens_solver, jobs::chess_solver}));
        return ok(out);
    }
    if (method == "job.id") {
        jobs::validate(params.at("def"));
        Json out = Json::object();
        out.set("job_id", jobs::job_id(params.at("def"))); out.set("canonical", jobs::canonical(params.at("def")));
        return ok(out);
    }
    if (method == "job.validate") { jobs::validate(params.at("def")); return ok(Json(true)); }
    if (method == "job.step") {
        int64_t budget = params.has("budget") ? params.at("budget").as_int() : 1000000;
        if (budget < 1 || budget > (int64_t(1) << 40)) throw std::invalid_argument("budget out of range");
        return ok(jobs::step(params.at("def"), params.get("state"), uint64_t(budget)).to_json());
    }
    if (method == "job.plan") {
        const std::string problem = params.at("problem").as_string();
        std::vector<Json> defs;
        if (problem == "nqueens") defs = jobs::plan_nqueens(int(params.at("n").as_int()), int(params.at("depth").as_int()));
        else if (problem == "chess") defs = jobs::plan_chess(int(params.at("path_depth").as_int()), int(params.at("depth").as_int()));
        else throw std::invalid_argument("unknown problem");
        Json list = Json::array();
        for (const Json& def : defs) list.push(def);
        Json out = Json::object(); out.set("jobs", list);
        return ok(out);
    }
    if (method == "result.hash") return ok(Json(sha256_hex(params.at("result").dump())));
    if (method == "nqueens.examples") return ok(queens_examples(int(params.at("n").as_int()), params.has("limit") ? int(params.at("limit").as_int()) : 4));
    if (method == "ttt.position") return ok(ttt_position(params.at("board").as_string()));
    if (method == "ttt.stats") return ok(ttt_stats());
    if (method == "puzzle8.solve") return ok(puzzle8_solve(params.at("board").as_string()));
    if (method == "puzzle8.stats") return ok(puzzle8_stats());
    if (method == "lights.solve") return ok(lights_solve(params.at("board").as_string()));
    if (method == "lights.info") {
        Json out = Json::object(); out.set("rank", algebra().rank); out.set("nullity", algebra().kernel.size());
        return ok(out);
    }
    if (method == "chess.position") return ok(chess_position(params.at("epd").as_string()));
    if (method == "chess.perft") {
        int64_t depth = params.at("depth").as_int();
        if (depth < 0 || depth > 6) throw std::invalid_argument("depth out of range for interactive perft");
        return ok(jobs::counts_json(chess::perft(chess::parse_fen(params.at("epd").as_string()), int(depth))));
    }
    throw std::invalid_argument("unknown method: " + method);
}

inline std::string handle(const std::string& request_text) {
    try {
        return dispatch(Json::parse(request_text)).dump();
    } catch (const std::exception& error) {
        return fail(error.what()).dump();
    }
}

}  // namespace forge::api
