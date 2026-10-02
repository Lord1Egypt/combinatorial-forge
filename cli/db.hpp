// Thin RAII wrapper over SQLite plus migration application.
#pragma once
#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

#include "forge/json.hpp"
#include "forge/sha256.hpp"
#include "sqlite3.h"

namespace forge::cli {

struct EmbeddedMigration {
    int version;
    const char* name;
    const unsigned char* data;
    size_t size;
};
extern const EmbeddedMigration embedded_migrations[];
extern const size_t embedded_migration_count;

inline int64_t now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch()).count();
}

inline std::string random_hex(size_t bytes) {
    static const char* digits = "0123456789abcdef";
    std::random_device device;
    std::string out;
    for (size_t i = 0; i < bytes; ++i) {
        unsigned v = device() & 0xff;
        out += digits[v >> 4]; out += digits[v & 15];
    }
    return out;
}

class Stmt;

class Db {
public:
    explicit Db(const std::string& path, bool read_only = false) {
        int flags = read_only ? SQLITE_OPEN_READONLY : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
        if (sqlite3_open_v2(path.c_str(), &handle_, flags | SQLITE_OPEN_FULLMUTEX, nullptr) != SQLITE_OK) {
            std::string message = handle_ ? sqlite3_errmsg(handle_) : "out of memory";
            if (handle_) sqlite3_close(handle_);
            throw std::runtime_error("cannot open database " + path + ": " + message);
        }
        sqlite3_busy_timeout(handle_, 10000);
        exec("PRAGMA foreign_keys=ON");
        if (!read_only) exec("PRAGMA journal_mode=WAL");
    }
    ~Db() { if (handle_) sqlite3_close(handle_); }
    Db(const Db&) = delete;
    Db& operator=(const Db&) = delete;

    sqlite3* handle() const { return handle_; }
    void exec(const std::string& sql) {
        char* error = nullptr;
        if (sqlite3_exec(handle_, sql.c_str(), nullptr, nullptr, &error) != SQLITE_OK) {
            std::string message = error ? error : "unknown error";
            sqlite3_free(error);
            throw std::runtime_error("sqlite: " + message);
        }
    }
    int64_t changes() const { return sqlite3_changes(handle_); }
    std::mutex& mutex() { return mutex_; }

    Stmt prepare(const std::string& sql);

    // BEGIN IMMEDIATE ... COMMIT; rolls back and rethrows when the callback throws.
    template <typename F>
    auto transaction(F&& body) -> decltype(body()) {
        exec("BEGIN IMMEDIATE");
        try {
            if constexpr (std::is_void_v<decltype(body())>) { body(); exec("COMMIT"); }
            else { auto value = body(); exec("COMMIT"); return value; }
        } catch (...) {
            sqlite3_exec(handle_, "ROLLBACK", nullptr, nullptr, nullptr);
            throw;
        }
    }

private:
    sqlite3* handle_ = nullptr;
    std::mutex mutex_;
};

class Stmt {
public:
    Stmt(Db& db, const std::string& sql) : db_(db.handle()) {
        if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt_, nullptr) != SQLITE_OK)
            throw std::runtime_error(std::string("sqlite prepare: ") + sqlite3_errmsg(db_) + " in: " + sql);
    }
    Stmt(Stmt&& other) noexcept : db_(other.db_), stmt_(other.stmt_) { other.stmt_ = nullptr; }
    Stmt(const Stmt&) = delete;
    ~Stmt() { if (stmt_) sqlite3_finalize(stmt_); }

    Stmt& bind(int index, const std::string& value) {
        check(sqlite3_bind_text(stmt_, index, value.data(), int(value.size()), SQLITE_TRANSIENT));
        return *this;
    }
    Stmt& bind(int index, const char* value) { return bind(index, std::string(value)); }
    Stmt& bind(int index, int64_t value) { check(sqlite3_bind_int64(stmt_, index, value)); return *this; }
    Stmt& bind(int index, int value) { return bind(index, int64_t(value)); }
    Stmt& bind(int index, std::nullptr_t) { check(sqlite3_bind_null(stmt_, index)); return *this; }
    Stmt& bind_blob(int index, const std::string& value) {
        check(sqlite3_bind_blob(stmt_, index, value.data(), int(value.size()), SQLITE_TRANSIENT));
        return *this;
    }
    // Returns true when a row is available.
    bool step() {
        int rc = sqlite3_step(stmt_);
        if (rc == SQLITE_ROW) return true;
        if (rc == SQLITE_DONE) return false;
        throw std::runtime_error(std::string("sqlite step: ") + sqlite3_errmsg(db_));
    }
    void run() { step(); reset(); }
    void reset() { sqlite3_reset(stmt_); sqlite3_clear_bindings(stmt_); }

    bool is_null(int col) const { return sqlite3_column_type(stmt_, col) == SQLITE_NULL; }
    int64_t integer(int col) const { return sqlite3_column_int64(stmt_, col); }
    std::string text(int col) const {
        const unsigned char* p = sqlite3_column_text(stmt_, col);
        return p ? std::string(reinterpret_cast<const char*>(p), size_t(sqlite3_column_bytes(stmt_, col))) : std::string();
    }
    std::string blob(int col) const {
        const void* p = sqlite3_column_blob(stmt_, col);
        return p ? std::string(static_cast<const char*>(p), size_t(sqlite3_column_bytes(stmt_, col))) : std::string();
    }
    int columns() const { return sqlite3_column_count(stmt_); }
    std::string column_name(int col) const { return sqlite3_column_name(stmt_, col); }
    int column_type(int col) const { return sqlite3_column_type(stmt_, col); }

private:
    void check(int rc) const { if (rc != SQLITE_OK) throw std::runtime_error(std::string("sqlite bind: ") + sqlite3_errmsg(db_)); }
    sqlite3* db_;
    sqlite3_stmt* stmt_ = nullptr;
};

inline Stmt Db::prepare(const std::string& sql) { return Stmt(*this, sql); }

inline int64_t scalar(Db& db, const std::string& sql) {
    Stmt s = db.prepare(sql);
    return s.step() ? s.integer(0) : 0;
}

// Applies embedded migrations in order, verifying checksums of those already applied.
inline int migrate(Db& db) {
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, "
            "checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)");
    int applied = 0;
    for (size_t i = 0; i < embedded_migration_count; ++i) {
        const EmbeddedMigration& m = embedded_migrations[i];
        std::string sql(reinterpret_cast<const char*>(m.data), m.size);
        std::string checksum = sha256_hex(sql);
        Stmt find = db.prepare("SELECT checksum FROM schema_migrations WHERE version = ?1");
        find.bind(1, m.version);
        if (find.step()) {
            if (find.text(0) != checksum)
                throw std::runtime_error("migration " + std::string(m.name) + " was modified after being applied");
            continue;
        }
        db.transaction([&] {
            db.exec(sql);
            Stmt record = db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?1, ?2, ?3, ?4)");
            record.bind(1, m.version).bind(2, m.name).bind(3, checksum).bind(4, now_ms());
            record.run();
        });
        ++applied;
    }
    return applied;
}

inline int schema_version(Db& db) { return int(scalar(db, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations")); }

}  // namespace forge::cli
