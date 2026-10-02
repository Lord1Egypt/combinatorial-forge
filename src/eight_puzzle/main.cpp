#include <algorithm>
#include <array>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using Board = std::array<uint8_t, 9>;
constexpr std::array<int, 9> factorial{{1,1,2,6,24,120,720,5040,40320}};
constexpr int capacity = 362880; // 9!, indexing capacity only.
constexpr Board goal{{1,2,3,4,5,6,7,8,0}};
int rank_board(const Board& b) {
    int rank = 0;
    for (int i = 0; i < 9; ++i) {
        int smaller = 0;
        for (int j = i+1; j < 9; ++j) smaller += b[j] < b[i];
        rank += smaller * factorial[8-i];
    }
    return rank;
}
Board unrank_board(int rank) {
    Board b{};
    std::array<uint8_t, 9> pool{{0,1,2,3,4,5,6,7,8}};
    int size = 9;
    for (int i = 0; i < 9; ++i) {
        int selected = rank / factorial[8-i];
        rank %= factorial[8-i];
        b[i] = pool[selected];
        for (int j = selected; j+1 < size; ++j) pool[j] = pool[j+1];
        --size;
    }
    return b;
}
bool apply(Board& b, char move) {
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
char opposite(char move) {
    return move == 'U' ? 'D' : move == 'D' ? 'U' : move == 'L' ? 'R' : 'L';
}
struct Graph {
    std::vector<uint8_t> distance = std::vector<uint8_t>(capacity, 255);
    std::vector<int32_t> parent = std::vector<int32_t>(capacity, -1);
    std::vector<char> next_move = std::vector<char>(capacity, 0);
    std::vector<int> vertices;
    std::vector<uint64_t> histogram;
    int diameter = 0;
    int goal_rank = rank_board(goal);
    Graph() {
        distance[goal_rank] = 0;
        vertices.push_back(goal_rank);
        for (size_t head = 0; head < vertices.size(); ++head) {
            int current = vertices[head];
            Board board = unrank_board(current);
            for (char direction : {'U','D','L','R'}) {
                Board next = board;
                if (!apply(next, direction)) continue;
                int key = rank_board(next);
                if (distance[key] != 255) continue;
                distance[key] = uint8_t(distance[current] + 1);
                parent[key] = current;
                next_move[key] = opposite(direction);
                vertices.push_back(key);
            }
        }
        for (int key : vertices) {
            int d = distance[key];
            if (d >= int(histogram.size())) histogram.resize(d+1, 0);
            ++histogram[d];
            if (d > diameter) diameter = d;
        }
    }
    std::string path(int key) const {
        if (distance[key] == 255) throw std::invalid_argument("unreachable board");
        std::string moves;
        while (key != goal_rank) {
            moves += next_move[key];
            key = parent[key];
        }
        return moves;
    }
    bool verify() const {
        uint64_t sum = 0;
        for (uint64_t count : histogram) sum += count;
        if (sum != vertices.size() || histogram.empty() || histogram[0] != 1) return false;
        // Replay every optimal path, including the zero-length goal path.
        for (int key : vertices) {
            Board board = unrank_board(key);
            int cursor = key;
            for (char move : path(key)) {
                if (!apply(board, move)) return false;
                int next = rank_board(board);
                if (next != parent[cursor] || distance[next] + 1 != distance[cursor]) return false;
                cursor = next;
            }
            if (board != goal || cursor != goal_rank) return false;
        }
        return true;
    }
};
Board parse(const std::string& value) {
    if (value.size() != 9) throw std::invalid_argument("board must contain nine digits");
    Board board{};
    std::array<bool, 9> used{};
    for (int i = 0; i < 9; ++i) {
        if (value[i] < '0' || value[i] > '8' || used[value[i]-'0'])
            throw std::invalid_argument("board must be a permutation of 0..8");
        board[i] = uint8_t(value[i]-'0');
        used[board[i]] = true;
    }
    return board;
}
}

int main(int argc, char** argv) {
    if (argc < 2) { std::cerr << "usage: eight_puzzle analyze|verify|solve BOARD\n"; return 2; }
    try {
        std::string command = argv[1];
        Graph graph;
        if (command == "analyze" || command == "verify") {
            bool ok = graph.verify();
            if (!ok) { std::cerr << "path replay failed\n"; return 1; }
            std::cout << "{\"reachable_states\":" << graph.vertices.size()
                      << ",\"diameter\":" << graph.diameter << ",\"histogram\":[";
            for (size_t i = 0; i < graph.histogram.size(); ++i) {
                if (i) std::cout << ',';
                std::cout << graph.histogram[i];
            }
            std::cout << "],\"all_paths_replayed\":true}\n";
            return 0;
        }
        if (command == "solve" && argc == 3) {
            Board board = parse(argv[2]);
            int key = rank_board(board);
            if (graph.distance[key] == 255) {
                std::cout << "{\"solvable\":false}\n"; return 0;
            }
            std::string moves = graph.path(key);
            Board replay = board;
            for (char move : moves) if (!apply(replay, move)) throw std::logic_error("bad path");
            if (replay != goal) throw std::logic_error("path does not solve board");
            std::cout << "{\"solvable\":true,\"distance\":" << moves.size()
                      << ",\"moves\":\"" << moves << "\"}\n";
            return 0;
        }
        std::cerr << "usage: eight_puzzle analyze|verify|solve BOARD\n";
        return 2;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 2;
    }
}
