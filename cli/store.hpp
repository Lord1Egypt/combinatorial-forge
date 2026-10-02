// Runs, jobs, verification policy, resumable local execution and chess layer enumeration.
#pragma once
#include <algorithm>
#include <atomic>
#include <csignal>
#include <iostream>
#include <map>
#include <thread>

#include "db.hpp"
#include "forge/chess.hpp"
#include "forge/jobs.hpp"

#ifndef FORGE_SOURCE_COMMIT
#define FORGE_SOURCE_COMMIT "unknown"
#endif
#ifndef FORGE_COMPILER
#define FORGE_COMPILER "unknown"
#endif
#ifndef FORGE_BUILD_TYPE
#define FORGE_BUILD_TYPE "unknown"
#endif

namespace forge::cli {

inline std::atomic<bool> stop_requested{false};
inline void on_signal(int) { stop_requested = true; }

inline std::string platform_string() {
#if defined(_WIN32)
    const char* os = "windows";
#elif defined(__APPLE__)
    const char* os = "macos";
#else
    const char* os = "linux";
#endif
#if defined(__x86_64__) || defined(_M_X64)
    const char* arch = "x86_64";
#elif defined(__aarch64__) || defined(_M_ARM64)
    const char* arch = "arm64";
#else
    const char* arch = "other";
#endif
    return std::string("native-") + os + "-" + arch;
}

struct Submission {
    std::string id, worker, hash;
    bool trusted = false;
};

struct Verdict {
    std::string status;  // submitted | verified | disputed
    std::string hash;    // verified hash, or empty
    int best_group = 0;
};

// Verification policy shared (by conformance fixtures) with the TypeScript server:
//  * a trusted submission decides the job alone;
//  * otherwise `required` submissions from distinct workers with the same hash verify it;
//  * two different hashes with no group reaching `required` leave the job disputed.
inline Verdict decide(int required, const std::vector<Submission>& subs) {
    Verdict v;
    v.status = "submitted";
    for (const auto& s : subs) if (s.trusted) { v.status = "verified"; v.hash = s.hash; v.best_group = 1; return v; }
    std::map<std::string, int> groups;
    for (const auto& s : subs) ++groups[s.hash];
    for (const auto& [hash, count] : groups) {
        v.best_group = std::max(v.best_group, count);
        if (count >= required && v.hash.empty()) { v.status = "verified"; v.hash = hash; }
    }
    if (v.status != "verified" && groups.size() >= 2) v.status = "disputed";
    return v;
}

inline int required_matches(Db& db, const std::string& problem) {
    Stmt s = db.prepare("SELECT required_matches FROM problems WHERE problem = ?1");
    s.bind(1, problem);
    return s.step() ? int(s.integer(0)) : 2;
}

inline void register_solver(Db& db, const std::string& problem, const std::string& solver) {
    Stmt s = db.prepare("INSERT OR IGNORE INTO solver_versions (problem, solver_version, engine_version, source_commit, "
                        "compiler, build_config, platform, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)");
    s.bind(1, problem).bind(2, solver).bind(3, jobs::engine_version).bind(4, FORGE_SOURCE_COMMIT)
        .bind(5, FORGE_COMPILER).bind(6, FORGE_BUILD_TYPE).bind(7, platform_string()).bind(8, now_ms());
    s.run();
}

// Re-derives a job's status from its submissions; idempotent.
inline void reevaluate(Db& db, const std::string& job_id) {
    std::string problem, previous;
    {
        Stmt j = db.prepare("SELECT problem, status FROM jobs WHERE job_id = ?1");
        j.bind(1, job_id);
        if (!j.step()) throw std::runtime_error("unknown job " + job_id);
        problem = j.text(0); previous = j.text(1);
    }
    std::vector<Submission> subs;
    {
        Stmt s = db.prepare("SELECT submission_id, worker_id, result_hash, trusted FROM submissions WHERE job_id = ?1 AND status != 'rejected' ORDER BY created_at, submission_id");
        s.bind(1, job_id);
        while (s.step()) subs.push_back({s.text(0), s.text(1), s.text(2), s.integer(3) != 0});
    }
    if (subs.empty()) return;
    Verdict verdict = decide(required_matches(db, problem), subs);
    int64_t now = now_ms();
    if (verdict.status == "verified") {
        std::string result;
        Stmt r = db.prepare("SELECT result FROM submissions WHERE job_id = ?1 AND result_hash = ?2 ORDER BY created_at LIMIT 1");
        r.bind(1, job_id).bind(2, verdict.hash);
        if (r.step()) result = r.text(0);
        Stmt u = db.prepare("UPDATE jobs SET status='verified', verified_result_hash=?2, verified_result=?3, submitted_result_hash=?2, "
                            "verification_count=?4, lease_owner=NULL, lease_until=NULL, checkpoint=NULL, updated_at=?5 WHERE job_id=?1");
        u.bind(1, job_id).bind(2, verdict.hash).bind(3, result).bind(4, verdict.best_group).bind(5, now);
        u.run();
        Stmt a = db.prepare("UPDATE submissions SET status = CASE WHEN result_hash = ?2 THEN 'verified' ELSE 'rejected' END WHERE job_id = ?1");
        a.bind(1, job_id).bind(2, verdict.hash);
        a.run();
    } else {
        Stmt u = db.prepare("UPDATE jobs SET status=?2, submitted_result_hash=?3, verified_result_hash=NULL, verified_result=NULL, "
                            "verification_count=?4, lease_owner=NULL, lease_until=NULL, checkpoint=NULL, updated_at=?5 WHERE job_id=?1");
        u.bind(1, job_id).bind(2, verdict.status).bind(3, subs.back().hash).bind(4, verdict.best_group).bind(5, now);
        u.run();
    }
    if (verdict.status != previous && (verdict.status == "verified" || verdict.status == "disputed")) {
        std::string ids;
        for (const auto& s : subs) ids += (ids.empty() ? "" : ",") + s.id;
        Stmt v = db.prepare("INSERT INTO verifications (verification_id, job_id, outcome, result_hash, submission_ids, method, created_at) "
                            "VALUES (?1,?2,?3,?4,?5,?6,?7)");
        v.bind(1, random_hex(16)).bind(2, job_id).bind(3, verdict.status);
        if (verdict.hash.empty()) v.bind(4, nullptr); else v.bind(4, verdict.hash);
        v.bind(5, ids).bind(6, verdict.status == "verified" ? "redundant-match" : "hash-mismatch").bind(7, now);
        v.run();
    }
}

inline void add_submission(Db& db, const std::string& job_id, const std::string& worker, const Json& result,
                           uint64_t nodes, int64_t runtime_ms, bool trusted = false) {
    db.transaction([&] {
        Stmt s = db.prepare("INSERT OR IGNORE INTO submissions (submission_id, job_id, worker_id, result_hash, result, nodes_processed, "
                            "runtime_ms, platform, trusted, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)");
        std::string text = result.dump();
        s.bind(1, random_hex(16)).bind(2, job_id).bind(3, worker).bind(4, sha256_hex(text)).bind(5, text)
            .bind(6, int64_t(nodes)).bind(7, runtime_ms).bind(8, platform_string()).bind(9, trusted ? 1 : 0).bind(10, now_ms());
        s.run();
        Stmt u = db.prepare("UPDATE jobs SET nodes_processed = ?2, runtime_ms = ?3, platform = ?4 WHERE job_id = ?1");
        u.bind(1, job_id).bind(2, int64_t(nodes)).bind(3, runtime_ms).bind(4, platform_string());
        u.run();
        reevaluate(db, job_id);
    });
}

struct RunInfo {
    std::string run_id;
    std::string problem;
    int64_t total = 0;
};

inline RunInfo create_run(Db& db, const std::string& problem, const std::string& solver, const Json& parameters,
                          const std::vector<Json>& defs) {
    Json identity = Json::object();
    identity.set("problem", problem); identity.set("solver_version", solver); identity.set("parameters", parameters);
    RunInfo info{sha256_hex(identity.dump()).substr(0, 24), problem, int64_t(defs.size())};
    db.transaction([&] {
        register_solver(db, problem, solver);
        Stmt r = db.prepare("INSERT OR IGNORE INTO runs (run_id, problem, solver_version, parameters, total_jobs, created_at) VALUES (?1,?2,?3,?4,?5,?6)");
        r.bind(1, info.run_id).bind(2, problem).bind(3, solver).bind(4, parameters.dump()).bind(5, info.total).bind(6, now_ms());
        r.run();
        Stmt j = db.prepare("INSERT OR IGNORE INTO jobs (job_id, run_id, problem, problem_version, solver_version, payload, status, priority, created_at, updated_at) "
                            "VALUES (?1,?2,?3,'1',?4,?5,'pending',0,?6,?6)");
        for (const Json& def : defs) {
            j.bind(1, jobs::job_id(def)).bind(2, info.run_id).bind(3, problem).bind(4, solver).bind(5, def.dump()).bind(6, now_ms());
            j.run();
        }
    });
    return info;
}

struct Claimed {
    std::string job_id, payload, checkpoint;
};

// Claims one pending job (or one whose lease expired) for a local worker; nullopt when none remain.
inline bool claim_job(Db& db, const std::string& run_id, const std::string& worker, int lease_seconds, Claimed& out) {
    return db.transaction([&] {
        int64_t now = now_ms();
        Stmt s = db.prepare("SELECT job_id, payload, checkpoint FROM jobs WHERE run_id = ?1 AND (status = 'pending' OR "
                            "(status IN ('leased','running') AND lease_until < ?2)) ORDER BY priority DESC, created_at, job_id LIMIT 1");
        s.bind(1, run_id).bind(2, now);
        if (!s.step()) return false;
        out = {s.text(0), s.text(1), s.is_null(2) ? "" : s.text(2)};
        Stmt u = db.prepare("UPDATE jobs SET status='leased', lease_owner=?2, lease_until=?3, attempts=attempts+1, updated_at=?4 WHERE job_id=?1");
        u.bind(1, out.job_id).bind(2, worker).bind(3, now + int64_t(lease_seconds) * 1000).bind(4, now);
        u.run();
        return true;
    });
}

inline void save_checkpoint(Db& db, const std::string& job_id, const Json& state, uint64_t nodes, int lease_seconds) {
    Stmt u = db.prepare("UPDATE jobs SET status='running', checkpoint=?2, checkpoint_at=?3, nodes_processed=?4, lease_until=?5, updated_at=?3 WHERE job_id=?1");
    int64_t now = now_ms();
    u.bind(1, job_id).bind(2, state.dump()).bind(3, now).bind(4, int64_t(nodes)).bind(5, now + int64_t(lease_seconds) * 1000);
    u.run();
}

inline void release_job(Db& db, const std::string& job_id) {
    // Immediately re-claimable after an orderly stop; the checkpoint stays in place.
    Stmt u = db.prepare("UPDATE jobs SET lease_until = 0, updated_at = ?2 WHERE job_id = ?1 AND status IN ('leased','running')");
    u.bind(1, job_id).bind(2, now_ms());
    u.run();
}

inline Json aggregate_run(Db& db, const std::string& run_id, bool store = true) {
    std::string problem, parameters;
    {
        Stmt r = db.prepare("SELECT problem, parameters FROM runs WHERE run_id = ?1");
        r.bind(1, run_id);
        if (!r.step()) throw std::runtime_error("unknown run");
        problem = r.text(0); parameters = r.text(1);
    }
    Json params = Json::parse(parameters);
    int64_t total = 0, verified = 0, computed = 0;
    uint64_t solutions = 0;
    chess::PerftCounts counts;
    Stmt s = db.prepare("SELECT j.status, j.verified_result, (SELECT result FROM submissions WHERE job_id = j.job_id ORDER BY created_at LIMIT 1) "
                        "FROM jobs j WHERE j.run_id = ?1");
    s.bind(1, run_id);
    while (s.step()) {
        ++total;
        std::string status = s.text(0);
        std::string text = s.is_null(1) ? (s.is_null(2) ? "" : s.text(2)) : s.text(1);
        if (status == "verified") ++verified;
        if (text.empty() || (status != "verified" && status != "submitted")) continue;
        ++computed;
        Json result = Json::parse(text);
        if (problem == "nqueens") solutions += uint64_t(result.at("solutions").as_int());
        else {
            counts.nodes += uint64_t(result.at("nodes").as_int()); counts.captures += uint64_t(result.at("captures").as_int());
            counts.en_passant += uint64_t(result.at("en_passant").as_int()); counts.castles += uint64_t(result.at("castles").as_int());
            counts.promotions += uint64_t(result.at("promotions").as_int());
        }
    }
    Json out = Json::object();
    out.set("problem", problem); out.set("parameters", params);
    out.set("total_jobs", total); out.set("computed_jobs", computed); out.set("verified_jobs", verified);
    if (problem == "nqueens") out.set("solutions", solutions);
    else out.set("perft", jobs::counts_json(counts));
    if (store) {
        Stmt u = db.prepare("INSERT INTO aggregate_results (run_id, result, result_hash, verified_jobs, total_jobs, complete, updated_at) "
                            "VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(run_id) DO UPDATE SET result=?2, result_hash=?3, verified_jobs=?4, total_jobs=?5, complete=?6, updated_at=?7");
        std::string text = out.dump();
        u.bind(1, run_id).bind(2, text).bind(3, sha256_hex(text)).bind(4, verified).bind(5, total).bind(6, (total > 0 && verified == total) ? 1 : 0).bind(7, now_ms());
        u.run();
        if (total > 0 && verified == total) {
            Stmt c = db.prepare("UPDATE runs SET status='complete', completed_at=?2 WHERE run_id=?1 AND status='active'");
            c.bind(1, run_id).bind(2, now_ms());
            c.run();
        }
    }
    return out;
}

struct ExecOptions {
    int workers = 1;
    int lease_seconds = 900;
    uint64_t step_budget = 4000000;
    bool quiet = false;
};

// Runs every pending job of `run_id` on a worker pool, checkpointing as it goes.
inline void execute_run(Db& db, const std::string& run_id, const ExecOptions& options) {
    std::atomic<int64_t> finished{0}, nodes_total{0};
    auto worker = [&](int index) {
        const std::string name = "local-" + std::to_string(index) + "-" + random_hex(4);
        for (;;) {
            if (stop_requested) return;
            Claimed claimed;
            { std::lock_guard<std::mutex> lock(db.mutex()); if (!claim_job(db, run_id, name, options.lease_seconds, claimed)) return; }
            Json def = Json::parse(claimed.payload);
            Json state = claimed.checkpoint.empty() ? Json() : Json::parse(claimed.checkpoint);
            const auto started = std::chrono::steady_clock::now();
            auto last_save = started;
            uint64_t previous_nodes = state.is_object() && state.has("nodes") ? uint64_t(state.at("nodes").as_int()) : 0;
            for (;;) {
                jobs::Step step = jobs::step(def, state, options.step_budget);
                state = step.state;
                nodes_total += int64_t(step.nodes - previous_nodes);
                previous_nodes = step.nodes;
                if (step.done) {
                    int64_t ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
                    std::lock_guard<std::mutex> lock(db.mutex());
                    add_submission(db, claimed.job_id, name, step.result, step.nodes, ms);
                    ++finished;
                    break;
                }
                bool stopping = stop_requested;
                auto now = std::chrono::steady_clock::now();
                if (stopping || now - last_save > std::chrono::seconds(1)) {
                    std::lock_guard<std::mutex> lock(db.mutex());
                    save_checkpoint(db, claimed.job_id, state, step.nodes, options.lease_seconds);
                    if (stopping) release_job(db, claimed.job_id);
                    last_save = now;
                }
                if (stopping) return;
            }
        }
    };
    std::vector<std::thread> threads;
    for (int i = 0; i < options.workers; ++i) threads.emplace_back(worker, i);
    std::atomic<bool> done{false};
    std::thread reporter([&] {
        while (!done) {
            for (int i = 0; i < 20 && !done; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(100));
            if (done || options.quiet) continue;
            std::lock_guard<std::mutex> lock(db.mutex());
            int64_t total = scalar(db, "SELECT COUNT(*) FROM jobs WHERE run_id = '" + run_id + "'");
            int64_t open = scalar(db, "SELECT COUNT(*) FROM jobs WHERE run_id = '" + run_id + "' AND status IN ('pending','leased','running')");
            std::cerr << "run " << run_id.substr(0, 8) << ": " << (total - open) << "/" << total << " jobs complete, " << nodes_total.load() << " nodes\r" << std::flush;
        }
    });
    for (auto& t : threads) t.join();
    done = true;
    reporter.join();
    if (!options.quiet) std::cerr << "\n";
    std::lock_guard<std::mutex> lock(db.mutex());
    aggregate_run(db, run_id);
}

// Independently recomputes every 'submitted' job of a run from scratch under a distinct worker id.
inline int64_t verify_run(Db& db, const std::string& run_id, int workers) {
    std::vector<std::pair<std::string, std::string>> pending;
    {
        Stmt s = db.prepare("SELECT job_id, payload FROM jobs WHERE run_id = ?1 AND status IN ('submitted','disputed') ORDER BY job_id");
        s.bind(1, run_id);
        while (s.step()) pending.emplace_back(s.text(0), s.text(1));
    }
    std::atomic<size_t> cursor{0};
    std::atomic<int64_t> checked{0};
    auto work = [&](int index) {
        const std::string name = "verifier-" + std::to_string(index) + "-" + random_hex(4);
        for (;;) {
            size_t i = cursor++;
            if (i >= pending.size() || stop_requested) return;
            Json def = Json::parse(pending[i].second);
            const auto started = std::chrono::steady_clock::now();
            uint64_t nodes = 0;
            // A different step budget walks a different checkpoint path through the same job.
            Json state; jobs::Step step;
            do { step = jobs::step(def, state, 750001); state = step.state; } while (!step.done);
            nodes = step.nodes;
            int64_t ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
            std::lock_guard<std::mutex> lock(db.mutex());
            add_submission(db, pending[i].first, name, step.result, nodes, ms);
            ++checked;
        }
    };
    std::vector<std::thread> threads;
    for (int i = 0; i < workers; ++i) threads.emplace_back(work, i);
    for (auto& t : threads) t.join();
    aggregate_run(db, run_id);
    return checked;
}

inline std::vector<std::string> active_runs(Db& db, const std::string& problem = "") {
    std::vector<std::string> out;
    Stmt s = db.prepare("SELECT run_id FROM runs WHERE status = 'active' AND (?1 = '' OR problem = ?1) ORDER BY created_at");
    s.bind(1, problem);
    while (s.step()) out.push_back(s.text(0));
    return out;
}

// ---- chess layer enumeration ------------------------------------------------------------------

struct LayerOptions {
    int depth = 4;
    int edges_up_to_ply = 4;  // store parent/child edges for plies <= this
    int perft_up_to_ply = 6;  // also count move sequences for plies <= this
    size_t batch = 2000;
};

// Resumable breadth-first enumeration of *distinct* positions per ply. Re-running continues
// from the unexpanded members; each batch commits atomically with its expanded flags.
inline std::string run_layers(Db& db, const LayerOptions& options, bool quiet) {
    Json params = Json::object();
    params.set("kind", "layers");
    const std::string solver = "chess-layers/1";
    Json identity = Json::object();
    identity.set("problem", "chess"); identity.set("solver_version", solver); identity.set("parameters", params);
    const std::string run_id = sha256_hex(identity.dump()).substr(0, 24);
    db.transaction([&] {
        register_solver(db, "chess", solver);
        Stmt r = db.prepare("INSERT OR IGNORE INTO runs (run_id, problem, solver_version, parameters, total_jobs, created_at) VALUES (?1,'chess',?2,?3,0,?4)");
        r.bind(1, run_id).bind(2, solver).bind(3, params.dump()).bind(4, now_ms());
        r.run();
        chess::Position start = chess::start_position();
        const std::string id = chess::position_id(start).hex();
        Stmt m = db.prepare("INSERT OR IGNORE INTO chess_layer_members (run_id, ply, position_id, packed) VALUES (?1,0,?2,?3)");
        m.bind(1, run_id).bind(2, id).bind_blob(3, chess::pack(start));
        m.run();
        Stmt p = db.prepare("INSERT OR IGNORE INTO chess_positions (position_id, epd, first_ply, legal_moves) VALUES (?1,?2,0,?3)");
        p.bind(1, id).bind(2, chess::epd(start)).bind(3, int64_t(chess::legal_moves(start).size()));
        p.run();
        Stmt l = db.prepare("INSERT OR IGNORE INTO chess_layers (run_id, ply, unique_positions, move_sequences, status) VALUES (?1,0,1,1,'complete')");
        l.bind(1, run_id);
        l.run();
    });
    for (int ply = 0; ply < options.depth && !stop_requested; ++ply) {
        {
            Stmt done = db.prepare("SELECT status FROM chess_layers WHERE run_id = ?1 AND ply = ?2");
            done.bind(1, run_id).bind(2, ply + 1);
            if (done.step() && done.text(0) == "complete") continue;
        }
        Stmt mark = db.prepare("INSERT INTO chess_layers (run_id, ply, unique_positions, move_sequences, status) VALUES (?1,?2,0,NULL,'partial') "
                               "ON CONFLICT(run_id, ply) DO NOTHING");
        mark.bind(1, run_id).bind(2, ply + 1);
        mark.run();
        for (;;) {
            if (stop_requested) break;
            std::vector<std::pair<std::string, std::string>> batch;
            {
                Stmt s = db.prepare("SELECT position_id, packed FROM chess_layer_members WHERE run_id = ?1 AND ply = ?2 AND expanded = 0 LIMIT ?3");
                s.bind(1, run_id).bind(2, ply).bind(3, int64_t(options.batch));
                while (s.step()) batch.emplace_back(s.text(0), s.blob(1));
            }
            if (batch.empty()) break;
            db.transaction([&] {
                Stmt member = db.prepare("INSERT OR IGNORE INTO chess_layer_members (run_id, ply, position_id, packed) VALUES (?1,?2,?3,?4)");
                Stmt position = db.prepare("INSERT OR IGNORE INTO chess_positions (position_id, epd, first_ply, legal_moves) VALUES (?1,?2,?3,?4)");
                Stmt edge = db.prepare("INSERT OR IGNORE INTO chess_edges (parent_id, child_id, uci) VALUES (?1,?2,?3)");
                Stmt flag = db.prepare("UPDATE chess_layer_members SET expanded = 1 WHERE run_id = ?1 AND ply = ?2 AND position_id = ?3");
                for (const auto& [parent_id, packed] : batch) {
                    chess::Position parent = chess::unpack(packed);
                    for (const auto& [move, child] : chess::successors(parent)) {
                        const std::string child_id = chess::position_id(child).hex();
                        member.bind(1, run_id).bind(2, ply + 1).bind(3, child_id).bind_blob(4, chess::pack(child));
                        member.run();
                        if (db.changes() > 0) {  // first arrival in this layer: record the identity once
                            position.bind(1, child_id).bind(2, chess::epd(child)).bind(3, ply + 1)
                                .bind(4, int64_t(chess::legal_moves(child).size()));
                            position.run();
                        }
                        if (ply + 1 <= options.edges_up_to_ply) {
                            edge.bind(1, parent_id).bind(2, child_id).bind(3, chess::uci(move));
                            edge.run();
                        }
                    }
                    flag.bind(1, run_id).bind(2, ply).bind(3, parent_id);
                    flag.run();
                }
            });
        }
        if (stop_requested) break;
        int64_t unique = 0;
        {
            Stmt c = db.prepare("SELECT COUNT(*) FROM chess_layer_members WHERE run_id = ?1 AND ply = ?2");
            c.bind(1, run_id).bind(2, ply + 1);
            if (c.step()) unique = c.integer(0);
        }
        Stmt fin = db.prepare("UPDATE chess_layers SET unique_positions = ?3, move_sequences = ?4, status = 'complete' WHERE run_id = ?1 AND ply = ?2");
        fin.bind(1, run_id).bind(2, ply + 1).bind(3, unique);
        if (ply + 1 <= options.perft_up_to_ply) fin.bind(4, int64_t(chess::perft(chess::start_position(), ply + 1).nodes));
        else fin.bind(4, nullptr);
        fin.run();
        if (!quiet) std::cerr << "ply " << (ply + 1) << ": " << unique << " unique positions\n";
    }
    return run_id;
}

}  // namespace forge::cli
