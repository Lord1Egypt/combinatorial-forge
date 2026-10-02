// Snapshot export, import and merge with explicit conflict handling.
#pragma once
#include <fstream>
#include <set>
#include <sstream>

#include "proc.hpp"
#include "store.hpp"

namespace forge::cli {

struct ConflictError : std::runtime_error {
    Json report;
    explicit ConflictError(Json r) : std::runtime_error("conflicting verified results; nothing was written"), report(std::move(r)) {}
};

inline Json dump_rows(Db& db, const std::string& sql) {
    Json rows = Json::array();
    Stmt s = db.prepare(sql);
    while (s.step()) {
        Json row = Json::object();
        for (int c = 0; c < s.columns(); ++c) {
            switch (s.column_type(c)) {
                case SQLITE_INTEGER: row.set(s.column_name(c), s.integer(c)); break;
                case SQLITE_TEXT: row.set(s.column_name(c), s.text(c)); break;
                default: row.set(s.column_name(c), Json()); break;
            }
        }
        rows.push(row);
    }
    return rows;
}

inline Json export_snapshot(Db& db, int max_chess_ply) {
    Json tables = Json::object();
    const std::string ply = std::to_string(max_chess_ply);
    tables.set("solver_versions", dump_rows(db, "SELECT * FROM solver_versions ORDER BY problem, solver_version"));
    tables.set("runs", dump_rows(db, "SELECT * FROM runs ORDER BY run_id"));
    tables.set("jobs", dump_rows(db, "SELECT job_id, run_id, problem, problem_version, solver_version, payload, status, priority, created_at, updated_at, "
                                     "attempts, submitted_result_hash, verified_result_hash, verified_result, nodes_processed, runtime_ms, platform, verification_count "
                                     "FROM jobs WHERE status IN ('submitted','verified','disputed') ORDER BY job_id"));
    tables.set("submissions", dump_rows(db, "SELECT * FROM submissions WHERE job_id IN (SELECT job_id FROM jobs WHERE status IN ('submitted','verified','disputed')) ORDER BY job_id, worker_id"));
    tables.set("verifications", dump_rows(db, "SELECT * FROM verifications ORDER BY job_id, created_at, verification_id"));
    tables.set("chess_positions", dump_rows(db, "SELECT * FROM chess_positions WHERE first_ply <= " + ply + " ORDER BY first_ply, position_id"));
    tables.set("chess_edges", dump_rows(db, "SELECT * FROM chess_edges WHERE parent_id IN (SELECT position_id FROM chess_positions WHERE first_ply <= " + ply +
                                            ") AND child_id IN (SELECT position_id FROM chess_positions WHERE first_ply <= " + ply + ") ORDER BY parent_id, uci"));
    tables.set("chess_layers", dump_rows(db, "SELECT * FROM chess_layers ORDER BY run_id, ply"));
    Json out = Json::object();
    out.set("format", "forge-snapshot/1");
    out.set("schema_version", schema_version(db));
    out.set("created_at", now_ms());
    out.set("engine_version", jobs::engine_version);
    out.set("project_commit", FORGE_SOURCE_COMMIT);
    out.set("tables", tables);
    return out;
}

inline std::string slurp_file(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot read " + path);
    std::stringstream ss; ss << in.rdbuf();
    return ss.str();
}

inline void write_file(const std::string& path, const std::string& data) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("cannot write " + path);
    out << data;
    if (!out) throw std::runtime_error("write failed for " + path);
}

inline void write_snapshot_file(const std::string& path, const Json& snapshot) {
    if (!ends_with(path, ".zst")) { write_file(path, snapshot.dump() + "\n"); return; }
    const std::string temp = path + ".tmp.json";
    write_file(temp, snapshot.dump() + "\n");
    int rc = run_process({"zstd", "-q", "-f", "-19", "-o", path, temp});
    std::remove(temp.c_str());
    if (rc != 0) throw std::runtime_error("zstd is required to write .zst snapshots (exit " + std::to_string(rc) + "); use a .json path instead");
}

inline Json read_snapshot_file(const std::string& path) {
    std::string text;
    if (ends_with(path, ".zst")) {
        const std::string temp = path + ".tmp.json";
        int rc = run_process({"zstd", "-q", "-d", "-f", "-o", temp, path});
        if (rc != 0) { std::remove(temp.c_str()); throw std::runtime_error("zstd is required to read .zst snapshots (exit " + std::to_string(rc) + ")"); }
        text = slurp_file(temp);
        std::remove(temp.c_str());
    } else text = slurp_file(path);
    Json snapshot = Json::parse(text);
    if (!snapshot.has("format") || snapshot.at("format").as_string() != "forge-snapshot/1") throw std::runtime_error("not a forge-snapshot/1 file");
    return snapshot;
}

inline std::set<std::string> table_columns(Db& db, const std::string& table) {
    std::set<std::string> cols;
    Stmt s = db.prepare("SELECT name FROM pragma_table_info('" + table + "')");
    while (s.step()) cols.insert(s.text(0));
    return cols;
}

inline void insert_row(Db& db, const std::string& table, const std::set<std::string>& allowed, const Json& row, bool replace = false) {
    std::string names, marks;
    std::vector<const Json*> values;
    for (const auto& [key, value] : row.members()) {
        if (!allowed.count(key)) throw std::runtime_error("unknown column '" + key + "' in table " + table);
        names += (names.empty() ? "" : ",") + key;
        marks += std::string(marks.empty() ? "?" : ",?") + std::to_string(values.size() + 1);
        values.push_back(&value);
    }
    Stmt s = db.prepare(std::string(replace ? "INSERT OR REPLACE" : "INSERT OR IGNORE") + " INTO " + table + " (" + names + ") VALUES (" + marks + ")");
    for (size_t i = 0; i < values.size(); ++i) {
        const Json& v = *values[i];
        int index = int(i) + 1;
        if (v.is_int()) s.bind(index, v.as_int());
        else if (v.is_string()) s.bind(index, v.as_string());
        else if (v.is_null()) s.bind(index, nullptr);
        else throw std::runtime_error("unsupported value type in " + table);
    }
    s.run();
}

// resolve: "" (reject conflicts), "existing" (keep local), or "incoming" (take the snapshot's value).
inline Json import_snapshot(Db& db, const Json& snapshot, const std::string& resolve) {
    if (!resolve.empty() && resolve != "existing" && resolve != "incoming") throw std::runtime_error("--resolve must be existing or incoming");
    const Json& tables = snapshot.at("tables");
    if (snapshot.at("schema_version").as_int() > schema_version(db)) throw std::runtime_error("snapshot schema is newer than this database");
    Json report = Json::object();
    Json conflicts = Json::array();
    std::set<std::string> touched_jobs, touched_runs, skipped_jobs;
    std::map<std::string, Json> incoming_verified;
    int64_t inserted_jobs = 0, inserted_submissions = 0;

    db.transaction([&] {
        // Solver versions must agree on provenance when both sides record a source hash.
        const auto solver_columns = table_columns(db, "solver_versions");
        for (const Json& row : tables.at("solver_versions").items()) {
            Stmt s = db.prepare("SELECT source_hash FROM solver_versions WHERE problem = ?1 AND solver_version = ?2");
            s.bind(1, row.at("problem").as_string()).bind(2, row.at("solver_version").as_string());
            if (s.step() && !s.is_null(0) && row.has("source_hash") && !row.at("source_hash").is_null() && s.text(0) != row.at("source_hash").as_string()) {
                Json c = Json::object(); c.set("kind", "solver_version_mismatch"); c.set("problem", row.at("problem")); c.set("solver_version", row.at("solver_version"));
                conflicts.push(c);
            }
            insert_row(db, "solver_versions", solver_columns, row);
        }
        const auto run_columns = table_columns(db, "runs");
        for (const Json& row : tables.at("runs").items()) { insert_row(db, "runs", run_columns, row); touched_runs.insert(row.at("run_id").as_string()); }

        const auto job_columns = table_columns(db, "jobs");
        for (const Json& row : tables.at("jobs").items()) {
            const std::string id = row.at("job_id").as_string();
            // The job id commits to the whole definition; a mismatching payload is corruption.
            if (jobs::job_id(Json::parse(row.at("payload").as_string())) != id) throw std::runtime_error("job " + id + " payload does not match its id");
            Stmt s = db.prepare("SELECT verified_result_hash FROM jobs WHERE job_id = ?1");
            s.bind(1, id);
            const bool exists = s.step();
            const std::string have = exists && !s.is_null(0) ? s.text(0) : "";
            const std::string want = row.has("verified_result_hash") && !row.at("verified_result_hash").is_null() ? row.at("verified_result_hash").as_string() : "";
            if (!have.empty() && !want.empty() && have != want) {
                if (resolve.empty()) {
                    Json c = Json::object(); c.set("kind", "verified_result_conflict"); c.set("job_id", id);
                    c.set("existing_hash", have); c.set("incoming_hash", want);
                    conflicts.push(c);
                    continue;
                }
                if (resolve == "existing") { skipped_jobs.insert(id); continue; }
                Stmt rej = db.prepare("UPDATE submissions SET status = 'rejected' WHERE job_id = ?1");
                rej.bind(1, id); rej.run();
                Stmt up = db.prepare("UPDATE jobs SET status='verified', verified_result_hash=?2, verified_result=?3, submitted_result_hash=?2, updated_at=?4 WHERE job_id=?1");
                up.bind(1, id).bind(2, want).bind(3, row.at("verified_result").as_string()).bind(4, now_ms());
                up.run();
                Stmt ver = db.prepare("INSERT INTO verifications (verification_id, job_id, outcome, result_hash, submission_ids, method, created_at) VALUES (?1,?2,'verified',?3,'','merge-resolve:incoming',?4)");
                ver.bind(1, random_hex(16)).bind(2, id).bind(3, want).bind(4, now_ms());
                ver.run();
            }
            if (!exists) { insert_row(db, "jobs", job_columns, row); ++inserted_jobs; }
            if (!want.empty()) incoming_verified[id] = row;
            touched_jobs.insert(id);
        }
        const auto sub_columns = table_columns(db, "submissions");
        for (const Json& row : tables.at("submissions").items()) {
            const std::string id = row.at("job_id").as_string();
            if (skipped_jobs.count(id) || !touched_jobs.count(id)) continue;
            Stmt s = db.prepare("SELECT result_hash FROM submissions WHERE job_id = ?1 AND worker_id = ?2");
            s.bind(1, id).bind(2, row.at("worker_id").as_string());
            if (s.step() && s.text(0) != row.at("result_hash").as_string()) {
                Json c = Json::object(); c.set("kind", "worker_equivocation"); c.set("job_id", id); c.set("worker_id", row.at("worker_id"));
                conflicts.push(c);
                continue;
            }
            if (sha256_hex(row.at("result").as_string()) != row.at("result_hash").as_string()) throw std::runtime_error("submission result does not match its hash");
            insert_row(db, "submissions", sub_columns, row);
            ++inserted_submissions;
        }
        if (!conflicts.items().empty() && resolve.empty()) throw ConflictError(conflicts);
        for (const std::string& id : touched_jobs) {
            reevaluate(db, id);
            auto it = incoming_verified.find(id);
            if (it == incoming_verified.end()) continue;
            Stmt s = db.prepare("SELECT status FROM jobs WHERE job_id = ?1");
            s.bind(1, id);
            if (s.step() && s.text(0) != "verified") {  // keep verification earned under the sender's policy
                Stmt up = db.prepare("UPDATE jobs SET status='verified', verified_result_hash=?2, verified_result=?3, submitted_result_hash=?2 WHERE job_id=?1");
                up.bind(1, id).bind(2, it->second.at("verified_result_hash").as_string()).bind(3, it->second.at("verified_result").as_string());
                up.run();
            }
        }
        const auto ver_columns = table_columns(db, "verifications");
        for (const Json& row : tables.at("verifications").items())
            if (touched_jobs.count(row.at("job_id").as_string()) && !skipped_jobs.count(row.at("job_id").as_string())) insert_row(db, "verifications", ver_columns, row);
        const auto pos_columns = table_columns(db, "chess_positions"), edge_columns = table_columns(db, "chess_edges"), layer_columns = table_columns(db, "chess_layers");
        for (const Json& row : tables.at("chess_positions").items()) insert_row(db, "chess_positions", pos_columns, row);
        for (const Json& row : tables.at("chess_edges").items()) insert_row(db, "chess_edges", edge_columns, row);
        for (const Json& row : tables.at("chess_layers").items()) {
            Stmt s = db.prepare("SELECT unique_positions, status FROM chess_layers WHERE run_id = ?1 AND ply = ?2");
            s.bind(1, row.at("run_id").as_string()).bind(2, row.at("ply").as_int());
            if (s.step()) {
                if (s.text(1) == "complete" && row.at("status").as_string() == "complete" && s.integer(0) != row.at("unique_positions").as_int()) {
                    Json c = Json::object(); c.set("kind", "layer_conflict"); c.set("run_id", row.at("run_id")); c.set("ply", row.at("ply"));
                    conflicts.push(c);
                    if (resolve.empty()) throw ConflictError(conflicts);
                    if (resolve == "existing") continue;
                    insert_row(db, "chess_layers", layer_columns, row, true);
                    continue;
                }
                if (s.text(1) == "complete") continue;
            }
            insert_row(db, "chess_layers", layer_columns, row, true);
        }
        for (const std::string& run : touched_runs) aggregate_run(db, run);
    });
    report.set("jobs_inserted", inserted_jobs);
    report.set("submissions_inserted", inserted_submissions);
    report.set("conflicts_resolved", resolve.empty() ? Json(0) : Json(int64_t(conflicts.items().size())));
    report.set("resolve", resolve);
    return report;
}

}  // namespace forge::cli
