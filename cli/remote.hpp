// `forge connect` / `forge contribute`: claim -> compute -> checkpoint -> submit against a deployment.
// HTTP is delegated to curl via an argument vector (no shell). Claims are persisted locally so a
// restart resumes the same work instead of abandoning it.
#pragma once
#include <filesystem>

#include "exchange.hpp"

namespace forge::cli {

struct HttpReply { int status = 0; std::string body; };

/** Curl reads request bodies from disk; keep lease tokens inside an owner-only directory. */
struct PrivateTempDir {
    std::filesystem::path path;
    PrivateTempDir() {
        namespace fs = std::filesystem;
        path = fs::temp_directory_path() / ("forge-http-" + random_hex(16));
        if (!fs::create_directory(path)) throw std::runtime_error("cannot create private request directory");
        try { fs::permissions(path, fs::perms::owner_all, fs::perm_options::replace); }
        catch (...) { fs::remove(path); throw; }
    }
    ~PrivateTempDir() { std::error_code ignored; std::filesystem::remove_all(path, ignored); }
};

inline bool valid_base_url(const std::string& url) {
    const bool secure = url.rfind("https://", 0) == 0;
    const bool local = url.rfind("http://localhost", 0) == 0 || url.rfind("http://127.0.0.1", 0) == 0;
    if (!secure && !local) return false;
    if (url.size() > 200) return false;
    for (char c : url)
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || std::string(".-:_/~").find(c) != std::string::npos)) return false;
    return true;
}

inline HttpReply http_request(const std::string& method, const std::string& url, const std::string& body) {
    namespace fs = std::filesystem;
    PrivateTempDir temp;
    const std::string body_path = (temp.path / "request").string(), out_path = (temp.path / "response").string(), head_path = (temp.path / "headers").string();
    std::vector<std::string> args = {"curl", "-sS", "--max-time", "120", "--proto", url.rfind("https://", 0) == 0 ? "=https" : "=http",
                                     "-X", method, "-H", "Accept: application/json", "-H", "User-Agent: forge-cli/1", "-o", out_path, "-D", head_path};
    if (!body.empty()) {
        write_file(body_path, body);
        args.insert(args.end(), {"-H", "Content-Type: application/json", "--data-binary", "@" + body_path});
    }
    args.push_back(url);
    int rc = run_process(args);
    HttpReply reply;
    try {
        if (rc == 0) {
            std::string headers = slurp_file(head_path);
            size_t at = headers.rfind("HTTP/");
            if (at != std::string::npos) { size_t sp = headers.find(' ', at); if (sp != std::string::npos) reply.status = std::atoi(headers.c_str() + sp + 1); }
            reply.body = slurp_file(out_path);
        }
    } catch (const std::exception&) {}
    if (rc != 0) throw std::runtime_error("curl failed (exit " + std::to_string(rc) + "); is curl installed and the server reachable?");
    return reply;
}

inline std::string get_meta(Db& db, const std::string& key) {
    Stmt s = db.prepare("SELECT value FROM meta WHERE key = ?1");
    s.bind(1, key);
    return s.step() ? s.text(0) : "";
}

inline void set_meta(Db& db, const std::string& key, const std::string& value) {
    Stmt s = db.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2");
    s.bind(1, key).bind(2, value);
    s.run();
}

inline std::string worker_identity(Db& db) {
    std::string id = get_meta(db, "worker_id");
    if (id.empty()) { id = "w-" + random_hex(12); set_meta(db, "worker_id", id); }
    return id;
}

inline int connect_remote(Db& db, std::string url) {
    while (!url.empty() && url.back() == '/') url.pop_back();
    if (!valid_base_url(url)) { std::cerr << "URL must be https:// (or http://localhost for development) with plain URL characters\n"; return 2; }
    HttpReply health = http_request("GET", url + "/api/v1/health", "");
    if (health.status != 200) { std::cerr << "server answered HTTP " << health.status << " for /api/v1/health\n"; return 1; }
    Json info = Json::parse(health.body);
    set_meta(db, "remote_url", url);
    std::cout << "connected to " << url << " (service " << info.get("service").dump() << ")\nworker id: " << worker_identity(db) << "\n";
    return 0;
}

struct ContributeOptions {
    std::string problem;
    int workers = 1;
    int64_t max_jobs = 0;  // 0 = unlimited
    bool exit_when_idle = false;
};

struct Claim {
    std::string job_id, token;
    Json def, checkpoint;
    int64_t lease_until = 0;
};

inline int contribute(Db& db, const ContributeOptions& options) {
    const std::string base = get_meta(db, "remote_url");
    if (base.empty()) { std::cerr << "not connected: run `forge connect <url>` first\n"; return 2; }
    const std::string worker = worker_identity(db);
    std::atomic<int64_t> completed{0}, nodes_total{0};
    std::atomic<bool> idle{false};

    auto post = [&](const std::string& path, const Json& body) { return http_request("POST", base + path, body.dump()); };
    auto resume_local = [&](Claim& claim) {
        std::lock_guard<std::mutex> lock(db.mutex());
        Stmt s = db.prepare("SELECT job_id, lease_token, lease_until, payload, checkpoint FROM client_claims WHERE base_url = ?1 AND lease_until > ?2 LIMIT 1");
        s.bind(1, base).bind(2, now_ms());
        if (!s.step()) return false;
        claim.job_id = s.text(0); claim.token = s.text(1); claim.lease_until = s.integer(2); claim.def = Json::parse(s.text(3));
        claim.checkpoint = s.is_null(4) ? Json() : Json::parse(s.text(4));
        return true;
    };

    auto loop = [&](int index) {
        int idle_rounds = 0;
        while (!stop_requested && !(options.max_jobs && completed >= options.max_jobs)) {
            Claim claim;
            bool resumed = index == 0 && resume_local(claim);
            if (!resumed) {
                Json request = Json::object(), caps = Json::object();
                request.set("worker_id", worker); request.set("problem", options.problem);
                caps.set("platform", platform_string()); caps.set("engine_version", jobs::engine_version);
                request.set("capabilities", caps);
                HttpReply reply = post("/api/v1/jobs/claim", request);
                if (reply.status != 200) { std::cerr << "claim failed: HTTP " << reply.status << " " << reply.body.substr(0, 200) << "\n"; std::this_thread::sleep_for(std::chrono::seconds(5)); if (++idle_rounds > 5) return; continue; }
                Json answer = Json::parse(reply.body);
                if (answer.at("job").is_null()) {
                    if (options.exit_when_idle) { idle = true; return; }
                    for (int i = 0; i < 100 && !stop_requested; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(100));
                    continue;
                }
                idle_rounds = 0;
                const Json& job = answer.at("job");
                claim.job_id = job.at("job_id").as_string(); claim.token = job.at("lease_token").as_string();
                claim.def = job.at("payload"); claim.checkpoint = job.get("checkpoint"); claim.lease_until = job.at("lease_until").as_int();
                std::lock_guard<std::mutex> lock(db.mutex());
                Stmt s = db.prepare("INSERT OR REPLACE INTO client_claims (job_id, base_url, lease_token, lease_until, payload, checkpoint, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)");
                s.bind(1, claim.job_id).bind(2, base).bind(3, claim.token).bind(4, claim.lease_until).bind(5, claim.def.dump());
                if (claim.checkpoint.is_null()) s.bind(6, nullptr); else s.bind(6, claim.checkpoint.dump());
                s.bind(7, now_ms()); s.run();
            }
            // The server's definition is validated by the engine before any work is done.
            Json state = claim.checkpoint;
            const auto started = std::chrono::steady_clock::now();
            auto last_save = started;
            uint64_t previous = state.is_object() && state.has("nodes") ? uint64_t(state.at("nodes").as_int()) : 0;
            bool abandoned = false;
            try {
                for (;;) {
                    jobs::Step step = jobs::step(claim.def, state, 4000000);
                    state = step.state;
                    nodes_total += int64_t(step.nodes - previous);
                    previous = step.nodes;
                    if (step.done) {
                        int64_t ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
                        Json body = Json::object();
                        body.set("worker_id", worker); body.set("lease_token", claim.token); body.set("result", step.result);
                        body.set("result_hash", sha256_hex(step.result.dump())); body.set("nodes_processed", step.nodes);
                        body.set("runtime_ms", ms); body.set("platform", platform_string());
                        HttpReply reply = post("/api/v1/jobs/" + claim.job_id + "/submit", body);
                        std::cerr << "submit " << claim.job_id.substr(0, 10) << ": HTTP " << reply.status << " " << reply.body.substr(0, 120) << "\n";
                        if (reply.status == 200) ++completed;
                        break;
                    }
                    auto now = std::chrono::steady_clock::now();
                    if (stop_requested || now - last_save > std::chrono::seconds(10)) {
                        std::lock_guard<std::mutex> lock(db.mutex());
                        Stmt s = db.prepare("UPDATE client_claims SET checkpoint = ?2 WHERE job_id = ?1");
                        s.bind(1, claim.job_id).bind(2, state.dump()); s.run();
                        last_save = now;
                        if (stop_requested) return;
                        Json body = Json::object();
                        body.set("worker_id", worker); body.set("lease_token", claim.token); body.set("checkpoint", state);
                        body.set("nodes_processed", step.nodes); body.set("progress_permille", step.progress_permille);
                        HttpReply reply = post("/api/v1/jobs/" + claim.job_id + "/checkpoint", body);
                        if (reply.status == 409 || reply.status == 404 || reply.status == 403) { abandoned = true; break; }  // lease lost
                    }
                }
            } catch (const std::exception& error) {
                std::cerr << "job " << claim.job_id.substr(0, 10) << " failed: " << error.what() << "\n";
                abandoned = true;
            }
            (void)abandoned;
            std::lock_guard<std::mutex> lock(db.mutex());
            Stmt d = db.prepare("DELETE FROM client_claims WHERE job_id = ?1");
            d.bind(1, claim.job_id); d.run();
        }
    };

    std::vector<std::thread> threads;
    for (int i = 0; i < options.workers; ++i) threads.emplace_back(loop, i);
    for (auto& t : threads) t.join();
    std::cerr << "contributed " << completed.load() << " jobs, " << nodes_total.load() << " nodes\n";
    return 0;
}

}  // namespace forge::cli
