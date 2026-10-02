#include <array>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr int states = 19683; // 3^9 storage capacity, not a result count.
constexpr std::array<std::array<int, 3>, 8> lines{{
    {{0,1,2}},{{3,4,5}},{{6,7,8}},{{0,3,6}},
    {{1,4,7}},{{2,5,8}},{{0,4,8}},{{2,4,6}}
}};
using Board = std::array<uint8_t, 9>;

int code(const Board& b) {
    int value = 0, factor = 1;
    for (uint8_t square : b) { value += square * factor; factor *= 3; }
    return value;
}
int winner(const Board& b) {
    for (const auto& line : lines)
        if (b[line[0]] && b[line[0]] == b[line[1]] && b[line[1]] == b[line[2]])
            return b[line[0]];
    return 0;
}
int canonical(const Board& b) {
    int best = states;
    for (int mirror = 0; mirror < 2; ++mirror)
        for (int rotation = 0; rotation < 4; ++rotation) {
            Board transformed{};
            for (int i = 0; i < 9; ++i) {
                int x = i % 3, y = i / 3;
                if (mirror) x = 2 - x;
                for (int k = 0; k < rotation; ++k) {
                    int next_x = 2 - y;
                    y = x; x = next_x;
                }
                transformed[y * 3 + x] = b[i];
            }
            int value = code(transformed);
            if (value < best) best = value;
        }
    return best;
}
struct Totals {
    uint64_t positions = 0, terminal_positions = 0, games = 0;
    uint64_t x_wins = 0, o_wins = 0, draws = 0;
    uint64_t canonical_positions = 0, canonical_terminal_positions = 0;
    int maximum_depth = 0;
};
std::array<uint8_t, states> seen{}, seen_canonical{}, seen_terminal_canonical{};
Totals totals;

void walk(Board& b, int depth) {
    int key = code(b), win = winner(b);
    bool terminal = win || depth == 9;
    if (!seen[key]) {
        seen[key] = 1;
        ++totals.positions;
        int representative = canonical(b);
        if (!seen_canonical[representative]) {
            seen_canonical[representative] = 1;
            ++totals.canonical_positions;
        }
        if (terminal) {
            ++totals.terminal_positions;
            if (!seen_terminal_canonical[representative]) {
                seen_terminal_canonical[representative] = 1;
                ++totals.canonical_terminal_positions;
            }
        }
    }
    if (terminal) {
        ++totals.games;
        if (win == 1) ++totals.x_wins;
        else if (win == 2) ++totals.o_wins;
        else ++totals.draws;
        if (depth > totals.maximum_depth) totals.maximum_depth = depth;
        return;
    }
    for (int i = 0; i < 9; ++i) if (!b[i]) {
        b[i] = depth % 2 ? 2 : 1;
        walk(b, depth + 1);
        b[i] = 0;
    }
}

// Independent state-graph enumeration checks the tree's distinct position set.
bool verify_state_graph() {
    std::array<uint8_t, states> graph_seen{};
    std::vector<Board> queue(1);
    graph_seen[0] = 1;
    for (size_t head = 0; head < queue.size(); ++head) {
        Board b = queue[head];
        int moves = 0;
        for (uint8_t v : b) moves += v != 0;
        if (winner(b) || moves == 9) continue;
        for (int i = 0; i < 9; ++i) if (!b[i]) {
            b[i] = moves % 2 ? 2 : 1;
            int key = code(b);
            if (!graph_seen[key]) { graph_seen[key] = 1; queue.push_back(b); }
            b[i] = 0;
        }
    }
    return queue.size() == totals.positions && graph_seen == seen &&
           totals.games == totals.x_wins + totals.o_wins + totals.draws;
}

std::array<int8_t, states> memo;
int minimax(Board& b, int depth) {
    int key = code(b);
    if (memo[key] != 2) return memo[key];
    int win = winner(b);
    if (win || depth == 9) return memo[key] = win == 1 ? 1 : win == 2 ? -1 : 0;
    bool x_turn = depth % 2 == 0;
    int best = x_turn ? -2 : 2;
    for (int i = 0; i < 9; ++i) if (!b[i]) {
        b[i] = x_turn ? 1 : 2;
        int value = minimax(b, depth + 1);
        b[i] = 0;
        if (x_turn ? value > best : value < best) best = value;
    }
    return memo[key] = static_cast<int8_t>(best);
}
int best_move(Board& b, int depth) {
    bool x_turn = depth % 2 == 0;
    int best = x_turn ? -2 : 2, choice = -1;
    for (int i = 0; i < 9; ++i) if (!b[i]) {
        b[i] = x_turn ? 1 : 2;
        int value = minimax(b, depth + 1);
        b[i] = 0;
        if (choice < 0 || (x_turn ? value > best : value < best)) {
            best = value; choice = i;
        }
    }
    return choice;
}
void print_board(const Board& b) {
    for (int y = 0; y < 3; ++y) {
        for (int x = 0; x < 3; ++x) {
            int i = 3*y+x;
            std::cout << (b[i] == 1 ? 'X' : b[i] == 2 ? 'O' : char('1'+i));
            if (x != 2) std::cout << " | ";
        }
        std::cout << '\n';
        if (y != 2) std::cout << "---------\n";
    }
}
}

int main(int argc, char** argv) {
    if (argc < 2) { std::cerr << "usage: tictactoe analyze|verify|play [X|O]\n"; return 2; }
    std::string command = argv[1];
    Board b{};
    memo.fill(2);
    if (command == "analyze" || command == "verify") {
        walk(b, 0);
        int perfect = minimax(b, 0);
        bool valid = verify_state_graph();
        if (!valid) { std::cerr << "independent state-graph check failed\n"; return 1; }
        std::cout << "{\"reachable_positions\":" << totals.positions
                  << ",\"terminal_positions\":" << totals.terminal_positions
                  << ",\"complete_games\":" << totals.games
                  << ",\"x_wins\":" << totals.x_wins
                  << ",\"o_wins\":" << totals.o_wins
                  << ",\"draws\":" << totals.draws
                  << ",\"maximum_depth\":" << totals.maximum_depth
                  << ",\"canonical_positions\":" << totals.canonical_positions
                  << ",\"canonical_terminal_positions\":" << totals.canonical_terminal_positions
                  << ",\"perfect_play\":\"" << (perfect == 0 ? "draw" : perfect > 0 ? "X" : "O")
                  << "\",\"verified\":true}\n";
        return 0;
    }
    if (command == "play") {
        char human = argc > 2 ? argv[2][0] : 'X';
        if (human != 'X' && human != 'O') return 2;
        for (int depth = 0; depth <= 9; ++depth) {
            print_board(b);
            int win = winner(b);
            if (win || depth == 9) {
                std::cout << (win == 1 ? "X wins\n" : win == 2 ? "O wins\n" : "Draw\n");
                return 0;
            }
            char player = depth % 2 ? 'O' : 'X';
            int move;
            if (player == human) {
                std::cout << "Your move (1-9): " << std::flush;
                if (!(std::cin >> move) || move < 1 || move > 9 || b[move-1]) {
                    std::cerr << "invalid move\n"; return 2;
                }
                --move;
            } else {
                move = best_move(b, depth);
                std::cout << "Computer plays " << move+1 << "\n";
            }
            b[move] = player == 'X' ? 1 : 2;
        }
    }
    std::cerr << "unknown command\n";
    return 2;
}
