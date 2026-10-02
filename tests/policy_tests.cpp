// Runs database/fixtures/verification_cases.json against the C++ verification policy.
#include <fstream>
#include <iostream>
#include <sstream>

#include "store.hpp"

int main(int argc, char** argv) {
    if (argc != 2) { std::cerr << "usage: policy_tests <repo-root>\n"; return 2; }
    std::ifstream in(std::string(argv[1]) + "/database/fixtures/verification_cases.json");
    std::stringstream text;
    text << in.rdbuf();
    forge::Json fixtures = forge::Json::parse(text.str());
    int failures = 0, cases = 0;
    for (const forge::Json& c : fixtures.at("cases").items()) {
        std::vector<forge::cli::Submission> subs;
        for (const forge::Json& s : c.at("submissions").items())
            subs.push_back({"id", s.at("worker").as_string(), s.at("hash").as_string(), s.at("trusted").as_bool()});
        forge::cli::Verdict v = forge::cli::decide(int(c.at("required").as_int()), subs);
        const std::string want_hash = c.at("expect").at("hash").is_null() ? "" : c.at("expect").at("hash").as_string();
        ++cases;
        if (v.status != c.at("expect").at("status").as_string() || v.hash != want_hash) {
            ++failures;
            std::cerr << "FAIL " << c.at("name").as_string() << ": got " << v.status << "/" << v.hash << "\n";
        }
    }
    std::cout << cases << " policy cases, " << failures << " failures\n";
    return failures ? 1 : 0;
}
