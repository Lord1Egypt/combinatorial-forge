// N-Queens completion counting from a fixed column prefix (the unit of distributed work).
#pragma once
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace forge::nqueens {

constexpr int max_n = 27;  // solution counts stay inside int64 through N = 27

struct Prefix {
    uint32_t cols = 0, rising = 0, falling = 0;
    int depth = 0;
};

inline uint32_t full_mask(int n) { return n >= 32 ? ~uint32_t(0) : (uint32_t(1) << n) - 1; }

// Places a queen in the next row at `col`; false when the square is attacked or off the board.
inline bool place(int n, Prefix& p, int col) {
    if (col < 0 || col >= n || p.depth >= n) return false;
    uint32_t bit = uint32_t(1) << col;
    if ((p.cols | p.rising | p.falling) & bit) return false;
    p.cols |= bit;
    p.rising = (p.rising | bit) << 1;
    p.falling = (p.falling | bit) >> 1;
    ++p.depth;
    return true;
}

inline Prefix make_prefix(int n, const std::vector<int>& columns) {
    if (n < 1 || n > max_n) throw std::invalid_argument("n out of range");
    Prefix p;
    for (int col : columns)
        if (!place(n, p, col)) throw std::invalid_argument("prefix is not a legal non-attacking placement");
    return p;
}

inline uint64_t count(const Prefix& p, int n, uint64_t& nodes) {
    ++nodes;
    if (p.depth == n) return 1;
    uint64_t total = 0;
    uint32_t available = full_mask(n) & ~(p.cols | p.rising | p.falling);
    while (available) {
        uint32_t bit = available & (~available + 1);
        available ^= bit;
        Prefix next{p.cols | bit, (p.rising | bit) << 1, (p.falling | bit) >> 1, p.depth + 1};
        total += count(next, n, nodes);
    }
    return total;
}

// All legal column sequences of exactly `levels` additional rows after `base`, in lexicographic order.
inline void expand(int n, const Prefix& base, const std::vector<int>& columns, int levels,
                   std::vector<std::vector<int>>& out) {
    if (levels == 0 || base.depth == n) { out.push_back(columns); return; }
    for (int col = 0; col < n; ++col) {
        Prefix next = base;
        if (!place(n, next, col)) continue;
        std::vector<int> extended = columns;
        extended.push_back(col);
        expand(n, next, extended, levels - 1, out);
    }
}

}  // namespace forge::nqueens
