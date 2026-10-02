#!/usr/bin/env python3
"""Integration tests for the native `forge` CLI. Usage: cli_test.py <forge-binary> <repo-root>"""
import json
import os
import shutil
import signal
import sqlite3
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

FORGE = os.path.abspath(sys.argv[1])
ROOT = os.path.abspath(sys.argv[2])
WORK = tempfile.mkdtemp(prefix="forge-cli-test-")
POSIX = os.name == "posix"
passed = 0


def forge(*args, expect=0, cwd=WORK):
    proc = subprocess.run([FORGE, *args], cwd=cwd, capture_output=True, text=True, timeout=600)
    assert proc.returncode == expect, f"forge {args} exited {proc.returncode} (wanted {expect})\n{proc.stdout}\n{proc.stderr}"
    return proc


def jforge(*args, **kw):
    return json.loads(forge(*args, **kw).stdout)


def db(path):
    return sqlite3.connect(os.path.join(WORK, path))


def check(condition, message):
    global passed
    assert condition, message
    passed += 1


def test_init_and_migrations():
    out = jforge("init", "--db", "init.sqlite")
    check(out["schema_version"] == 2, "schema version after init")
    con = db("init.sqlite")
    tables = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
    for t in ["jobs", "job_leases", "submissions", "verifications", "aggregate_results", "snapshots", "runs", "problems", "solver_versions",
              "schema_migrations", "chess_positions", "chess_edges", "chess_layers"]:
        check(t in tables, f"table {t} exists")
    check(con.execute("select count(*) from problems").fetchone()[0] == 5, "problems seeded")
    # re-running migrations is a no-op; tampering with an applied migration is detected
    jforge("init", "--db", "init.sqlite")
    con.execute("update schema_migrations set checksum='bad' where version=1")
    con.commit()
    proc = forge("init", "--db", "init.sqlite", expect=1)
    check("modified after being applied" in proc.stderr, "migration checksum tamper detected")


def test_nqueens_run_and_verify():
    out = jforge("run", "nqueens", "--n", "9", "--workers", "3", "--db", "q.sqlite")
    check(out["solutions"] == 352 and out["verified_jobs"] == 0, "n=9 computed but not yet verified")
    again = jforge("run", "nqueens", "--n", "9", "--workers", "3", "--db", "q.sqlite")
    check(again["run_id"] == out["run_id"] and again["solutions"] == 352, "run is idempotent")
    con = db("q.sqlite")
    check(con.execute("select count(*) from submissions").fetchone()[0] == out["total_jobs"], "completed jobs were not recomputed")
    v = jforge("verify", "--workers", "2", "--db", "q.sqlite")
    check(v["verified"] == out["total_jobs"] and v["disputed"] == 0, "all jobs verified by independent recomputation")
    row = con.execute("select r.status, a.verified_jobs, a.total_jobs, a.complete from runs r join aggregate_results a using(run_id)").fetchone()
    check(row == ("complete", out["total_jobs"], out["total_jobs"], 1), "aggregate marked complete")
    check(con.execute("select count(*) from submissions where status='verified'").fetchone()[0] == 2 * out["total_jobs"], "two matching submissions per job")
    check(con.execute("select count(*) from verifications where outcome='verified'").fetchone()[0] == out["total_jobs"], "verification records")


def test_chess_perft_run():
    out = jforge("run", "chess", "--depth", "4", "--workers", "2", "--db", "c.sqlite")
    check(out["perft"]["nodes"] == 197281 and out["perft"]["captures"] == 1576, "perft(4) matches published value")
    jforge("verify", "--db", "c.sqlite")
    layers = jforge("layers", "--depth", "4", "--db", "c.sqlite")["layers"]
    unique = [l["unique_positions"] for l in layers]
    sequences = [l["move_sequences"] for l in layers]
    check(unique == [1, 20, 400, 5362, 72078], f"unique positions per ply {unique}")
    check(sequences == [1, 20, 400, 8902, 197281], f"move sequences per ply {sequences}")
    check(unique[3] != sequences[3], "positions and sequences are distinct metrics")
    con = db("c.sqlite")
    check(con.execute("select count(*) from chess_positions where first_ply=3").fetchone()[0] <= 5362, "first-seen count bounded by layer size")
    check(con.execute("select count(*) from chess_edges").fetchone()[0] > 0, "edges stored")


def test_interrupt_and_resume():
    expected = 119060324
    args = [FORGE, "run", "chess", "--depth", "6", "--workers", "2", "--db", "int.sqlite"]
    proc = subprocess.Popen(args, cwd=WORK, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    time.sleep(2.0)
    if POSIX:
        proc.send_signal(signal.SIGINT)
        out, _ = proc.communicate(timeout=60)
        check(proc.returncode in (0, 130), "clean interruption exit code")
    else:
        proc.kill()
        proc.communicate()
        c = db("int.sqlite")
        c.execute("update jobs set lease_until = 0 where status in ('leased','running')")
        c.commit()
        c.close()
    con = db("int.sqlite")
    pending = con.execute("select count(*) from jobs where status in ('pending','leased','running')").fetchone()[0]
    done = con.execute("select count(*) from jobs where status = 'submitted'").fetchone()[0]
    check(pending > 0 or done == 400, "work remained or finished before interruption")
    con.close()
    res = jforge("resume", "--workers", "2", "--db", "int.sqlite")
    agg = res["resumed_runs"][0] if res["resumed_runs"] else None
    con = db("int.sqlite")
    total = json.loads(con.execute("select result from aggregate_results").fetchone()[0])
    check(total["perft"]["nodes"] == expected, "resumed run reaches exact perft(6)")
    check(con.execute("select count(*) from submissions").fetchone()[0] == 400, "no job was computed twice")
    del agg


def test_hard_kill_recovery():
    args = [FORGE, "run", "nqueens", "--n", "13", "--workers", "2", "--db", "kill.sqlite"]
    proc = subprocess.Popen(args, cwd=WORK, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    time.sleep(0.8)
    proc.kill()
    proc.communicate()
    con = db("kill.sqlite")
    con.execute("update jobs set lease_until = 0 where status in ('leased','running')")  # lease expiry
    con.commit()
    con.close()
    out = jforge("resume", "--workers", "3", "--db", "kill.sqlite")
    con = db("kill.sqlite")
    total = json.loads(con.execute("select result from aggregate_results").fetchone()[0])
    check(total["solutions"] == 73712, "N=13 exact after a hard kill and lease expiry")
    check(out["interrupted"] is False, "resume completed")


def test_export_import_merge():
    snap = os.path.join(WORK, "snap.json")
    forge("export", "--output", snap, "--db", "q.sqlite")
    data = json.load(open(snap))
    check(data["format"] == "forge-snapshot/1" and len(data["tables"]["jobs"]) > 0, "snapshot contents")
    report = jforge("import", snap, "--db", "imported.sqlite")
    check(report["jobs_inserted"] == len(data["tables"]["jobs"]), "import inserted every job")
    con = db("imported.sqlite")
    check(con.execute("select count(*) from jobs where status='verified'").fetchone()[0] == len(data["tables"]["jobs"]), "verification state preserved")
    again = jforge("import", snap, "--db", "imported.sqlite")
    check(again["jobs_inserted"] == 0, "re-import is idempotent")
    if shutil.which("zstd"):
        zst = os.path.join(WORK, "snap.json.zst")
        forge("export", "--output", zst, "--db", "q.sqlite")
        check(os.path.getsize(zst) < os.path.getsize(snap), "zstd smaller than json")
        check(jforge("import", zst, "--db", "imported2.sqlite")["jobs_inserted"] == report["jobs_inserted"], "zst import")

    # merge identical data: fine, no duplicates
    shutil.copy(os.path.join(WORK, "q.sqlite"), os.path.join(WORK, "a.sqlite"))
    shutil.copy(os.path.join(WORK, "q.sqlite"), os.path.join(WORK, "b.sqlite"))
    merged = jforge("merge", "a.sqlite", "b.sqlite", "m1.sqlite")
    check(merged["b"]["jobs_inserted"] == 0, "merge detected duplicate deterministic job ids")
    check(db("m1.sqlite").execute("select count(*) from jobs").fetchone()[0] == len(data["tables"]["jobs"]), "merged job count")
    forge("merge", "a.sqlite", "b.sqlite", "m1.sqlite", expect=1)  # refuses to overwrite

    # conflicting verified results are rejected, never silently overwritten
    con = db("b.sqlite")
    victim = con.execute("select job_id from jobs order by job_id limit 1").fetchone()[0]
    fake = json.dumps({"solutions": 999999})
    import hashlib
    fake_hash = hashlib.sha256(fake.encode()).hexdigest()
    con.execute("update submissions set result=?, result_hash=? where job_id=?", (fake, fake_hash, victim))
    con.execute("update jobs set verified_result=?, verified_result_hash=?, submitted_result_hash=? where job_id=?", (fake, fake_hash, fake_hash, victim))
    con.commit()
    con.close()
    proc = forge("merge", "a.sqlite", "b.sqlite", "m2.sqlite", expect=3)
    conflict = json.loads(proc.stdout)
    check(conflict["conflicts"][0]["kind"] == "verified_result_conflict" and conflict["conflicts"][0]["job_id"] == victim, "conflict reported with job id")
    check(not os.path.exists(os.path.join(WORK, "m2.sqlite")), "failed merge leaves no output")
    forge("merge", "a.sqlite", "b.sqlite", "m3.sqlite", "--resolve", "existing")
    good = db("a.sqlite").execute("select verified_result_hash from jobs where job_id=?", (victim,)).fetchone()[0]
    check(db("m3.sqlite").execute("select verified_result_hash from jobs where job_id=?", (victim,)).fetchone()[0] == good, "explicit resolution keeps the chosen value")
    forge("import", snap, "--resolve", "bogus", "--db", "imported.sqlite", expect=1)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_serve():
    port = free_port()
    proc = subprocess.Popen([FORGE, "serve", "--db", "c.sqlite", "--port", str(port)], cwd=WORK, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f"http://127.0.0.1:{port}"
        for _ in range(50):
            try:
                urllib.request.urlopen(base + "/api/status", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        status = json.load(urllib.request.urlopen(base + "/api/status"))
        check(any(r["problem"] == "chess" for r in status["runs"]), "status lists runs")
        layers = json.load(urllib.request.urlopen(base + "/api/chess/layers"))
        pos = json.load(urllib.request.urlopen(base + "/api/chess/position/" + layers["start_id"]))
        check(len(pos["children"]) == 20 and pos["position"]["legal_moves"] == 20, "start position has 20 stored children")
        page = urllib.request.urlopen(base + "/")
        csp = page.headers["Content-Security-Policy"]
        check("nonce-" in csp and "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0], "CSP uses a nonce for scripts")
        for bad, code in [("/api/chess/position/xyz", 400), ("/api/chess/position/" + "0" * 32, 404), ("/api/jobs?status=bogus", 400), ("/nope", 404),
                          ("/api/jobs?run=1%27%3B%20DROP", 400)]:
            try:
                urllib.request.urlopen(base + bad)
                check(False, f"{bad} should fail")
            except urllib.error.HTTPError as e:
                check(e.code == code, f"{bad} -> {e.code}")
        req = urllib.request.Request(base + "/api/status", method="POST", data=b"{}")
        try:
            urllib.request.urlopen(req)
            check(False, "POST must be rejected")
        except urllib.error.HTTPError as e:
            check(e.code == 405, "read-only server rejects POST")
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def test_call_and_usage():
    info = json.loads(forge("call", '{"method":"engine.info"}').stdout)
    check(info["ok"] and info["result"]["engine"] == "forge-engine/1", "engine.info via CLI")
    fixtures = json.load(open(os.path.join(ROOT, "database", "fixtures", "job_ids.json")))
    for case in fixtures["cases"]:
        reply = json.loads(forge("call", json.dumps({"method": "job.id", "params": {"def": case["definition"]}})).stdout)
        check(reply["result"]["job_id"] == case["job_id"], "native job id matches fixture")
    forge("call", '{"method":"nope"}', expect=1)
    forge("run", "nqueens", "--n", "99", "--db", "x.sqlite", expect=2)
    forge("run", "nqueens", "--db", "x.sqlite", expect=2)
    forge("run", "checkers", "--db", "x.sqlite", expect=2)
    forge("bogus", expect=2)
    forge("contribute", "chess", "--db", "x.sqlite", expect=2)  # not connected
    forge("connect", "http://evil.example.com", "--db", "x.sqlite", expect=2)
    forge("connect", "https://x.example.com/;rm -rf", "--db", "x.sqlite", expect=2)


try:
    test_init_and_migrations()
    test_call_and_usage()
    test_nqueens_run_and_verify()
    test_chess_perft_run()
    test_export_import_merge()
    test_serve()
    test_interrupt_and_resume()
    test_hard_kill_recovery()
    print(f"cli tests passed ({passed} checks)")
finally:
    shutil.rmtree(WORK, ignore_errors=True)
