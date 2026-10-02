#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <thread>
#include <vector>

struct Task {
    uint32_t columns, down_left, down_right;
    int row, multiplicity;
};

static uint32_t board_mask;
static int board_size;

static inline uint64_t count_from(int row, uint32_t columns,
                                  uint32_t down_left, uint32_t down_right) {
    uint32_t choices = board_mask & ~(columns | down_left | down_right);
    if (row == board_size - 1) return __builtin_popcount(choices);
    uint64_t total = 0;
    while (choices) {
        uint32_t bit = choices & -choices;
        choices -= bit;
        total += count_from(row + 1, columns | bit,
                            (down_left | bit) << 1, (down_right | bit) >> 1);
    }
    return total;
}

static void make_tasks(std::vector<Task>& tasks, int row, uint32_t columns,
                       uint32_t down_left, uint32_t down_right,
                       int multiplicity, int split_row) {
    if (row == split_row) {
        tasks.push_back({columns, down_left, down_right, row, multiplicity});
        return;
    }
    uint32_t choices = board_mask & ~(columns | down_left | down_right);
    while (choices) {
        uint32_t bit = choices & -choices;
        choices -= bit;
        make_tasks(tasks, row + 1, columns | bit,
                   (down_left | bit) << 1, (down_right | bit) >> 1,
                   multiplicity, split_row);
    }
}

int main(int argc, char** argv) {
    if (argc < 2 || argc > 3) return 2;
    board_size = std::atoi(argv[1]);
    if (board_size < 1 || board_size > 31) return 2;
    int threads = argc == 3 ? std::atoi(argv[2]) : 6;
    if (threads < 1) return 2;
    board_mask = (uint32_t(1) << board_size) - 1;
    auto start = std::chrono::steady_clock::now();
    if (board_size == 1) {
        std::cout << "1 1 0\n";
        return 0;
    }
    std::vector<Task> tasks;
    int split_row = std::min(4, board_size - 1);
    for (int c = 0; c < (board_size + 1) / 2; ++c) {
        uint32_t bit = uint32_t(1) << c;
        int factor = c == board_size - 1 - c ? 1 : 2;
        make_tasks(tasks, 1, bit, bit << 1, bit >> 1, factor, split_row);
    }
    std::atomic<size_t> next{0};
    std::vector<uint64_t> partial(threads, 0);
    std::vector<std::thread> pool;
    for (int worker = 0; worker < threads; ++worker) {
        pool.emplace_back([&, worker] {
            uint64_t subtotal = 0;
            for (;;) {
                size_t k = next.fetch_add(1, std::memory_order_relaxed);
                if (k >= tasks.size()) break;
                const Task& t = tasks[k];
                subtotal += t.multiplicity * count_from(t.row, t.columns,
                                      t.down_left, t.down_right);
            }
            partial[worker] = subtotal;
        });
    }
    for (auto& worker : pool) worker.join();
    uint64_t total = 0;
    for (uint64_t x : partial) total += x;
    double seconds = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - start).count();
    std::cout << board_size << ' ' << total << ' ' << seconds << '\n';
}
