-- Verification policy is per problem: required_matches = independent matching submissions needed.
INSERT INTO problems (problem, title, status, description, required_matches, lease_seconds, max_attempts) VALUES
  ('nqueens',    'N-Queens',        'complete', 'Exact solution counts by queen placement prefixes.', 2, 900, 8),
  ('tictactoe',  'Tic-Tac-Toe',     'complete', 'Complete game tree and minimax analysis.',            1, 600, 8),
  ('eight_puzzle', '8-Puzzle',      'complete', 'Breadth-first distances over all 181,440 reachable states.', 1, 600, 8),
  ('lights_out', 'Lights Out 5x5',  'complete', 'GF(2) analysis of all 2^25 boards.',                  1, 600, 8),
  ('chess',      'Chess',           'research', 'Resumable perft and unique-position enumeration. Chess is NOT solved.', 2, 900, 8);
