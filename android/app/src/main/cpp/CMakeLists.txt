cmake_minimum_required(VERSION 3.22.1)
project(vocallab_audio LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(oboe REQUIRED CONFIG)

add_library(vocallab_audio SHARED
    vocallab_engine.cpp
)

target_compile_options(vocallab_audio PRIVATE -O3 -Wall -Wextra -Wno-unused-parameter)

target_link_libraries(vocallab_audio
    PRIVATE
    oboe::oboe
    log
)
