// Legal chess position representation, move generation, canonical identity and perft.
//
// Identity model (see docs/chess.md): a position is identified by piece placement, side to
// move, castling rights, and the en-passant square *only when a legal en-passant capture
// exists*. Halfmove and fullmove clocks are path data, not position identity.
// Move sequences ("games"/perft nodes) and unique positions are different metrics and are
// never mixed: perft counts sequences, layer enumeration counts distinct identities.
#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace forge::chess {

enum : uint8_t { EMPTY = 0, PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6 };
enum : uint8_t { CAP = 1, EP = 2, CASTLE = 4, DOUBLE = 8, PROMO = 16 };
enum : uint8_t { WK = 1, WQ = 2, BK = 4, BQ = 8 };

struct Position {
    std::array<uint8_t, 64> sq{};  // 0 = a1 ... 63 = h8; piece = type | (black ? 8 : 0)
    bool white = true;
    uint8_t castling = 0;
    int8_t ep = -1;                // en-passant target square, raw (set after every double push)
    uint16_t halfmove = 0, fullmove = 1;
    bool operator==(const Position& o) const {
        return sq == o.sq && white == o.white && castling == o.castling && ep == o.ep;
    }
};

struct Move {
    uint8_t from = 0, to = 0, promo = 0, flags = 0;
};

struct PerftCounts {
    uint64_t nodes = 0, captures = 0, en_passant = 0, castles = 0, promotions = 0;
    void add(const PerftCounts& o) {
        nodes += o.nodes; captures += o.captures; en_passant += o.en_passant;
        castles += o.castles; promotions += o.promotions;
    }
};

inline bool on_board(int f, int r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }
inline int color_of(uint8_t piece) { return piece >> 3; }
inline int type_of(uint8_t piece) { return piece & 7; }

inline bool attacked(const Position& p, int square, bool by_white) {
    static const int knight[8][2] = {{1,2},{2,1},{2,-1},{1,-2},{-1,-2},{-2,-1},{-2,1},{-1,2}};
    static const int king[8][2] = {{1,0},{1,1},{0,1},{-1,1},{-1,0},{-1,-1},{0,-1},{1,-1}};
    const int f = square & 7, r = square >> 3;
    const uint8_t side = by_white ? 0 : 8;
    const int pawn_rank = by_white ? r - 1 : r + 1;
    for (int df : {-1, 1})
        if (on_board(f + df, pawn_rank) && p.sq[pawn_rank * 8 + f + df] == (side | PAWN)) return true;
    for (const auto& d : knight)
        if (on_board(f + d[0], r + d[1]) && p.sq[(r + d[1]) * 8 + f + d[0]] == (side | KNIGHT)) return true;
    for (const auto& d : king)
        if (on_board(f + d[0], r + d[1]) && p.sq[(r + d[1]) * 8 + f + d[0]] == (side | KING)) return true;
    for (int i = 0; i < 8; ++i) {
        const bool diagonal = (i & 1) != 0;  // odd direction indices are diagonals
        int x = f + king[i][0], y = r + king[i][1];
        while (on_board(x, y)) {
            uint8_t piece = p.sq[y * 8 + x];
            if (piece) {
                if (color_of(piece) == (by_white ? 0 : 1)) {
                    int t = type_of(piece);
                    if (t == QUEEN || (diagonal ? t == BISHOP : t == ROOK)) return true;
                }
                break;
            }
            x += king[i][0]; y += king[i][1];
        }
    }
    return false;
}

inline int king_square(const Position& p, bool white) {
    uint8_t target = uint8_t(KING | (white ? 0 : 8));
    for (int i = 0; i < 64; ++i) if (p.sq[i] == target) return i;
    return -1;
}

inline bool in_check(const Position& p) {
    int k = king_square(p, p.white);
    return k >= 0 && attacked(p, k, !p.white);
}

inline Position make(const Position& p, const Move& m) {
    Position n = p;
    uint8_t piece = n.sq[m.from];
    n.sq[m.from] = EMPTY;
    if (m.flags & EP) n.sq[p.white ? m.to - 8 : m.to + 8] = EMPTY;
    n.sq[m.to] = m.promo ? uint8_t(m.promo | (p.white ? 0 : 8)) : piece;
    if (m.flags & CASTLE) {
        if (m.to == 6) { n.sq[7] = EMPTY; n.sq[5] = uint8_t(ROOK); }
        else if (m.to == 2) { n.sq[0] = EMPTY; n.sq[3] = uint8_t(ROOK); }
        else if (m.to == 62) { n.sq[63] = EMPTY; n.sq[61] = uint8_t(8 | ROOK); }
        else { n.sq[56] = EMPTY; n.sq[59] = uint8_t(8 | ROOK); }
    }
    auto drop = [&](int s) {
        if (s == 4) n.castling &= uint8_t(~(WK | WQ));
        else if (s == 0) n.castling &= uint8_t(~WQ);
        else if (s == 7) n.castling &= uint8_t(~WK);
        else if (s == 60) n.castling &= uint8_t(~(BK | BQ));
        else if (s == 56) n.castling &= uint8_t(~BQ);
        else if (s == 63) n.castling &= uint8_t(~BK);
    };
    drop(m.from); drop(m.to);
    n.ep = (m.flags & DOUBLE) ? int8_t((m.from + m.to) / 2) : int8_t(-1);
    n.halfmove = (type_of(piece) == PAWN || (m.flags & (CAP | EP))) ? 0 : uint16_t(p.halfmove + 1);
    if (!p.white) ++n.fullmove;
    n.white = !p.white;
    return n;
}

inline void pseudo_moves(const Position& p, std::vector<Move>& out) {
    static const int knight[8][2] = {{1,2},{2,1},{2,-1},{1,-2},{-1,-2},{-2,-1},{-2,1},{-1,2}};
    static const int king[8][2] = {{1,0},{1,1},{0,1},{-1,1},{-1,0},{-1,-1},{0,-1},{1,-1}};
    const int me = p.white ? 0 : 1;
    for (int from = 0; from < 64; ++from) {
        uint8_t piece = p.sq[from];
        if (!piece || color_of(piece) != me) continue;
        const int t = type_of(piece), f = from & 7, r = from >> 3;
        if (t == PAWN) {
            const int dir = p.white ? 1 : -1, start = p.white ? 1 : 6, last = p.white ? 7 : 0;
            auto push = [&](int to, uint8_t flags) {
                if ((to >> 3) == last) {
                    for (uint8_t promo : {QUEEN, ROOK, BISHOP, KNIGHT})
                        out.push_back({uint8_t(from), uint8_t(to), promo, uint8_t(flags | PROMO)});
                } else out.push_back({uint8_t(from), uint8_t(to), 0, flags});
            };
            if (on_board(f, r + dir) && !p.sq[(r + dir) * 8 + f]) {
                push((r + dir) * 8 + f, 0);
                if (r == start && !p.sq[(r + 2 * dir) * 8 + f])
                    out.push_back({uint8_t(from), uint8_t((r + 2 * dir) * 8 + f), 0, DOUBLE});
            }
            for (int df : {-1, 1}) {
                if (!on_board(f + df, r + dir)) continue;
                int to = (r + dir) * 8 + f + df;
                if (p.sq[to] && color_of(p.sq[to]) != me) push(to, CAP);
                else if (!p.sq[to] && to == p.ep) out.push_back({uint8_t(from), uint8_t(to), 0, uint8_t(EP | CAP)});
            }
        } else if (t == KNIGHT || t == KING) {
            const auto* table = t == KNIGHT ? knight : king;
            for (int i = 0; i < 8; ++i) {
                int x = f + table[i][0], y = r + table[i][1];
                if (!on_board(x, y)) continue;
                uint8_t target = p.sq[y * 8 + x];
                if (!target) out.push_back({uint8_t(from), uint8_t(y * 8 + x), 0, 0});
                else if (color_of(target) != me) out.push_back({uint8_t(from), uint8_t(y * 8 + x), 0, CAP});
            }
        } else {
            for (int i = 0; i < 8; ++i) {
                const bool diagonal = (i & 1) != 0;  // odd direction indices are diagonals
                if (t == BISHOP && !diagonal) continue;
                if (t == ROOK && diagonal) continue;
                int x = f + king[i][0], y = r + king[i][1];
                while (on_board(x, y)) {
                    uint8_t target = p.sq[y * 8 + x];
                    if (!target) out.push_back({uint8_t(from), uint8_t(y * 8 + x), 0, 0});
                    else {
                        if (color_of(target) != me) out.push_back({uint8_t(from), uint8_t(y * 8 + x), 0, CAP});
                        break;
                    }
                    x += king[i][0]; y += king[i][1];
                }
            }
        }
    }
    // Castling (rights are kept consistent with piece placement by make() and parse_fen()).
    const int home = p.white ? 4 : 60;
    if (p.sq[home] == uint8_t(KING | (p.white ? 0 : 8)) && !attacked(p, home, !p.white)) {
        const uint8_t rook = uint8_t(ROOK | (p.white ? 0 : 8));
        const uint8_t kside = p.white ? WK : BK, qside = p.white ? WQ : BQ;
        if ((p.castling & kside) && p.sq[home + 3] == rook && !p.sq[home + 1] && !p.sq[home + 2] &&
            !attacked(p, home + 1, !p.white) && !attacked(p, home + 2, !p.white))
            out.push_back({uint8_t(home), uint8_t(home + 2), 0, CASTLE});
        if ((p.castling & qside) && p.sq[home - 4] == rook && !p.sq[home - 1] && !p.sq[home - 2] &&
            !p.sq[home - 3] && !attacked(p, home - 1, !p.white) && !attacked(p, home - 2, !p.white))
            out.push_back({uint8_t(home), uint8_t(home - 2), 0, CASTLE});
    }
}

inline std::vector<Move> legal_moves(const Position& p) {
    std::vector<Move> pseudo, legal;
    pseudo.reserve(48);
    pseudo_moves(p, pseudo);
    for (const Move& m : pseudo) {
        Position n = make(p, m);
        int k = king_square(n, p.white);
        if (k >= 0 && !attacked(n, k, !p.white)) legal.push_back(m);
    }
    return legal;
}

inline void perft_counts(const Position& p, int depth, PerftCounts& total) {
    std::vector<Move> moves = legal_moves(p);
    if (depth == 1) {
        for (const Move& m : moves) {
            ++total.nodes;
            if (m.flags & CAP) ++total.captures;
            if (m.flags & EP) ++total.en_passant;
            if (m.flags & CASTLE) ++total.castles;
            if (m.flags & PROMO) ++total.promotions;
        }
        return;
    }
    for (const Move& m : moves) perft_counts(make(p, m), depth - 1, total);
}

inline PerftCounts perft(const Position& p, int depth) {
    PerftCounts counts;
    if (depth == 0) { counts.nodes = 1; return counts; }
    perft_counts(p, depth, counts);
    return counts;
}

// ---- notation -------------------------------------------------------------------------

inline std::string square_name(int s) {
    return std::string{char('a' + (s & 7)), char('1' + (s >> 3))};
}

inline std::string uci(const Move& m) {
    std::string text = square_name(m.from) + square_name(m.to);
    if (m.promo) text += "pnbrqk"[m.promo - 1];
    return text;
}

inline Position normalize(Position p);

inline Position parse_fen(const std::string& fen) {
    std::istringstream in(fen);
    std::string placement, side, rights, passant;
    if (!(in >> placement >> side >> rights >> passant)) throw std::invalid_argument("FEN needs at least four fields");
    Position p;
    int f = 0, r = 7;
    for (char c : placement) {
        if (c == '/') { if (f != 8 || r == 0) throw std::invalid_argument("bad FEN rank"); --r; f = 0; continue; }
        if (c >= '1' && c <= '8') { f += c - '0'; if (f > 8) throw std::invalid_argument("bad FEN rank"); continue; }
        const std::string names = "pnbrqk";
        size_t i = names.find(char(c | 0x20));
        if (i == std::string::npos || f > 7) throw std::invalid_argument("bad FEN piece");
        p.sq[r * 8 + f++] = uint8_t((i + 1) | ((c >= 'a' && c <= 'z') ? 8 : 0));
    }
    if (r != 0 || f != 8) throw std::invalid_argument("FEN must describe 8 ranks");
    if (side != "w" && side != "b") throw std::invalid_argument("bad FEN side to move");
    p.white = side == "w";
    if (rights != "-")
        for (char c : rights) {
            if (c == 'K') p.castling |= WK; else if (c == 'Q') p.castling |= WQ;
            else if (c == 'k') p.castling |= BK; else if (c == 'q') p.castling |= BQ;
            else throw std::invalid_argument("bad FEN castling field");
        }
    if (passant != "-") {
        if (passant.size() != 2 || passant[0] < 'a' || passant[0] > 'h' || (passant[1] != '3' && passant[1] != '6'))
            throw std::invalid_argument("bad FEN en-passant field");
        p.ep = int8_t((passant[1] - '1') * 8 + (passant[0] - 'a'));
    }
    int wk = 0, bk = 0;
    for (int i = 0; i < 64; ++i) {
        if (p.sq[i] == KING) ++wk;
        if (p.sq[i] == (8 | KING)) ++bk;
        if (type_of(p.sq[i]) == PAWN && ((i >> 3) == 0 || (i >> 3) == 7)) throw std::invalid_argument("pawn on back rank");
    }
    if (wk != 1 || bk != 1) throw std::invalid_argument("each side needs exactly one king");
    if (p.sq[4] != KING) p.castling &= uint8_t(~(WK | WQ));
    if (p.sq[0] != ROOK) p.castling &= uint8_t(~WQ);
    if (p.sq[7] != ROOK) p.castling &= uint8_t(~WK);
    if (p.sq[60] != (8 | KING)) p.castling &= uint8_t(~(BK | BQ));
    if (p.sq[56] != (8 | ROOK)) p.castling &= uint8_t(~BQ);
    if (p.sq[63] != (8 | ROOK)) p.castling &= uint8_t(~BK);
    int wq = king_square(p, !p.white);
    if (attacked(p, wq, p.white)) throw std::invalid_argument("side not to move is in check");
    if (in >> p.halfmove) { in >> p.fullmove; if (p.fullmove == 0) p.fullmove = 1; } else { p.halfmove = 0; p.fullmove = 1; }
    return normalize(p);
}

inline std::string placement_text(const Position& p) {
    std::string text;
    for (int r = 7; r >= 0; --r) {
        int empty = 0;
        for (int f = 0; f < 8; ++f) {
            uint8_t piece = p.sq[r * 8 + f];
            if (!piece) { ++empty; continue; }
            if (empty) { text += char('0' + empty); empty = 0; }
            char c = "pnbrqk"[type_of(piece) - 1];
            text += color_of(piece) ? c : char(c - 32);
        }
        if (empty) text += char('0' + empty);
        if (r) text += '/';
    }
    return text;
}

// Four-field EPD-style text: the canonical, clock-free serialization of a position identity.
inline std::string epd(const Position& p) {
    std::string rights;
    if (p.castling & WK) rights += 'K';
    if (p.castling & WQ) rights += 'Q';
    if (p.castling & BK) rights += 'k';
    if (p.castling & BQ) rights += 'q';
    if (rights.empty()) rights = "-";
    return placement_text(p) + (p.white ? " w " : " b ") + rights + " " + (p.ep >= 0 ? square_name(p.ep) : "-");
}

inline std::string fen(const Position& p) {
    return epd(p) + " " + std::to_string(p.halfmove) + " " + std::to_string(p.fullmove);
}

inline Position start_position() {
    return parse_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
}

// Clears the en-passant square unless a legal en-passant capture exists, and resets clocks.
inline Position normalize(Position p) {
    if (p.ep >= 0) {
        bool legal = false;
        for (const Move& m : legal_moves(p)) if (m.flags & EP) { legal = true; break; }
        if (!legal) p.ep = -1;
    }
    p.halfmove = 0;
    p.fullmove = 1;
    return p;
}

inline Move parse_uci(const Position& p, const std::string& text) {
    for (const Move& m : legal_moves(p)) if (uci(m) == text) return m;
    throw std::invalid_argument("illegal move: " + text);
}

// ---- identity ---------------------------------------------------------------------------

struct PositionId {
    uint64_t hi = 0, lo = 0;
    bool operator==(const PositionId& o) const { return hi == o.hi && lo == o.lo; }
    bool operator!=(const PositionId& o) const { return !(*this == o); }
    bool operator<(const PositionId& o) const { return hi != o.hi ? hi < o.hi : lo < o.lo; }
    std::string hex() const {
        static const char* d = "0123456789abcdef";
        std::string s(32, '0');
        for (int i = 0; i < 16; ++i) {
            s[i] = d[(hi >> (60 - 4 * i)) & 15];
            s[16 + i] = d[(lo >> (60 - 4 * i)) & 15];
        }
        return s;
    }
};

inline uint64_t splitmix64(uint64_t& state) {
    uint64_t z = (state += 0x9e3779b97f4a7c15ULL);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
}

struct Zobrist {
    uint64_t piece[2][64][16], castle[2][16], ep[2][8], side[2];
    Zobrist() {
        uint64_t state = 0x434f4d42464f5247ULL;  // fixed seed: ids are stable across platforms
        for (int k = 0; k < 2; ++k) {
            for (auto& s : piece[k]) for (auto& v : s) v = splitmix64(state);
            for (auto& v : castle[k]) v = splitmix64(state);
            for (auto& v : ep[k]) v = splitmix64(state);
            side[k] = splitmix64(state);
        }
    }
};

// `p` must be normalized (see normalize); the clocks are not hashed.
inline PositionId position_id(const Position& p) {
    static const Zobrist z;
    uint64_t h[2] = {0, 0};
    for (int k = 0; k < 2; ++k) {
        for (int i = 0; i < 64; ++i) if (p.sq[i]) h[k] ^= z.piece[k][i][p.sq[i]];
        h[k] ^= z.castle[k][p.castling];
        if (p.ep >= 0) h[k] ^= z.ep[k][p.ep & 7];
        if (!p.white) h[k] ^= z.side[k];
    }
    return {h[0], h[1]};
}

// 34-byte exact serialization: 32 bytes of nibble-packed squares, flags, en-passant square + 1.
inline std::string pack(const Position& p) {
    std::string out(34, '\0');
    for (int i = 0; i < 64; i += 2) out[i / 2] = char(p.sq[i] | (p.sq[i + 1] << 4));
    out[32] = char((p.white ? 1 : 0) | (p.castling << 1));
    out[33] = char(p.ep + 1);
    return out;
}

inline Position unpack(const std::string& blob) {
    if (blob.size() != 34) throw std::invalid_argument("bad packed position size");
    Position p;
    for (int i = 0; i < 64; i += 2) {
        uint8_t byte = uint8_t(blob[i / 2]);
        p.sq[i] = byte & 15; p.sq[i + 1] = byte >> 4;
    }
    p.white = blob[32] & 1;
    p.castling = uint8_t((uint8_t(blob[32]) >> 1) & 15);
    p.ep = int8_t(uint8_t(blob[33]) - 1);
    return p;
}

// Distinct legal successors reached by one half-move, normalized, with the move that made them.
inline std::vector<std::pair<Move, Position>> successors(const Position& p) {
    std::vector<std::pair<Move, Position>> out;
    for (const Move& m : legal_moves(p)) out.emplace_back(m, normalize(make(p, m)));
    return out;
}

}  // namespace forge::chess
