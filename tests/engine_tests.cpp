// Unit and equivalence tests for the shared engine. Usage: engine_tests <repo-root>
#include <chrono>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <sstream>

#include "forge/api.hpp"
#include "forge/chess.hpp"
#include "forge/jobs.hpp"
#include "forge/json.hpp"
#include "forge/sha256.hpp"

using namespace forge;

static int failures = 0, checks = 0;
#define CHECK(cond) do { ++checks; if (!(cond)) { ++failures; std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << " " #cond "\n"; } } while (0)
#define CHECK_EQ(a, b) do { ++checks; auto va = (a); auto vb = (b); if (!(va == vb)) { ++failures; std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << " " #a " == " #b " (" << va << " vs " << vb << ")\n"; } } while (0)

static std::string slurp(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open " + path);
    std::stringstream ss; ss << in.rdbuf(); return ss.str();
}

static void test_sha_json() {
    CHECK_EQ(sha256_hex(""), std::string("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
    CHECK_EQ(sha256_hex("abc"), std::string("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    CHECK_EQ(sha256_hex(std::string(1000, 'a')), std::string("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"));
    CHECK_EQ(Json::parse("{ \"b\" : [1, -2, {\"z\":null}], \"a\":\"x\\ny\" }").dump(), std::string("{\"a\":\"x\\ny\",\"b\":[1,-2,{\"z\":null}]}"));
    for (const char* bad : {"{", "[1,]", "1.5", "01", "\"\\ud800\"", "{\"a\":1} x", "[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]"}) {
        bool threw = false;
        try { Json::parse(bad); } catch (const std::exception&) { threw = true; }
        CHECK(threw);
    }
    CHECK_EQ(Json::parse("9223372036854775807").as_int(), int64_t(9223372036854775807LL));
}

static void test_job_ids(const std::string& root) {
    Json fixtures = Json::parse(slurp(root + "/database/fixtures/job_ids.json"));
    for (const Json& fx : fixtures.at("cases").items()) {
        CHECK_EQ(jobs::job_id(fx.at("definition")), fx.at("job_id").as_string());
        CHECK_EQ(jobs::canonical(fx.at("definition")), fx.at("canonical").as_string());
    }
    // Key order of construction must not matter.
    Json a = jobs::plan_nqueens(8, 2).front();
    Json b = Json::parse(a.dump());
    CHECK_EQ(jobs::job_id(a), jobs::job_id(b));
    Json c = a; c.set("solver_version", "other");
    CHECK(jobs::job_id(a) != jobs::job_id(c));
    bool threw = false;
    try { Json d = a; d.set("extra", 1); jobs::validate(d); } catch (const std::invalid_argument&) { threw = true; }
    CHECK(threw);
}

static void test_perft() {
    struct T { const char* fen; int depth; uint64_t want; };
    const T tests[] = {
        {"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 4, 197281},
        {"r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 3, 97862},
        {"8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 4, 43238},
        {"r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 3, 9467},
        {"rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", 3, 62379},
        {"r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", 3, 89890},
    };
    for (const T& t : tests) CHECK_EQ(chess::perft(chess::parse_fen(t.fen), t.depth).nodes, t.want);
    auto c = chess::perft(chess::start_position(), 4);
    CHECK_EQ(c.captures, uint64_t(1576)); CHECK_EQ(c.en_passant, uint64_t(0));
    auto k = chess::perft(chess::parse_fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"), 3);
    CHECK_EQ(k.castles, uint64_t(3162)); CHECK_EQ(k.en_passant, uint64_t(45)); CHECK_EQ(k.promotions, uint64_t(0));
    CHECK_EQ(chess::perft(chess::start_position(), 0).nodes, uint64_t(1));
}

static void test_chess_identity() {
    // en-passant square only counts when a legal capture exists
    auto after = [](const std::string& moves) {
        chess::Position p = chess::start_position();
        std::istringstream in(moves); std::string m;
        while (in >> m) p = chess::normalize(chess::make(p, chess::parse_uci(p, m)));
        return p;
    };
    CHECK_EQ(chess::epd(after("e2e4")), std::string("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -"));
    CHECK_EQ(chess::epd(after("e2e4 a7a6 e4e5 d7d5")), std::string("rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6"));
    // transposition: different move orders, one identity
    CHECK(chess::position_id(after("e2e4 e7e5 g1f3 b8c6")) == chess::position_id(after("g1f3 b8c6 e2e4 e7e5")));
    CHECK(chess::position_id(after("g1f3")) != chess::position_id(after("b1c3")));
    // castling rights are identity: knight shuffle that loses the right differs from one that does not
    CHECK(chess::position_id(after("g1f3 g8f6 f3g1 f6g8")) == chess::position_id(chess::start_position()));
    CHECK(chess::position_id(after("h2h3 h7h6 h1h2 h8h7 h2h1 h7h8")) != chess::position_id(chess::start_position()));
    // packed round trip
    chess::Position p = after("e2e4 c7c5 g1f3");
    CHECK(chess::unpack(chess::pack(p)) == p);
    CHECK_EQ(chess::position_id(p).hex().size(), size_t(32));
    // FEN round trip and rejection of illegal positions
    CHECK_EQ(chess::fen(chess::parse_fen("4k3/8/8/8/8/8/8/4K3 w - - 12 40")), std::string("4k3/8/8/8/8/8/8/4K3 w - - 0 1"));
    for (const char* bad : {"4k3/8/8/8/8/8/8/8 w - -", "4k3/8/8/8/8/8/8/4K2K w - -", "P3k3/8/8/8/8/8/8/4K3 w - -", "4k3/8/8/8/8/8/4r3/4K3 b - -", "x w - -", "4k3/8/8/8/8/8/8/4K3 x - -"}) {
        bool threw = false;
        try { chess::parse_fen(bad); } catch (const std::exception&) { threw = true; }
        CHECK(threw);
    }
    CHECK_EQ(chess::legal_moves(chess::parse_fen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")).size(), size_t(0));  // fool's mate
}

// Positions and move sequences are different metrics: they must diverge from ply 3.
static void test_position_vs_sequence() {
    std::map<chess::PositionId, chess::Position> layer{{chess::position_id(chess::start_position()), chess::start_position()}};
    const uint64_t perft_expected[] = {1, 20, 400, 8902, 197281};
    const uint64_t unique_expected[] = {1, 20, 400, 5362, 72078};
    for (int depth = 0; depth <= 4; ++depth) {
        CHECK_EQ(uint64_t(layer.size()), unique_expected[depth]);
        CHECK_EQ(chess::perft(chess::start_position(), depth).nodes, perft_expected[depth]);
        std::map<chess::PositionId, chess::Position> next;
        for (const auto& entry : layer)
            for (const auto& child : chess::successors(entry.second)) next.emplace(chess::position_id(child.second), child.second);
        layer.swap(next);
    }
    CHECK(unique_expected[3] < perft_expected[3]);
}

static void test_nqueens() {
    const uint64_t known[] = {0, 1, 0, 0, 2, 10, 4, 40, 92, 352, 724};
    for (int n = 1; n <= 10; ++n) {
        uint64_t sum = 0;
        for (int depth : {0, 1, 2}) {
            if (depth > n) continue;
            uint64_t total = 0;
            for (const Json& def : jobs::plan_nqueens(n, depth)) {
                uint64_t nodes = 0;
                total += uint64_t(jobs::run_to_completion(def, nodes).at("solutions").as_int());
            }
            if (depth == 0) sum = total; else CHECK_EQ(total, sum);
        }
        CHECK_EQ(sum, known[n]);
    }
    // checkpoint/resume: tiny budgets must give the same answer as one shot
    Json def = jobs::plan_nqueens(9, 1)[2];
    uint64_t nodes = 0;
    Json whole = jobs::run_to_completion(def, nodes);
    Json state; int steps = 0; jobs::Step last;
    do { last = jobs::step(def, Json::parse(state.dump()), 500); state = last.state; ++steps; } while (!last.done);
    CHECK(steps > 1);
    CHECK_EQ(last.result.dump(), whole.dump());
    CHECK_EQ(last.nodes, nodes);
}

static void test_chess_jobs() {
    for (int path_depth : {0, 1, 2}) {
        uint64_t sum = 0;
        for (const Json& def : jobs::plan_chess(path_depth, 4)) {
            uint64_t nodes = 0;
            sum += uint64_t(jobs::run_to_completion(def, nodes).at("nodes").as_int());
        }
        CHECK_EQ(sum, uint64_t(197281));
    }
    Json def = jobs::plan_chess(1, 4)[3];
    uint64_t nodes = 0;
    Json whole = jobs::run_to_completion(def, nodes);
    Json state; jobs::Step last; int steps = 0;
    do { last = jobs::step(def, Json::parse(state.dump()), 1000); state = last.state; ++steps; } while (!last.done);
    CHECK(steps > 1);
    CHECK_EQ(last.result.dump(), whole.dump());
}

static void test_baseline_equivalence(const std::string& root) {
    Json ttt = Json::parse(slurp(root + "/results/tictactoe.json"), true);
    Json got = api::ttt_stats();
    for (const char* key : {"reachable_positions", "terminal_positions", "complete_games", "x_wins", "o_wins", "draws",
                            "maximum_depth", "canonical_positions", "canonical_terminal_positions"})
        CHECK_EQ(got.at(key).as_int(), ttt.at(key).as_int());
    CHECK_EQ(got.at("perfect_play").as_string(), ttt.at("perfect_play").as_string());

    Json puzzle = Json::parse(slurp(root + "/results/eight_puzzle.json"), true);
    Json stats = api::puzzle8_stats();
    CHECK_EQ(stats.at("reachable_states").as_int(), puzzle.at("reachable_states").as_int());
    CHECK_EQ(stats.at("diameter").as_int(), puzzle.at("diameter").as_int());
    CHECK_EQ(stats.at("histogram").dump(), puzzle.at("histogram").dump());
    CHECK_EQ(api::puzzle8_solve("123456708").at("moves").as_string(), std::string("R"));
    CHECK(!api::puzzle8_solve("123456870").at("solvable").as_bool());

    Json lights = Json::parse(slurp(root + "/results/lights_out.json"), true);
    CHECK_EQ(int64_t(api::algebra().rank), lights.at("rank").as_int());
    CHECK_EQ(int64_t(api::algebra().kernel.size()), lights.at("nullity").as_int());
    // Every solvable board has a press set that really clears it; the all-on board is known to need 15.
    uint64_t solvable = 0, seed = 12345;
    for (int i = 0; i < 4000; ++i) {
        uint32_t board = uint32_t(chess::splitmix64(seed)) & ((1u << 25) - 1), presses; int len;
        if (api::algebra().solve(board, presses, len)) { ++solvable; CHECK_EQ(api::algebra().image(presses), board); CHECK(len <= 15); }
    }
    CHECK(solvable > 800 && solvable < 1200);  // ~1/4 of boards are solvable
    CHECK(api::lights_solve("1111111111111111111111111").at("solvable").as_bool());
}

static void test_api() {
    CHECK(Json::parse(api::handle("{\"method\":\"engine.info\"}")).at("ok").as_bool());
    CHECK(!Json::parse(api::handle("{\"method\":\"nope\"}")).at("ok").as_bool());
    CHECK(!Json::parse(api::handle("not json")).at("ok").as_bool());
    CHECK(!Json::parse(api::handle("{\"method\":\"puzzle8.solve\",\"params\":{\"board\":\"123\"}}")).at("ok").as_bool());
    Json pos = Json::parse(api::handle("{\"method\":\"chess.position\",\"params\":{\"epd\":\"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -\"}}"));
    CHECK_EQ(pos.at("result").at("legal_moves").as_int(), int64_t(20));
    Json x = Json::parse(api::handle("{\"method\":\"ttt.position\",\"params\":{\"board\":\"---------\"}}"));
    CHECK_EQ(x.at("result").at("minimax").as_string(), std::string("draw"));
    CHECK_EQ(x.at("result").at("children").items().size(), size_t(9));
}

int main(int argc, char** argv) {
    const std::string root = argc > 1 ? argv[1] : ".";
    try {
        test_sha_json(); test_job_ids(root); test_perft(); test_chess_identity();
        test_position_vs_sequence(); test_nqueens(); test_chess_jobs();
        test_baseline_equivalence(root); test_api();
    } catch (const std::exception& error) {
        std::cerr << "unexpected exception: " << error.what() << "\n";
        return 1;
    }
    std::cout << checks << " checks, " << failures << " failures\n";
    return failures ? 1 : 0;
}
