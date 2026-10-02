#include <algorithm>
#include <array>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr int side = 5, cells = side * side;
constexpr uint32_t state_count = uint32_t(1) << cells;
using Columns = std::array<uint32_t, cells>;
Columns effects() {
    Columns columns{};
    for (int y = 0; y < side; ++y) for (int x = 0; x < side; ++x) {
        uint32_t mask = 0;
        for (int delta = 0; delta < 5; ++delta) {
            int yy = y + (delta == 0 ? 0 : delta == 1 ? -1 : delta == 2 ? 1 : 0);
            int xx = x + (delta == 3 ? -1 : delta == 4 ? 1 : 0);
            if (yy >= 0 && yy < side && xx >= 0 && xx < side)
                mask |= uint32_t(1) << (yy * side + xx);
        }
        columns[y * side + x] = mask;
    }
    return columns;
}
int weight(uint32_t value) {
#if defined(_MSC_VER)
    int count = 0;
    while (value) { value &= value - 1; ++count; }
    return count;
#else
    return __builtin_popcount(value);
#endif
}
int parity(uint32_t value) { return weight(value) & 1; }
int trailing_zeros(uint32_t value) {
#if defined(_MSC_VER)
    int count = 0;
    while (!(value & 1)) { value >>= 1; ++count; }
    return count;
#else
    return __builtin_ctz(value);
#endif
}
struct Algebra {
    Columns columns;
    std::array<uint64_t, cells> rows{};
    std::array<int, cells> pivots{};
    std::vector<uint32_t> kernel;
    int rank = 0;
    explicit Algebra(Columns c) : columns(c) {
        for (int r = 0; r < cells; ++r) {
            uint32_t coefficients = 0;
            for (int col = 0; col < cells; ++col)
                if (columns[col] & (uint32_t(1) << r)) coefficients |= uint32_t(1) << col;
            rows[r] = coefficients | (uint64_t(1) << (cells + r));
        }
        for (int col = 0; col < cells; ++col) {
            int selected = rank;
            while (selected < cells && !(rows[selected] & (uint64_t(1) << col))) ++selected;
            if (selected == cells) continue;
            std::swap(rows[rank], rows[selected]);
            for (int r = 0; r < cells; ++r)
                if (r != rank && (rows[r] & (uint64_t(1) << col))) rows[r] ^= rows[rank];
            pivots[rank++] = col;
        }
        for (int free_col = 0; free_col < cells; ++free_col) {
            bool pivot = false;
            for (int r = 0; r < rank; ++r) pivot |= pivots[r] == free_col;
            if (pivot) continue;
            uint32_t vector = uint32_t(1) << free_col;
            for (int r = 0; r < rank; ++r)
                if (rows[r] & (uint64_t(1) << free_col)) vector |= uint32_t(1) << pivots[r];
            kernel.push_back(vector);
        }
    }
    uint32_t image(uint32_t presses) const {
        uint32_t board = 0;
        while (presses) {
            int bit = trailing_zeros(presses);
            presses &= presses - 1;
            board ^= columns[bit];
        }
        return board;
    }
    bool solve(uint32_t board, uint32_t& best_press, int& best_length) const {
        for (int r = rank; r < cells; ++r)
            if (parity(uint32_t(rows[r] >> cells) & board)) return false;
        uint32_t particular = 0;
        for (int r = 0; r < rank; ++r)
            if (parity(uint32_t(rows[r] >> cells) & board))
                particular |= uint32_t(1) << pivots[r];
        best_press = particular;
        best_length = weight(particular);
        uint32_t candidate = particular;
        uint32_t previous_gray = 0;
        for (uint32_t i = 1; i < (uint32_t(1) << kernel.size()); ++i) {
            uint32_t gray = i ^ (i >> 1);
            candidate ^= kernel[trailing_zeros(gray ^ previous_gray)];
            previous_gray = gray;
            int length = weight(candidate);
            if (length < best_length || (length == best_length && candidate < best_press)) {
                best_press = candidate;
                best_length = length;
            }
        }
        return image(best_press) == board;
    }
};
uint32_t parse_board(const std::string& input) {
    if (input.size() != cells) throw std::invalid_argument("board must contain 25 bits");
    uint32_t board = 0;
    for (int i = 0; i < cells; ++i) {
        if (input[i] != '0' && input[i] != '1') throw std::invalid_argument("board must contain only 0 and 1");
        if (input[i] == '1') board |= uint32_t(1) << i;
    }
    return board;
}
std::string format_board(uint32_t board) {
    std::string text;
    for (int i = 0; i < cells; ++i) text += (board & (uint32_t(1) << i)) ? '1' : '0';
    return text;
}
}

int main(int argc, char** argv) {
    if (argc < 2) { std::cerr << "usage: lights_out analyze|verify|solve BOARD\n"; return 2; }
    try {
        std::string command = argv[1];
        Algebra algebra(effects());
        if (command == "solve" && argc == 3) {
            uint32_t board = parse_board(argv[2]), presses = 0;
            int length = 0;
            if (!algebra.solve(board, presses, length)) {
                std::cout << "{\"solvable\":false}\n"; return 0;
            }
            std::cout << "{\"solvable\":true,\"minimum_moves\":" << length
                      << ",\"presses\":\"" << format_board(presses) << "\"}\n";
            return 0;
        }
        if (command == "analyze" || command == "verify") {
            // Exhaustive Gray-code traversal covers every press pattern exactly once.
            std::vector<uint8_t> minimum(state_count, 255);
            uint32_t board = 0;
            for (uint32_t i = 0; i < state_count; ++i) {
                if (i) board ^= algebra.columns[trailing_zeros(i)];
                uint32_t presses = i ^ (i >> 1);
                uint8_t length = uint8_t(weight(presses));
                if (length < minimum[board]) minimum[board] = length;
            }
            std::vector<uint64_t> distribution(cells + 1);
            uint64_t solvable = 0;
            int maximum = 0;
            // Independent RREF solve checks existence and the minimum for every board.
            for (uint32_t state = 0; state < state_count; ++state) {
                uint32_t presses = 0;
                int length = 0;
                bool linear_result = algebra.solve(state, presses, length);
                bool enumerated_result = minimum[state] != 255;
                if (linear_result != enumerated_result ||
                    (linear_result && (length != minimum[state] || algebra.image(presses) != state))) {
                    std::cerr << "GF(2) cross-check failed at board " << state << '\n';
                    return 1;
                }
                if (linear_result) {
                    ++solvable;
                    ++distribution[length];
                    if (length > maximum) maximum = length;
                }
            }
            distribution.resize(maximum + 1);
            std::cout << "{\"total_states\":" << state_count
                      << ",\"solvable_states\":" << solvable
                      << ",\"unsolvable_states\":" << state_count - solvable
                      << ",\"rank\":" << algebra.rank
                      << ",\"nullity\":" << algebra.kernel.size()
                      << ",\"maximum_minimum_moves\":" << maximum
                      << ",\"minimum_move_distribution\":[";
            for (size_t i = 0; i < distribution.size(); ++i) {
                if (i) std::cout << ',';
                std::cout << distribution[i];
            }
            std::cout << "],\"every_board_cross_checked\":true}\n";
            return 0;
        }
        std::cerr << "usage: lights_out analyze|verify|solve BOARD\n";
        return 2;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 2;
    }
}
