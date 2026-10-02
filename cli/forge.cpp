// forge: native resumable solver, local database tool and distributed contributor.
#include <cstdlib>
#include <iostream>
#include <map>

#include "forge/api.hpp"
#include "remote.hpp"
#include "server.hpp"

using namespace forge;
using namespace forge::cli;

namespace {

struct Args {
    std::vector<std::string> positional;
    std::map<std::string, std::string> options;
    std::string get(const std::string& key, const std::string& fallback = "") const {
        auto it = options.find(key);
        return it == options.end() ? fallback : it->second;
    }
    int64_t number(const std::string& key, int64_t fallback, int64_t lo, int64_t hi) const {
        auto it = options.find(key);
        if (it == options.end()) return fallback;
        const std::string& text = it->second;
        if (text.empty() || text.size() > 12) throw std::invalid_argument("--" + key + " must be a number");
        for (char c : text) if (c < '0' || c > '9') throw std::invalid_argument("--" + key + " must be a non-negative number");
        int64_t value = std::stoll(text);
        if (value < lo || value > hi) throw std::invalid_argument("--" + key + " must be between " + std::to_string(lo) + " and " + std::to_string(hi));
        return value;
    }
    bool flag(const std::string& key) const { return options.count(key) != 0; }
};

const char* usage = R"(forge - exact solvers, resumable exhaustive search, distributed verification

  forge init      [--db forge.sqlite]
  forge run nqueens --n N [--split K] [--workers W] [--db FILE]
  forge run chess   --depth D [--split P] [--workers W] [--db FILE]     (move-sequence counts, perft)
  forge layers      --depth D [--edges-ply E] [--db FILE]               (distinct positions per ply)
  forge resume    [--workers W] [--db FILE]
  forge verify    [--workers W] [--db FILE]       recompute submitted jobs independently
  forge status    [--db FILE]
  forge serve     [--port 8787] [--db FILE]       read-only explorer on 127.0.0.1
  forge export    --output FILE[.zst] [--max-ply P] [--db FILE]
  forge import    FILE[.zst] [--resolve existing|incoming] [--db FILE]
  forge merge     A.sqlite B.sqlite OUT.sqlite [--resolve existing|incoming]
  forge connect   URL [--db FILE]
  forge contribute PROBLEM [--workers W] [--max-jobs N] [--exit-when-idle] [--db FILE]
  forge call      '{"method":"engine.info"}'      raw engine API (same API the WASM module exposes)
)";

Args parse_args(int argc, char** argv, int first) {
    Args args;
    static const std::set<std::string> flags = {"exit-when-idle", "help"};
    for (int i = first; i < argc; ++i) {
        std::string a = argv[i];
        if (a.rfind("--", 0) == 0) {
            std::string key = a.substr(2);
            if (flags.count(key)) { args.options[key] = "1"; continue; }
            if (i + 1 >= argc) throw std::invalid_argument("missing value for " + a);
            args.options[key] = argv[++i];
        } else args.positional.push_back(a);
    }
    return args;
}

std::unique_ptr<Db> open_db(const Args& args) {
    auto db = std::make_unique<Db>(args.get("db", "forge.sqlite"));
    migrate(*db);
    return db;
}

int cmd_run(const Args& args) {
    if (args.positional.empty()) throw std::invalid_argument("run needs a problem: nqueens or chess");
    auto db = open_db(args);
    const std::string problem = args.positional[0];
    std::vector<Json> defs;
    Json params = Json::object();
    std::string solver;
    if (problem == "nqueens") {
        int n = int(args.number("n", 0, 1, nqueens::max_n));
        if (n == 0) throw std::invalid_argument("--n is required");
        int split = int(args.number("split", std::min(3, n), 0, 6));
        if (split > n) split = n;
        defs = jobs::plan_nqueens(n, split);
        params.set("n", n); params.set("split", split);
        solver = jobs::nqueens_solver;
    } else if (problem == "chess") {
        int depth = int(args.number("depth", 0, 1, jobs::max_chess_depth));
        if (depth == 0) throw std::invalid_argument("--depth is required");
        int split = int(args.number("split", std::min(2, depth), 0, std::min(4, depth)));
        defs = jobs::plan_chess(split, depth);
        params.set("depth", depth); params.set("split", split);
        solver = jobs::chess_solver;
    } else throw std::invalid_argument("unknown problem: " + problem);
    RunInfo run = create_run(*db, problem, solver, params, defs);
    ExecOptions options;
    options.workers = int(args.number("workers", 1, 1, 256));
    execute_run(*db, run.run_id, options);
    Json out = aggregate_run(*db, run.run_id);
    out.set("run_id", run.run_id);
    out.set("interrupted", stop_requested.load());
    std::cout << out.dump() << "\n";
    return stop_requested ? 130 : 0;
}

int cmd_layers(const Args& args) {
    auto db = open_db(args);
    LayerOptions options;
    options.depth = int(args.number("depth", 0, 1, 7));
    if (options.depth == 0) throw std::invalid_argument("--depth is required");
    options.edges_up_to_ply = int(args.number("edges-ply", 4, 0, 7));
    set_meta(*db, "layers_depth", std::to_string(options.depth));
    set_meta(*db, "layers_edges_ply", std::to_string(options.edges_up_to_ply));
    std::string run_id = run_layers(*db, options, false);
    Json rows = dump_rows(*db, "SELECT ply, unique_positions, move_sequences, status FROM chess_layers WHERE run_id = '" + run_id + "' ORDER BY ply");
    Json out = Json::object();
    out.set("run_id", run_id); out.set("layers", rows); out.set("interrupted", stop_requested.load());
    std::cout << out.dump() << "\n";
    return stop_requested ? 130 : 0;
}

int cmd_resume(const Args& args) {
    auto db = open_db(args);
    ExecOptions options;
    options.workers = int(args.number("workers", 1, 1, 256));
    Json summary = Json::array();
    for (const std::string& run_id : active_runs(*db)) {
        std::string solver;
        { Stmt s = db->prepare("SELECT solver_version FROM runs WHERE run_id = ?1"); s.bind(1, run_id); if (s.step()) solver = s.text(0); }
        if (solver == "chess-layers/1") continue;
        if (scalar(*db, "SELECT COUNT(*) FROM jobs WHERE run_id = '" + run_id + "' AND status IN ('pending','leased','running')") == 0) continue;
        execute_run(*db, run_id, options);
        Json a = aggregate_run(*db, run_id); a.set("run_id", run_id); summary.push(a);
        if (stop_requested) break;
    }
    const std::string depth = get_meta(*db, "layers_depth");
    if (!depth.empty() && !stop_requested) {
        LayerOptions layer;
        layer.depth = std::atoi(depth.c_str());
        layer.edges_up_to_ply = std::atoi(get_meta(*db, "layers_edges_ply").c_str());
        run_layers(*db, layer, false);
    }
    Json out = Json::object();
    out.set("resumed_runs", summary); out.set("interrupted", stop_requested.load());
    std::cout << out.dump() << "\n";
    return stop_requested ? 130 : 0;
}

int cmd_verify(const Args& args) {
    auto db = open_db(args);
    int64_t checked = 0;
    for (const std::string& run_id : active_runs(*db)) checked += verify_run(*db, run_id, int(args.number("workers", 1, 1, 256)));
    Json out = Json::object();
    out.set("recomputed_jobs", checked);
    out.set("verified", scalar(*db, "SELECT COUNT(*) FROM jobs WHERE status = 'verified'"));
    out.set("disputed", scalar(*db, "SELECT COUNT(*) FROM jobs WHERE status = 'disputed'"));
    std::cout << out.dump() << "\n";
    return scalar(*db, "SELECT COUNT(*) FROM jobs WHERE status = 'disputed'") ? 1 : 0;
}

int cmd_status(const Args& args) {
    auto db = open_db(args);
    Json out = Json::object();
    out.set("schema_version", schema_version(*db));
    out.set("job_counts", dump_rows(*db, "SELECT status, COUNT(*) AS jobs FROM jobs GROUP BY status ORDER BY status"));
    out.set("runs", dump_rows(*db, "SELECT r.run_id, r.problem, r.solver_version, r.status, r.total_jobs, a.verified_jobs, a.result "
                                   "FROM runs r LEFT JOIN aggregate_results a ON a.run_id = r.run_id ORDER BY r.created_at"));
    out.set("chess_layers", dump_rows(*db, "SELECT ply, unique_positions, move_sequences, status FROM chess_layers ORDER BY ply"));
    std::cout << out.dump() << "\n";
    return 0;
}

int cmd_export(const Args& args) {
    auto db = open_db(args);
    const std::string path = args.get("output");
    if (path.empty()) throw std::invalid_argument("--output is required");
    Json snapshot = export_snapshot(*db, int(args.number("max-ply", 4, 0, 99)));
    write_snapshot_file(path, snapshot);
    Json out = Json::object();
    out.set("output", path); out.set("jobs", int64_t(snapshot.at("tables").at("jobs").items().size()));
    out.set("chess_positions", int64_t(snapshot.at("tables").at("chess_positions").items().size()));
    std::cout << out.dump() << "\n";
    return 0;
}

int cmd_import(const Args& args) {
    if (args.positional.empty()) throw std::invalid_argument("import needs a snapshot file");
    auto db = open_db(args);
    try {
        Json report = import_snapshot(*db, read_snapshot_file(args.positional[0]), args.get("resolve"));
        std::cout << report.dump() << "\n";
        return 0;
    } catch (const ConflictError& conflict) {
        Json out = Json::object();
        out.set("error", conflict.what()); out.set("conflicts", conflict.report);
        std::cout << out.dump() << "\n";
        return 3;
    }
}

int cmd_merge(const Args& args) {
    if (args.positional.size() != 3) throw std::invalid_argument("merge needs A.sqlite B.sqlite OUT.sqlite");
    std::ifstream exists(args.positional[2]);
    if (exists) throw std::runtime_error("output database already exists; refusing to overwrite " + args.positional[2]);
    auto out = std::make_unique<Db>(args.positional[2]);
    migrate(*out);
    Json combined = Json::object();
    try {
        for (int i = 0; i < 2; ++i) {
            Db source(args.positional[size_t(i)], true);
            Json report = import_snapshot(*out, export_snapshot(source, 99), args.get("resolve"));
            combined.set(i == 0 ? "a" : "b", report);
        }
    } catch (const ConflictError& conflict) {
        Json result = Json::object();
        result.set("error", conflict.what()); result.set("conflicts", conflict.report);
        std::cout << result.dump() << "\n";
        out->exec("PRAGMA wal_checkpoint(TRUNCATE)");
        out.reset();  // Windows will not remove a SQLite file while it is open.
        std::remove(args.positional[2].c_str());
        return 3;
    }
    std::cout << combined.dump() << "\n";
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    std::signal(SIGINT, on_signal);
    std::signal(SIGTERM, on_signal);
    if (argc < 2 || std::string(argv[1]) == "--help" || std::string(argv[1]) == "help") { std::cerr << usage; return argc < 2 ? 2 : 0; }
    const std::string command = argv[1];
    try {
        if (command == "call") {
            if (argc != 3) throw std::invalid_argument("call needs one JSON argument");
            std::string reply = api::handle(argv[2]);
            std::cout << reply << "\n";
            return Json::parse(reply).at("ok").as_bool() ? 0 : 1;
        }
        Args args = parse_args(argc, argv, 2);
        if (command == "info") {
            Json out = Json::object();
            out.set("engine", jobs::engine_version); out.set("platform", platform_string()); out.set("compiler", FORGE_COMPILER);
            out.set("build_type", FORGE_BUILD_TYPE); out.set("source_commit", FORGE_SOURCE_COMMIT); out.set("sqlite", sqlite3_libversion());
            std::cout << out.dump() << "\n";
            return 0;
        }
        if (command == "init") { auto db = open_db(args); std::cout << "{\"schema_version\":" << schema_version(*db) << "}\n"; return 0; }
        if (command == "run") return cmd_run(args);
        if (command == "layers") return cmd_layers(args);
        if (command == "resume") return cmd_resume(args);
        if (command == "verify") return cmd_verify(args);
        if (command == "status") return cmd_status(args);
        if (command == "serve") { auto db = open_db(args); db.reset(); return serve(args.get("db", "forge.sqlite"), int(args.number("port", 8787, 1, 65535))); }
        if (command == "export") return cmd_export(args);
        if (command == "import") return cmd_import(args);
        if (command == "merge") return cmd_merge(args);
        if (command == "connect") {
            if (args.positional.empty()) throw std::invalid_argument("connect needs a URL");
            auto db = open_db(args);
            return connect_remote(*db, args.positional[0]);
        }
        if (command == "contribute") {
            if (args.positional.empty()) throw std::invalid_argument("contribute needs a problem");
            auto db = open_db(args);
            ContributeOptions options;
            options.problem = args.positional[0];
            options.workers = int(args.number("workers", 1, 1, 256));
            options.max_jobs = args.number("max-jobs", 0, 0, 1000000000);
            options.exit_when_idle = args.flag("exit-when-idle");
            return contribute(*db, options);
        }
        std::cerr << "unknown command: " << command << "\n" << usage;
        return 2;
    } catch (const std::invalid_argument& error) {
        std::cerr << "error: " << error.what() << "\n";
        return 2;
    } catch (const std::exception& error) {
        std::cerr << "error: " << error.what() << "\n";
        return 1;
    }
}
