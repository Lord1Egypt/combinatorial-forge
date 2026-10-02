// 8-Puzzle: breadth-first distances from the goal over all 181,440 reachable states.
#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge::puzzle8 {

using Board = std::array<uint8_t, 9>;
constexpr Board goal{{1, 2, 3, 4, 5, 6, 7, 8, 0}};

inline int rank_board(const Board& b) {
    static const int fact[9] = {1, 1, 2, 6, 24, 120, 720, 5040, 40320};
    int rank = 0;
    for (int i = 0; i < 9; ++i) {
        int smaller = 0;
        for (int j = i + 1; j < 9; ++j) smaller += b[j] < b[i];
        rank += smaller * fact[8 - i];
    }
    return rank;
}

inline Board unrank_board(int rank) {
    static const int fact[9] = {1, 1, 2, 6, 24, 120, 720, 5040, 40320};
    Board b{};
    std::array<uint8_t, 9> pool{{0, 1, 2, 3, 4, 5, 6, 7, 8}};
    int size = 9;
    for (int i = 0; i < 9; ++i) {
        int selected = rank / fact[8 - i];
        rank %= fact[8 - i];
        b[i] = pool[selected];
        for (int j = selected; j + 1 < size; ++j) pool[j] = pool[j + 1];
        --size;
    }
    return b;
}

// Moves the blank; returns false if the move leaves the board.
inline bool apply(Board& b, char move) {
    int blank = 0;
    while (b[blank]) ++blank;
    int other = blank;
    if (move == 'U' && blank >= 3) other -= 3;
    else if (move == 'D' && blank < 6) other += 3;
    else if (move == 'L' && blank % 3) --other;
    else if (move == 'R' && blank % 3 != 2) ++other;
    else return false;
    std::swap(b[blank], b[other]);
    return true;
}

inline Board parse(const std::string& text) {
    if (text.size() != 9) throw std::invalid_argument("board must contain nine digits");
    Board b{};
    std::array<bool, 9> used{};
    for (int i = 0; i < 9; ++i) {
        if (text[i] < '0' || text[i] > '8' || used[text[i] - '0'])
            throw std::invalid_argument("board must be a permutation of 0..8");
        b[i] = uint8_t(text[i] - '0');
        used[b[i]] = true;
    }
    return b;
}

inline std::string format(const Board& b) {
    std::string s;
    for (uint8_t v : b) s += char('0' + v);
    return s;
}

struct Graph {
    std::vector<uint8_t> distance = std::vector<uint8_t>(362880, 255);
    std::vector<int32_t> parent = std::vector<int32_t>(362880, -1);
    std::vector<char> next_move = std::vector<char>(362880, 0);
    std::vector<int> order;
    std::vector<uint64_t> histogram;
    int diameter = 0;

    Graph() {
        const int goal_rank = rank_board(goal);
        distance[goal_rank] = 0;
        order.push_back(goal_rank);
        for (size_t head = 0; head < order.size(); ++head) {
            int current = order[head];
            Board board = unrank_board(current);
            for (char direction : {'U', 'D', 'L', 'R'}) {
                Board next = board;
                if (!apply(next, direction)) continue;
                int key = rank_board(next);
                if (distance[key] != 255) continue;
                distance[key] = uint8_t(distance[current] + 1);
                parent[key] = current;
                next_move[key] = direction == 'U' ? 'D' : direction == 'D' ? 'U' : direction == 'L' ? 'R' : 'L';
                order.push_back(key);
            }
        }
        for (int key : order) {
            size_t d = distance[key];
            if (d >= histogram.size()) histogram.resize(d + 1, 0);
            ++histogram[d];
            if (int(d) > diameter) diameter = int(d);
        }
    }
    bool solvable(const Board& b) const { return distance[rank_board(b)] != 255; }
    std::string path(const Board& b) const {
        int key = rank_board(b);
        if (distance[key] == 255) throw std::invalid_argument("unreachable board");
        std::string moves;
        const int goal_rank = rank_board(goal);
        while (key != goal_rank) { moves += next_move[key]; key = parent[key]; }
        return moves;
    }
};

}  // namespace forge::puzzle8
