// Small JSON value with a strict parser and a canonical serializer.
// Canonical form: object keys sorted bytewise, no whitespace, integers only (no floats),
// so the same document hashes identically in C++ and in the TypeScript server.
#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge {

class Json {
public:
    enum class Type { Null, Bool, Int, String, Array, Object };
    using Array = std::vector<Json>;
    using Object = std::map<std::string, Json>;

    Json() = default;
    Json(std::nullptr_t) {}
    Json(bool v) : type_(Type::Bool), int_(v) {}
    Json(int v) : type_(Type::Int), int_(v) {}
    Json(unsigned v) : type_(Type::Int), int_(v) {}
    Json(long v) : type_(Type::Int), int_(v) {}
    Json(long long v) : type_(Type::Int), int_(v) {}
    Json(unsigned long v) : type_(Type::Int), int_(int64_t(v)) {}
    Json(unsigned long long v) : type_(Type::Int), int_(int64_t(v)) {}
    Json(const char* v) : type_(Type::String), str_(v) {}
    Json(std::string v) : type_(Type::String), str_(std::move(v)) {}
    Json(Array v) : type_(Type::Array), arr_(std::make_shared<Array>(std::move(v))) {}
    Json(Object v) : type_(Type::Object), obj_(std::make_shared<Object>(std::move(v))) {}
    static Json array() { return Json(Array{}); }
    static Json object() { return Json(Object{}); }

    Type type() const { return type_; }
    bool is_null() const { return type_ == Type::Null; }
    bool is_object() const { return type_ == Type::Object; }
    bool is_array() const { return type_ == Type::Array; }
    bool is_string() const { return type_ == Type::String; }
    bool is_int() const { return type_ == Type::Int; }
    bool is_bool() const { return type_ == Type::Bool; }

    int64_t as_int() const { need(Type::Int, "integer"); return int_; }
    bool as_bool() const { need(Type::Bool, "boolean"); return int_ != 0; }
    const std::string& as_string() const { need(Type::String, "string"); return str_; }
    const Array& items() const { need(Type::Array, "array"); return *arr_; }
    const Object& members() const { need(Type::Object, "object"); return *obj_; }

    void push(Json v) { need(Type::Array, "array"); detach_array(); arr_->push_back(std::move(v)); }
    void set(const std::string& key, Json v) {
        need(Type::Object, "object"); detach_object(); (*obj_)[key] = std::move(v);
    }
    bool has(const std::string& key) const {
        return type_ == Type::Object && obj_->count(key) != 0;
    }
    const Json& at(const std::string& key) const {
        need(Type::Object, "object");
        auto it = obj_->find(key);
        if (it == obj_->end()) throw std::invalid_argument("missing field: " + key);
        return it->second;
    }
    // Returns null Json when the key is absent.
    Json get(const std::string& key) const {
        if (!has(key)) return Json();
        return obj_->at(key);
    }

    std::string dump() const { std::string out; write(out); return out; }
    // `lenient_numbers` accepts fractions/exponents and truncates them to integers; it is for
    // reading result files with timing fields, never for hashed documents.
    static Json parse(const std::string& text, bool lenient_numbers = false) {
        Parser parser{text, 0, 0, lenient_numbers};
        Json value = parser.value();
        parser.space();
        if (parser.pos != text.size()) throw std::invalid_argument("trailing characters in JSON");
        return value;
    }

private:
    void need(Type t, const char* name) const {
        if (type_ != t) throw std::invalid_argument(std::string("expected JSON ") + name);
    }
    void detach_array() { if (arr_.use_count() > 1) arr_ = std::make_shared<Array>(*arr_); }
    void detach_object() { if (obj_.use_count() > 1) obj_ = std::make_shared<Object>(*obj_); }

    static void quote(std::string& out, const std::string& text) {
        static const char* hex = "0123456789abcdef";
        out += '"';
        for (unsigned char c : text) {
            switch (c) {
                case '"': out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\b': out += "\\b"; break;
                case '\f': out += "\\f"; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default:
                    if (c < 0x20) { out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15]; }
                    else out += char(c);
            }
        }
        out += '"';
    }
    void write(std::string& out) const {
        switch (type_) {
            case Type::Null: out += "null"; break;
            case Type::Bool: out += int_ ? "true" : "false"; break;
            case Type::Int: out += std::to_string(int_); break;
            case Type::String: quote(out, str_); break;
            case Type::Array: {
                out += '[';
                bool first = true;
                for (const Json& item : *arr_) { if (!first) out += ','; first = false; item.write(out); }
                out += ']';
                break;
            }
            case Type::Object: {
                out += '{';
                bool first = true;
                for (const auto& [key, value] : *obj_) {
                    if (!first) out += ',';
                    first = false;
                    quote(out, key); out += ':'; value.write(out);
                }
                out += '}';
                break;
            }
        }
    }

    struct Parser {
        const std::string& s;
        size_t pos;
        int depth;
        bool lenient;
        void space() { while (pos < s.size() && (s[pos]==' '||s[pos]=='\n'||s[pos]=='\r'||s[pos]=='\t')) ++pos; }
        [[noreturn]] void fail(const char* what) const { throw std::invalid_argument(std::string("JSON: ") + what); }
        char peek() { space(); if (pos >= s.size()) fail("unexpected end"); return s[pos]; }
        void expect(char c) { if (peek() != c) fail("unexpected character"); ++pos; }
        bool literal(const char* word) {
            size_t n = std::char_traits<char>::length(word);
            if (s.compare(pos, n, word) == 0) { pos += n; return true; }
            return false;
        }
        Json value() {
            if (++depth > 64) fail("nesting too deep");
            Json out = value_inner();
            --depth;
            return out;
        }
        Json value_inner() {
            char c = peek();
            if (c == '{') {
                ++pos; Json obj = Json::object();
                if (peek() == '}') { ++pos; return obj; }
                for (;;) {
                    if (peek() != '"') fail("object key must be a string");
                    std::string key = string();
                    expect(':');
                    obj.set(key, value());
                    char next = peek(); ++pos;
                    if (next == '}') return obj;
                    if (next != ',') fail("expected , or }");
                }
            }
            if (c == '[') {
                ++pos; Json arr = Json::array();
                if (peek() == ']') { ++pos; return arr; }
                for (;;) {
                    arr.push(value());
                    char next = peek(); ++pos;
                    if (next == ']') return arr;
                    if (next != ',') fail("expected , or ]");
                }
            }
            if (c == '"') return Json(string());
            if (literal("true")) return Json(true);
            if (literal("false")) return Json(false);
            if (literal("null")) return Json();
            return number();
        }
        Json number() {
            size_t start = pos;
            bool negative = false;
            if (pos < s.size() && s[pos] == '-') { negative = true; ++pos; }
            if (pos >= s.size() || s[pos] < '0' || s[pos] > '9') fail("invalid number");
            if (s[pos] == '0' && pos + 1 < s.size() && s[pos+1] >= '0' && s[pos+1] <= '9') fail("leading zero");
            uint64_t magnitude = 0;
            while (pos < s.size() && s[pos] >= '0' && s[pos] <= '9') {
                unsigned digit = unsigned(s[pos] - '0');
                if (magnitude > (UINT64_MAX - digit) / 10) fail("integer overflow");
                magnitude = magnitude * 10 + digit; ++pos;
            }
            if (pos < s.size() && (s[pos]=='.'||s[pos]=='e'||s[pos]=='E')) {
                if (!lenient) fail("floating-point numbers are not supported");
                while (pos < s.size() && (s[pos]=='.'||s[pos]=='e'||s[pos]=='E'||s[pos]=='+'||s[pos]=='-'||(s[pos]>='0'&&s[pos]<='9'))) ++pos;
            }
            if (negative ? magnitude > uint64_t(INT64_MAX) + 1 : magnitude > uint64_t(INT64_MAX)) fail("integer out of range");
            (void)start;
            return Json(negative ? int64_t(0 - magnitude) : int64_t(magnitude));
        }
        std::string string() {
            expect('"');
            std::string out;
            for (;;) {
                if (pos >= s.size()) fail("unterminated string");
                unsigned char c = (unsigned char)s[pos++];
                if (c == '"') return out;
                if (c < 0x20) fail("control character in string");
                if (c != '\\') { out += char(c); continue; }
                if (pos >= s.size()) fail("bad escape");
                char e = s[pos++];
                switch (e) {
                    case '"': out += '"'; break; case '\\': out += '\\'; break; case '/': out += '/'; break;
                    case 'b': out += '\b'; break; case 'f': out += '\f'; break;
                    case 'n': out += '\n'; break; case 'r': out += '\r'; break; case 't': out += '\t'; break;
                    case 'u': {
                        if (pos + 4 > s.size()) fail("bad unicode escape");
                        unsigned code = 0;
                        for (int i = 0; i < 4; ++i) {
                            char h = s[pos++]; code <<= 4;
                            if (h >= '0' && h <= '9') code |= unsigned(h - '0');
                            else if (h >= 'a' && h <= 'f') code |= unsigned(h - 'a' + 10);
                            else if (h >= 'A' && h <= 'F') code |= unsigned(h - 'A' + 10);
                            else fail("bad unicode escape");
                        }
                        if (code >= 0xD800 && code <= 0xDFFF) fail("surrogate escapes are not supported");
                        if (code < 0x80) out += char(code);
                        else if (code < 0x800) { out += char(0xC0 | (code >> 6)); out += char(0x80 | (code & 0x3F)); }
                        else { out += char(0xE0 | (code >> 12)); out += char(0x80 | ((code >> 6) & 0x3F)); out += char(0x80 | (code & 0x3F)); }
                        break;
                    }
                    default: fail("bad escape");
                }
            }
        }
    };

    Type type_ = Type::Null;
    int64_t int_ = 0;
    std::string str_;
    std::shared_ptr<Array> arr_;
    std::shared_ptr<Object> obj_;
};

}  // namespace forge
