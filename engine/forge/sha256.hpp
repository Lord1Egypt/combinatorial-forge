// Minimal SHA-256 (FIPS 180-4). Used for deterministic job identifiers and result hashes.
#pragma once
#include <array>
#include <cstdint>
#include <string>

namespace forge {

class Sha256 {
public:
    Sha256() { reset(); }
    void reset() {
        state_ = {{0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
                   0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u}};
        length_ = 0;
        used_ = 0;
    }
    void update(const void* data, size_t size) {
        const auto* bytes = static_cast<const uint8_t*>(data);
        length_ += size;
        while (size > 0) {
            size_t take = 64 - used_ < size ? 64 - used_ : size;
            for (size_t i = 0; i < take; ++i) block_[used_ + i] = bytes[i];
            used_ += take; bytes += take; size -= take;
            if (used_ == 64) { compress(); used_ = 0; }
        }
    }
    void update(const std::string& text) { update(text.data(), text.size()); }
    std::array<uint8_t, 32> finish() {
        uint64_t bits = length_ * 8;
        uint8_t pad = 0x80;
        update(&pad, 1);
        uint8_t zero = 0;
        while (used_ != 56) update(&zero, 1);
        uint8_t tail[8];
        for (int i = 0; i < 8; ++i) tail[i] = uint8_t(bits >> (56 - 8 * i));
        update(tail, 8);
        std::array<uint8_t, 32> out{};
        for (int i = 0; i < 8; ++i)
            for (int j = 0; j < 4; ++j) out[i * 4 + j] = uint8_t(state_[i] >> (24 - 8 * j));
        reset();
        return out;
    }
    static std::string hex(const std::array<uint8_t, 32>& digest) {
        static const char* digits = "0123456789abcdef";
        std::string text;
        for (uint8_t byte : digest) { text += digits[byte >> 4]; text += digits[byte & 15]; }
        return text;
    }

private:
    static uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
    void compress() {
        static const uint32_t k[64] = {
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
        uint32_t w[64];
        for (int i = 0; i < 16; ++i)
            w[i] = uint32_t(block_[i*4]) << 24 | uint32_t(block_[i*4+1]) << 16 |
                   uint32_t(block_[i*4+2]) << 8 | uint32_t(block_[i*4+3]);
        for (int i = 16; i < 64; ++i) {
            uint32_t s0 = rotr(w[i-15], 7) ^ rotr(w[i-15], 18) ^ (w[i-15] >> 3);
            uint32_t s1 = rotr(w[i-2], 17) ^ rotr(w[i-2], 19) ^ (w[i-2] >> 10);
            w[i] = w[i-16] + s0 + w[i-7] + s1;
        }
        uint32_t a = state_[0], b = state_[1], c = state_[2], d = state_[3];
        uint32_t e = state_[4], f = state_[5], g = state_[6], h = state_[7];
        for (int i = 0; i < 64; ++i) {
            uint32_t s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            uint32_t ch = (e & f) ^ (~e & g);
            uint32_t t1 = h + s1 + ch + k[i] + w[i];
            uint32_t s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
            uint32_t t2 = s0 + maj;
            h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
        }
        state_[0] += a; state_[1] += b; state_[2] += c; state_[3] += d;
        state_[4] += e; state_[5] += f; state_[6] += g; state_[7] += h;
    }
    std::array<uint32_t, 8> state_{};
    uint8_t block_[64]{};
    uint64_t length_ = 0;
    size_t used_ = 0;
};

inline std::string sha256_hex(const std::string& text) {
    Sha256 hash;
    hash.update(text);
    return Sha256::hex(hash.finish());
}

}  // namespace forge
