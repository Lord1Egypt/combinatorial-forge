// `forge serve`: read-only local explorer bound to loopback. No SQL is accepted from clients;
// every query is fixed and bound, and all page data is rendered with textContent.
#pragma once
#include <cstring>
#include <iostream>
#include <string>

#include "store.hpp"

#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
using socket_t = SOCKET;
#define FORGE_CLOSE_SOCKET closesocket
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
using socket_t = int;
#define FORGE_CLOSE_SOCKET close
constexpr int INVALID_SOCKET = -1;
#endif

namespace forge::cli {

inline std::string page_html(const std::string& nonce) {
    std::string html = R"HTML(<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forge local explorer</title><style>
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1c1a;--mut:#6b675f;--line:#dcd8cf;--acc:#9a4f12;--card:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#161512;--fg:#ece8df;--mut:#9b958a;--line:#34312b;--acc:#e29a55;--card:#1d1b17}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:960px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
p.s{color:var(--mut);margin:0}table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line)}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}th{color:var(--mut);font-weight:500}
code{font:13px ui-monospace,monospace}a,button{color:var(--acc);cursor:pointer;background:none;border:0;font:inherit;padding:0;text-decoration:underline}
.board{display:grid;grid-template-columns:repeat(8,1fr);width:min(100%,360px);border:1px solid var(--line)}
.board div{aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:26px}.l{background:#e8dcc4;color:#222}.d{background:#b08a5b;color:#222}
input{font:inherit;padding:6px 8px;border:1px solid var(--line);background:var(--card);color:var(--fg);width:min(100%,420px)}
</style></head><body><main><h1>Combinatorial Forge <span style="color:var(--mut);font-weight:400">local explorer</span></h1>
<p class="s">Read-only view of this database. Computed locally; verification status is shown per job.</p>
<h2>Jobs by status</h2><div id="counts"></div><h2>Runs</h2><div id="runs"></div>
<h2>Chess layers <span style="text-transform:none;letter-spacing:0">(unique positions &ne; move sequences)</span></h2><div id="layers"></div>
<h2>Chess position</h2><p><input id="pid" placeholder="position id (32 hex) or leave empty for the start position" aria-label="position id"> <button id="go">Open</button></p><div id="pos"></div>
</main><script nonce="NONCE">
const $=id=>document.getElementById(id);
function el(t,x,c){const e=document.createElement(t);if(x!==undefined)e.textContent=x;if(c)e.className=c;return e}
function table(h,rows){const t=el('table'),r=el('tr');h.forEach(x=>r.append(el('th',x)));t.append(r);
 rows.forEach(v=>{const tr=el('tr');v.forEach(c=>{const td=el('td');if(c instanceof Node)td.append(c);else td.textContent=c===null?'':String(c);tr.append(td)});t.append(tr)});return t}
async function j(u){const r=await fetch(u);if(!r.ok)throw new Error(u+' '+r.status);return r.json()}
const glyph={p:'♟',n:'♞',b:'♝',r:'♜',q:'♛',k:'♚',P:'♙',N:'♘',B:'♗',R:'♖',Q:'♕',K:'♔'};
function board(epd){const g=el('div',undefined,'board');const rows=epd.split(' ')[0].split('/');
 rows.forEach((row,ri)=>{let f=0;for(const ch of row){if(ch>='1'&&ch<='8'){for(let k=0;k<+ch;k++){g.append(el('div','',(ri+f++)%2?'d':'l'))}}else{g.append(el('div',glyph[ch]||'?',(ri+f++)%2?'d':'l'))}}});return g}
async function open(id){const d=await j('/api/chess/position/'+id),box=$('pos');box.replaceChildren();
 box.append(board(d.position.epd),el('p','id '+d.position.position_id),el('p','EPD '+d.position.epd),el('p','first reached at ply '+d.position.first_ply+', legal moves '+d.position.legal_moves));
 const kids=d.children.map(c=>{const a=el('button',c.uci);a.onclick=()=>open(c.child_id);return [a,c.child_id]});
 box.append(el('h2','Children ('+kids.length+(kids.length?'':', not stored for this ply')+')'));if(kids.length)box.append(table(['move','id'],kids))}
async function init(){const s=await j('/api/status');
 $('counts').append(table(['status','jobs'],Object.entries(s.job_counts)));
 $('runs').append(table(['run','problem','status','jobs','verified','result'],s.runs.map(r=>[r.run_id.slice(0,10),r.problem,r.status,r.total_jobs,r.verified_jobs,r.result||''])));
 const l=await j('/api/chess/layers');$('layers').append(table(['run','ply','unique positions','move sequences','status'],l.layers.map(x=>[x.run_id.slice(0,10),x.ply,x.unique_positions,x.move_sequences,x.status])));
 $('go').onclick=()=>{const v=$('pid').value.trim();if(v&&!/^[0-9a-f]{32}$/.test(v)){alert('position id must be 32 hex characters');return}open(v||l.start_id)};
 if(l.start_id)open(l.start_id)}
init().catch(e=>{document.body.append(el('pre',String(e)))});
</script></body></html>)HTML";
    size_t at = html.find("NONCE");
    return html.replace(at, 5, nonce);
}

inline Json row_object(Stmt& s) {
    Json row = Json::object();
    for (int c = 0; c < s.columns(); ++c) {
        if (s.column_type(c) == SQLITE_INTEGER) row.set(s.column_name(c), s.integer(c));
        else if (s.column_type(c) == SQLITE_NULL) row.set(s.column_name(c), Json());
        else row.set(s.column_name(c), s.text(c));
    }
    return row;
}

inline bool is_hex32(const std::string& s) {
    if (s.size() != 32) return false;
    for (char c : s) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

inline std::string query_param(const std::string& query, const std::string& key) {
    size_t pos = 0;
    while (pos < query.size()) {
        size_t end = query.find('&', pos);
        std::string pair = query.substr(pos, end == std::string::npos ? std::string::npos : end - pos);
        size_t eq = pair.find('=');
        if (eq != std::string::npos && pair.substr(0, eq) == key) return pair.substr(eq + 1);
        if (end == std::string::npos) break;
        pos = end + 1;
    }
    return "";
}

inline int64_t clamp_number(const std::string& text, int64_t fallback, int64_t lo, int64_t hi) {
    if (text.empty() || text.size() > 9) return fallback;
    for (char c : text) if (c < '0' || c > '9') return fallback;
    return std::min(hi, std::max(lo, int64_t(std::stoll(text))));
}

// Returns {status, content-type, body}. Never throws on bad input; client mistakes are 400/404.
struct Reply { int status; std::string type; std::string body; };

inline Reply route(Db& db, const std::string& method, const std::string& target, const std::string& nonce) {
    auto json = [](int status, const Json& body) { return Reply{status, "application/json", body.dump()}; };
    auto error = [&](int status, const char* message) { Json e = Json::object(); e.set("error", message); return json(status, e); };
    if (method != "GET" && method != "HEAD") return error(405, "read-only server");
    const size_t q = target.find('?');
    const std::string path = target.substr(0, q), query = q == std::string::npos ? "" : target.substr(q + 1);
    try {
        if (path == "/") return {200, "text/html; charset=utf-8", page_html(nonce)};
        if (path == "/api/status") {
            Json out = Json::object(), counts = Json::object(), runs = Json::array();
            Stmt c = db.prepare("SELECT status, COUNT(*) FROM jobs GROUP BY status ORDER BY status");
            while (c.step()) counts.set(c.text(0), c.integer(1));
            Stmt r = db.prepare("SELECT r.run_id, r.problem, r.status, r.solver_version, r.total_jobs, COALESCE(a.verified_jobs, 0) AS verified_jobs, a.result AS result "
                                "FROM runs r LEFT JOIN aggregate_results a ON a.run_id = r.run_id ORDER BY r.created_at");
            while (r.step()) runs.push(row_object(r));
            out.set("schema_version", schema_version(db)); out.set("job_counts", counts); out.set("runs", runs);
            return json(200, out);
        }
        if (path == "/api/jobs") {
            const std::string status = query_param(query, "status"), run = query_param(query, "run");
            static const std::set<std::string> allowed = {"", "pending", "leased", "running", "submitted", "verified", "disputed", "failed", "cancelled"};
            if (!allowed.count(status)) return error(400, "invalid status");
            for (char ch : run) if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return error(400, "invalid run");
            Stmt s = db.prepare("SELECT job_id, run_id, problem, status, attempts, nodes_processed, runtime_ms, verified_result_hash FROM jobs "
                                "WHERE (?1 = '' OR status = ?1) AND (?2 = '' OR run_id = ?2) ORDER BY job_id LIMIT ?3 OFFSET ?4");
            s.bind(1, status).bind(2, run).bind(3, clamp_number(query_param(query, "limit"), 50, 1, 200)).bind(4, clamp_number(query_param(query, "offset"), 0, 0, 1000000000));
            Json rows = Json::array();
            while (s.step()) rows.push(row_object(s));
            Json out = Json::object(); out.set("jobs", rows);
            return json(200, out);
        }
        if (path == "/api/chess/layers") {
            Json layers = Json::array(), out = Json::object();
            Stmt s = db.prepare("SELECT run_id, ply, unique_positions, move_sequences, status FROM chess_layers ORDER BY run_id, ply");
            while (s.step()) layers.push(row_object(s));
            out.set("layers", layers);
            Stmt start = db.prepare("SELECT position_id FROM chess_positions WHERE first_ply = 0 LIMIT 1");
            out.set("start_id", start.step() ? Json(start.text(0)) : Json());
            return json(200, out);
        }
        const std::string prefix = "/api/chess/position/";
        if (path.compare(0, prefix.size(), prefix) == 0) {
            const std::string id = path.substr(prefix.size());
            if (!is_hex32(id)) return error(400, "position id must be 32 lowercase hex characters");
            Stmt p = db.prepare("SELECT position_id, epd, first_ply, legal_moves FROM chess_positions WHERE position_id = ?1");
            p.bind(1, id);
            if (!p.step()) return error(404, "position not stored");
            Json out = Json::object(), kids = Json::array(), parents = Json::array();
            out.set("position", row_object(p));
            Stmt c = db.prepare("SELECT child_id, uci FROM chess_edges WHERE parent_id = ?1 ORDER BY uci");
            c.bind(1, id);
            while (c.step()) kids.push(row_object(c));
            Stmt pr = db.prepare("SELECT parent_id, uci FROM chess_edges WHERE child_id = ?1 ORDER BY parent_id LIMIT 100");
            pr.bind(1, id);
            while (pr.step()) parents.push(row_object(pr));
            out.set("children", kids); out.set("parents", parents);
            return json(200, out);
        }
        return error(404, "not found");
    } catch (const std::exception& e) {
        std::cerr << "request error: " << e.what() << "\n";
        return error(500, "internal error");
    }
}

inline int serve(const std::string& db_path, int port) {
    Db db(db_path, true);
#if defined(_WIN32)
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) { std::cerr << "winsock init failed\n"; return 1; }
#endif
    const std::string nonce = random_hex(12);
    socket_t listener = socket(AF_INET, SOCK_STREAM, 0);
    if (listener == INVALID_SOCKET) { std::cerr << "socket() failed\n"; return 1; }
    int yes = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&yes), sizeof yes);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(uint16_t(port));
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  // loopback only: never exposed to the network
    if (bind(listener, reinterpret_cast<sockaddr*>(&addr), sizeof addr) != 0 || listen(listener, 16) != 0) {
        std::cerr << "cannot listen on 127.0.0.1:" << port << "\n";
        return 1;
    }
    std::cerr << "forge explorer: http://127.0.0.1:" << port << "/  (read-only, Ctrl-C to stop)\n";
    while (!stop_requested) {
        fd_set set;
        FD_ZERO(&set);
        FD_SET(listener, &set);
        timeval timeout{0, 300000};
        int ready = select(int(listener) + 1, &set, nullptr, nullptr, &timeout);
        if (ready <= 0) continue;
        socket_t client = accept(listener, nullptr, nullptr);
        if (client == INVALID_SOCKET) continue;
        timeval io_timeout{5, 0};
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&io_timeout), sizeof io_timeout);
        std::string request;
        char buffer[2048];
        while (request.size() < 8192 && request.find("\r\n\r\n") == std::string::npos) {
            int n = int(recv(client, buffer, sizeof buffer, 0));
            if (n <= 0) break;
            request.append(buffer, size_t(n));
        }
        Reply reply{400, "application/json", "{\"error\":\"bad request\"}"};
        size_t line_end = request.find("\r\n");
        if (line_end != std::string::npos && request.find("\r\n\r\n") != std::string::npos) {
            std::string line = request.substr(0, line_end);
            size_t a = line.find(' '), b = line.rfind(' ');
            if (a != std::string::npos && b > a) reply = route(db, line.substr(0, a), line.substr(a + 1, b - a - 1), nonce);
        }
        const char* reason = reply.status == 200 ? "OK" : reply.status == 404 ? "Not Found" : reply.status == 405 ? "Method Not Allowed" : reply.status == 400 ? "Bad Request" : "Internal Server Error";
        std::string head = "HTTP/1.1 " + std::to_string(reply.status) + " " + reason + "\r\nContent-Type: " + reply.type +
                           "\r\nContent-Length: " + std::to_string(reply.body.size()) +
                           "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n"
                           "Content-Security-Policy: default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; connect-src 'self'\r\n"
                           "Connection: close\r\n\r\n";
        std::string data = head + reply.body;
        size_t sent = 0;
        while (sent < data.size()) {
            int n = int(send(client, data.data() + sent, int(data.size() - sent), 0));
            if (n <= 0) break;
            sent += size_t(n);
        }
        FORGE_CLOSE_SOCKET(client);
    }
    FORGE_CLOSE_SOCKET(listener);
    return 0;
}

}  // namespace forge::cli
