# The latency jig's firmware for the Raspberry Pi Pico (PICO_BOARD=pico) and Pico 2 (PICO_BOARD=pico2).
# Build with the Pico SDK: docs/latency-jig.md, "Building the firmware".
cmake_minimum_required(VERSION 3.13)

if(NOT DEFINED PICO_SDK_PATH AND DEFINED ENV{PICO_SDK_PATH})
  set(PICO_SDK_PATH $ENV{PICO_SDK_PATH})
endif()
if(NOT DEFINED PICO_SDK_PATH)
  message(FATAL_ERROR "Set PICO_SDK_PATH to a Pico SDK checkout (with its submodules).")
endif()
include(${PICO_SDK_PATH}/external/pico_sdk_import.cmake)

project(latency_jig C CXX ASM)
set(CMAKE_C_STANDARD 11)
pico_sdk_init()

add_executable(latency_jig src/main.c src/usb_descriptors.c src/jig_core.c)
target_include_directories(latency_jig PRIVATE ${CMAKE_CURRENT_LIST_DIR}/src)
target_compile_options(latency_jig PRIVATE -Wall -Wextra)
target_link_libraries(latency_jig PRIVATE pico_stdlib hardware_adc tinyusb_device)

# TinyUSB here serves the jig's own descriptors (serial + keyboard), so the SDK's USB stdio stays off.
pico_enable_stdio_usb(latency_jig 0)
pico_enable_stdio_uart(latency_jig 0)
pico_add_extra_outputs(latency_jig)
