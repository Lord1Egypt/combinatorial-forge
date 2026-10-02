cmake_minimum_required(VERSION 3.16)
project(combinatorial_forge VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
option(FORGE_WARNINGS_AS_ERRORS "Treat compiler warnings as errors" ON)
option(FORGE_SANITIZERS "Enable address and undefined behavior sanitizers" OFF)

find_package(Threads REQUIRED)
foreach(target IN ITEMS queens_recursive queens_iterative tictactoe eight_puzzle lights_out)
  if(target MATCHES "^queens_")
    add_executable(${target} src/nqueens/${target}.cpp)
  else()
    add_executable(${target} src/${target}/main.cpp)
  endif()
  target_link_libraries(${target} PRIVATE Threads::Threads)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /O2)
    if(FORGE_WARNINGS_AS_ERRORS)
      target_compile_options(${target} PRIVATE /WX)
    endif()
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -O3)
    if(FORGE_WARNINGS_AS_ERRORS)
      target_compile_options(${target} PRIVATE -Werror)
    endif()
    if(FORGE_SANITIZERS)
      target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer -O1)
      target_link_options(${target} PRIVATE -fsanitize=address,undefined)
    endif()
  endif()
endforeach()

enable_testing()
find_package(Python3 COMPONENTS Interpreter REQUIRED)
add_test(NAME smoke COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/smoke.py ${CMAKE_BINARY_DIR})

# ---------------------------------------------------------------------------------------------
# Distributed platform: shared engine, native CLI, engine tests. The five baseline solver
# targets above are intentionally untouched.
# ---------------------------------------------------------------------------------------------
execute_process(COMMAND git -C ${CMAKE_SOURCE_DIR} rev-parse --short=12 HEAD
                OUTPUT_VARIABLE FORGE_GIT_COMMIT OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
if(NOT FORGE_GIT_COMMIT)
  set(FORGE_GIT_COMMIT "unknown")
endif()

add_library(sqlite3_static STATIC third_party/sqlite/sqlite3.c)
target_include_directories(sqlite3_static PUBLIC third_party/sqlite)
target_compile_definitions(sqlite3_static PRIVATE SQLITE_THREADSAFE=1 SQLITE_OMIT_LOAD_EXTENSION SQLITE_DQS=0)
if(NOT MSVC)
  target_compile_options(sqlite3_static PRIVATE -O2 -w)
endif()
target_link_libraries(sqlite3_static PUBLIC Threads::Threads ${CMAKE_DL_LIBS})

file(GLOB FORGE_MIGRATIONS ${CMAKE_SOURCE_DIR}/database/migrations/*.sql)
set(FORGE_MIGRATIONS_CPP ${CMAKE_BINARY_DIR}/generated/migrations_data.cpp)
add_custom_command(
  OUTPUT ${FORGE_MIGRATIONS_CPP}
  COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_BINARY_DIR}/generated
  COMMAND ${CMAKE_COMMAND} -DMIGRATIONS_DIR=${CMAKE_SOURCE_DIR}/database/migrations -DOUTPUT=${FORGE_MIGRATIONS_CPP}
          -P ${CMAKE_SOURCE_DIR}/cmake_embed.cmake
  DEPENDS ${FORGE_MIGRATIONS} ${CMAKE_SOURCE_DIR}/cmake_embed.cmake
  COMMENT "Embedding SQL migrations")

function(forge_harden target)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /O2)
    if(FORGE_WARNINGS_AS_ERRORS)
      target_compile_options(${target} PRIVATE /WX)
    endif()
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -O3)
    if(FORGE_WARNINGS_AS_ERRORS)
      target_compile_options(${target} PRIVATE -Werror)
    endif()
    if(FORGE_SANITIZERS)
      target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer -O1)
      target_link_options(${target} PRIVATE -fsanitize=address,undefined)
    endif()
  endif()
endfunction()

add_executable(forge cli/forge.cpp ${FORGE_MIGRATIONS_CPP})
target_include_directories(forge PRIVATE engine cli)
target_compile_definitions(forge PRIVATE
  FORGE_SOURCE_COMMIT="${FORGE_GIT_COMMIT}"
  FORGE_COMPILER="${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}"
  FORGE_BUILD_TYPE="$<CONFIG>")
target_link_libraries(forge PRIVATE sqlite3_static Threads::Threads)
if(WIN32)
  target_link_libraries(forge PRIVATE ws2_32)
endif()
forge_harden(forge)

add_executable(engine_tests tests/engine_tests.cpp)
target_include_directories(engine_tests PRIVATE engine)
target_link_libraries(engine_tests PRIVATE Threads::Threads)
forge_harden(engine_tests)

add_test(NAME engine COMMAND engine_tests ${CMAKE_SOURCE_DIR})
add_test(NAME cli COMMAND ${Python3_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tests/cli_test.py $<TARGET_FILE:forge> ${CMAKE_SOURCE_DIR})
