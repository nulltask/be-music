// TinyUSB configuration: a full-speed device with one CDC serial port (commands and results) and one HID keyboard.
#ifndef TUSB_CONFIG_H
#define TUSB_CONFIG_H

// The Pico SDK defines CFG_TUSB_MCU and CFG_TUSB_OS for the board it builds for.
#ifndef CFG_TUSB_MCU
#error CFG_TUSB_MCU must be defined (build with the Pico SDK)
#endif

#ifndef CFG_TUSB_OS
#define CFG_TUSB_OS OPT_OS_PICO
#endif

#define CFG_TUD_ENABLED 1
#define CFG_TUSB_RHPORT0_MODE OPT_MODE_DEVICE
#define BOARD_TUD_RHPORT 0

#ifndef CFG_TUSB_MEM_SECTION
#define CFG_TUSB_MEM_SECTION
#endif
#ifndef CFG_TUSB_MEM_ALIGN
#define CFG_TUSB_MEM_ALIGN __attribute__((aligned(4)))
#endif

#define CFG_TUD_ENDPOINT0_SIZE 64

#define CFG_TUD_CDC 1
#define CFG_TUD_HID 1
#define CFG_TUD_MSC 0
#define CFG_TUD_MIDI 0
#define CFG_TUD_VENDOR 0

#define CFG_TUD_CDC_RX_BUFSIZE 256
#define CFG_TUD_CDC_TX_BUFSIZE 1024
#define CFG_TUD_CDC_EP_BUFSIZE 64

// A boot keyboard report: modifiers, a reserved byte and six key codes.
#define CFG_TUD_HID_EP_BUFSIZE 16

#endif
