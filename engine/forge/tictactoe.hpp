// Tic-Tac-Toe exact analysis: reachability, minimax, game counts. Boards are 9 chars of x/o/-.
#pragma once
#include <array>
#include <cstdint>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge::tictactoe {

inline int winner_of(const std::string& b) {  // 1 = x, 2 = o, 0 = none
    static const int lines[8][3] = {{0,1,2},{3,4,5},{6,7,8},{0,3,6},{1,4,7},{2,5,8},{0,4,8},{2,4,6}};
    for (const auto& l : lines)
        if (b[l[0]] != '-' && b[l[0]] == b[l[1]] && b[l[1]] == b[l[2]]) return b[l[0]] == 'x' ? 1 : 2;
    return 0;
}

inline void validate_board(const std::string& b) {
    if (b.size() != 9) throw std::invalid_argument("board must have 9 characters");
    for (char c : b) if (c != 'x' && c != 'o' && c != '-') throw std::invalid_argument("board characters must be x, o or -");
}

struct Analysis {
    std::vector<int8_t> reachable = std::vector<int8_t>(19683, 0);
    std::vector<int8_t> value = std::vector<int8_t>(19683, 0);  // from x's view: +1, 0, -1
    uint64_t games = 0, x_wins = 0, o_wins = 0, draws = 0, terminal = 0, reachable_count = 0;
    int max_depth = 0;

    static int code(const std::string& b) {
        int v = 0, f = 1;
        for (char c : b) { v += (c == '-' ? 0 : c == 'x' ? 1 : 2) * f; f *= 3; }
        return v;
    }
    Analysis() { std::string board(9, '-'); walk(board, 0); }

    bool is_reachable(const std::string& b) const { return reachable[code(b)] != 0; }
    int minimax(const std::string& b) const { return value[code(b)]; }

private:
    int walk(std::string& b, int ply) {
        int c = code(b);
        bool first = !reachable[c];
        if (first) { reachable[c] = 1; ++reachable_count; if (ply > max_depth) max_depth = ply; }
        int w = winner_of(b);
        bool full = ply == 9;
        int result;
        if (w || full) {
            result = w == 1 ? 1 : w == 2 ? -1 : 0;
            if (first) ++terminal;
            ++games;
            (w == 1 ? x_wins : w == 2 ? o_wins : draws) += 1;
        } else {
            char mark = ply % 2 == 0 ? 'x' : 'o';
            result = mark == 'x' ? -2 : 2;
            for (int i = 0; i < 9; ++i) {
                if (b[i] != '-') continue;
                b[i] = mark;
                int child = walk(b, ply + 1);
                b[i] = '-';
                result = mark == 'x' ? (child > result ? child : result) : (child < result ? child : result);
            }
        }
        value[c] = int8_t(result);
        return result;
    }
};

inline std::string transform(const std::string& b, int symmetry) {
    std::string out(9, '-');
    for (int i = 0; i < 9; ++i) {
        int x = i % 3, y = i / 3;
        if (symmetry & 4) x = 2 - x;
        for (int k = 0; k < (symmetry & 3); ++k) { int nx = 2 - y; y = x; x = nx; }
        out[y * 3 + x] = b[i];
    }
    return out;
}

}  // namespace forge::tictactoe
