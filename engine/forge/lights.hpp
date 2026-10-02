// Lights Out 5x5 over GF(2): rank, kernel and minimum-press solutions.
#pragma once
#include <array>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge::lights {

constexpr int side = 5, cells = 25;

inline int weight(uint32_t v) { int c = 0; while (v) { v &= v - 1; ++c; } return c; }
inline int trailing_zeros(uint32_t v) { int c = 0; while (!(v & 1)) { v >>= 1; ++c; } return c; }

struct Algebra {
    std::array<uint32_t, cells> columns{};
    std::array<uint64_t, cells> rows{};
    std::array<int, cells> pivots{};
    std::vector<uint32_t> kernel;
    int rank = 0;

    Algebra() {
        for (int y = 0; y < side; ++y) for (int x = 0; x < side; ++x) {
            uint32_t mask = 0;
            const int dx[5] = {0, 0, 0, -1, 1}, dy[5] = {0, -1, 1, 0, 0};
            for (int k = 0; k < 5; ++k) {
                int xx = x + dx[k], yy = y + dy[k];
                if (xx >= 0 && xx < side && yy >= 0 && yy < side) mask |= uint32_t(1) << (yy * side + xx);
            }
            columns[y * side + x] = mask;
        }
        for (int r = 0; r < cells; ++r) {
            uint32_t coefficients = 0;
            for (int c = 0; c < cells; ++c) if (columns[c] & (uint32_t(1) << r)) coefficients |= uint32_t(1) << c;
            rows[r] = coefficients | (uint64_t(1) << (cells + r));
        }
        for (int c = 0; c < cells; ++c) {
            int selected = rank;
            while (selected < cells && !(rows[selected] & (uint64_t(1) << c))) ++selected;
            if (selected == cells) continue;
            std::swap(rows[rank], rows[selected]);
            for (int r = 0; r < cells; ++r)
                if (r != rank && (rows[r] & (uint64_t(1) << c))) rows[r] ^= rows[rank];
            pivots[rank++] = c;
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
        while (presses) { board ^= columns[trailing_zeros(presses)]; presses &= presses - 1; }
        return board;
    }
    bool solve(uint32_t board, uint32_t& best, int& length) const {
        for (int r = rank; r < cells; ++r)
            if (weight(uint32_t(rows[r] >> cells) & board) & 1) return false;
        uint32_t particular = 0;
        for (int r = 0; r < rank; ++r)
            if (weight(uint32_t(rows[r] >> cells) & board) & 1) particular |= uint32_t(1) << pivots[r];
        best = particular;
        length = weight(particular);
        uint32_t candidate = particular, previous = 0;
        for (uint32_t i = 1; i < (uint32_t(1) << kernel.size()); ++i) {
            uint32_t gray = i ^ (i >> 1);
            candidate ^= kernel[trailing_zeros(gray ^ previous)];
            previous = gray;
            int w = weight(candidate);
            if (w < length || (w == length && candidate < best)) { best = candidate; length = w; }
        }
        return image(best) == board;
    }
};

inline uint32_t parse_board(const std::string& text) {
    if (text.size() != cells) throw std::invalid_argument("board must contain 25 bits");
    uint32_t board = 0;
    for (int i = 0; i < cells; ++i) {
        if (text[i] != '0' && text[i] != '1') throw std::invalid_argument("board must contain only 0 and 1");
        if (text[i] == '1') board |= uint32_t(1) << i;
    }
    return board;
}

inline std::string format_board(uint32_t board) {
    std::string text;
    for (int i = 0; i < cells; ++i) text += (board & (uint32_t(1) << i)) ? '1' : '0';
    return text;
}

}  // namespace forge::lights
