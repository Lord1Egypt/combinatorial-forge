# Chess research computation

The shared chess engine parses FEN/EPD, generates legal moves, and hashes a
canonical position including side to move, castling rights, and legally
relevant en-passant state. Tests include six perft suites. Deterministic jobs
partition the move tree by prefix; checkpoints can resume an unfinished job.

`forge run chess --depth 4 --workers 2 --db chess.sqlite` computes move-sequence
counts. `forge verify --db chess.sqlite` independently recomputes submitted
jobs. `forge layers --depth 4 --db chess.sqlite` persists unique position layers
and stored edges for exploration. A fresh run on 2026-10-02 produced 197,281
move sequences and 72,078 unique positions at ply 4; all 400 partitioned jobs
were independently verified. These are complete for the stated depth only.
Chess as a whole remains an incomplete research computation.
