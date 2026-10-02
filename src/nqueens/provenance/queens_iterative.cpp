#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <thread>
#include <vector>

// Search by column. Bit positions designate rows, so this is the transpose
// of the row-wise recursive solver and has an independent traversal.
struct Prefix {
    uint32_t occupied_rows, rising, falling;
    int depth, weight;
};

static uint64_t enumerate(const Prefix& p, int n, uint32_t mask) {
    uint32_t occupied[32], rising[32], falling[32], remaining[32];
    int depth = p.depth;
    occupied[depth] = p.occupied_rows;
    rising[depth] = p.rising;
    falling[depth] = p.falling;
    remaining[depth] = mask & ~(occupied[depth] | rising[depth] | falling[depth]);
    uint64_t solutions = 0;
    for (;;) {
        uint32_t available = remaining[depth];
        if (available) {
            if (depth == n - 1) {
                solutions += __builtin_popcount(available);
                remaining[depth] = 0;
                continue;
            }
            uint32_t selected = available & (~available + 1);
            remaining[depth] = available ^ selected;
            occupied[depth + 1] = occupied[depth] | selected;
            rising[depth + 1] = (rising[depth] | selected) << 1;
            falling[depth + 1] = (falling[depth] | selected) >> 1;
            ++depth;
            remaining[depth] = mask & ~(occupied[depth] | rising[depth] | falling[depth]);
        } else {
            if (depth == p.depth) break;
            --depth;
        }
    }
    return solutions * p.weight;
}

int main(int argc, char** argv) {
    if (argc < 2 || argc > 3) return 2;
    int n = std::atoi(argv[1]);
    if (n < 1 || n > 31) return 2;
    int workers = argc == 3 ? std::atoi(argv[2]) : 6;
    if (workers < 1) return 2;
    const uint32_t mask = (uint32_t(1) << n) - 1;
    const auto start = std::chrono::steady_clock::now();
    if (n == 1) {
        std::cout << "1 1 0\n";
        return 0;
    }
    std::vector<Prefix> jobs;
    int target = n > 3 ? 3 : n - 1;
    for (int first = 0; first <= (n - 1) / 2; ++first) {
        uint32_t b0 = uint32_t(1) << first;
        int weight = 1 + (first * 2 != n - 1);
        Prefix initial{b0, b0 << 1, b0 >> 1, 1, weight};
        if (target == 1) { jobs.push_back(initial); continue; }
        uint32_t second_choices = mask & ~(initial.occupied_rows | initial.rising | initial.falling);
        while (second_choices) {
            uint32_t b1 = second_choices & (~second_choices + 1);
            second_choices ^= b1;
            Prefix second{initial.occupied_rows | b1,
                          (initial.rising | b1) << 1,
                          (initial.falling | b1) >> 1, 2, weight};
            if (target == 2) { jobs.push_back(second); continue; }
            uint32_t third_choices = mask & ~(second.occupied_rows | second.rising | second.falling);
            while (third_choices) {
                uint32_t b2 = third_choices & (~third_choices + 1);
                third_choices ^= b2;
                jobs.push_back({second.occupied_rows | b2,
                                (second.rising | b2) << 1,
                                (second.falling | b2) >> 1, 3, weight});
            }
        }
    }
    std::atomic<size_t> cursor{0};
    std::vector<uint64_t> totals(workers, 0);
    std::vector<std::thread> threads;
    for (int w = 0; w < workers; ++w) {
        threads.emplace_back([&, w] {
            uint64_t count = 0;
            for (;;) {
                size_t i = cursor.fetch_add(1, std::memory_order_relaxed);
                if (i >= jobs.size()) break;
                count += enumerate(jobs[i], n, mask);
            }
            totals[w] = count;
        });
    }
    for (auto& t : threads) t.join();
    uint64_t result = 0;
    for (uint64_t subtotal : totals) result += subtotal;
    double seconds = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - start).count();
    std::cout << n << ' ' << result << ' ' << seconds << '\n';
}
