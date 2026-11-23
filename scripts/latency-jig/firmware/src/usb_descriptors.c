// USB descriptors: a composite device (CDC serial + HID keyboard). The keyboard's endpoint is polled every 1 ms, the
// shortest interval a full-speed device can ask for.
#include <string.h>

#include "tusb.h"

// A development VID/PID pair (TinyUSB's examples use 0xCAFE); the jig is a bench tool, not a product.
#define USB_VID 0xCAFE
#define USB_PID 0x4C50
#define USB_BCD 0x0200

enum {
  ITF_NUM_CDC = 0,
  ITF_NUM_CDC_DATA,
  ITF_NUM_HID,
  ITF_NUM_TOTAL,
};

#define EPNUM_CDC_NOTIF 0x81
#define EPNUM_CDC_OUT 0x02
#define EPNUM_CDC_IN 0x82
#define EPNUM_HID 0x83

#define CONFIG_TOTAL_LEN (TUD_CONFIG_DESC_LEN + TUD_CDC_DESC_LEN + TUD_HID_DESC_LEN)

static tusb_desc_device_t const desc_device = {
    .bLength = sizeof(tusb_desc_device_t),
    .bDescriptorType = TUSB_DESC_DEVICE,
    .bcdUSB = USB_BCD,
    // An interface association descriptor groups the CDC interfaces.
    .bDeviceClass = TUSB_CLASS_MISC,
    .bDeviceSubClass = MISC_SUBCLASS_COMMON,
    .bDeviceProtocol = MISC_PROTOCOL_IAD,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor = USB_VID,
    .idProduct = USB_PID,
    .bcdDevice = 0x0100,
    .iManufacturer = 0x01,
    .iProduct = 0x02,
    .iSerialNumber = 0x03,
    .bNumConfigurations = 0x01,
};

uint8_t const *tud_descriptor_device_cb(void) { return (uint8_t const *)&desc_device; }

static uint8_t const desc_hid_report[] = {TUD_HID_REPORT_DESC_KEYBOARD()};

uint8_t const *tud_hid_descriptor_report_cb(uint8_t instance) {
  (void)instance;
  return desc_hid_report;
}

static uint8_t const desc_configuration[] = {
    TUD_CONFIG_DESCRIPTOR(1, ITF_NUM_TOTAL, 0, CONFIG_TOTAL_LEN, 0x00, 100),
    TUD_CDC_DESCRIPTOR(ITF_NUM_CDC, 4, EPNUM_CDC_NOTIF, 8, EPNUM_CDC_OUT, EPNUM_CDC_IN, 64),
    TUD_HID_DESCRIPTOR(ITF_NUM_HID, 5, HID_ITF_PROTOCOL_KEYBOARD, sizeof(desc_hid_report), EPNUM_HID,
                       CFG_TUD_HID_EP_BUFSIZE, 1),
};

uint8_t const *tud_descriptor_configuration_cb(uint8_t index) {
  (void)index;
  return desc_configuration;
}

static char const *const string_desc_arr[] = {
    (const char[]){0x09, 0x04},  // 0: English (0x0409)
    "Be-Music",                  // 1: Manufacturer
    "Latency Jig",               // 2: Product
    "0001",                      // 3: Serial
    "Latency Jig Serial",        // 4: CDC interface
    "Latency Jig Keyboard",      // 5: HID interface
};

static uint16_t desc_str[32 + 1];

uint16_t const *tud_descriptor_string_cb(uint8_t index, uint16_t langid) {
  (void)langid;
  size_t count;
  if (index == 0) {
    memcpy(&desc_str[1], string_desc_arr[0], 2);
    count = 1;
  } else {
    if (index >= sizeof(string_desc_arr) / sizeof(string_desc_arr[0])) return NULL;
    const char *text = string_desc_arr[index];
    count = strlen(text);
    if (count > 32) count = 32;
    for (size_t i = 0; i < count; i++) desc_str[1 + i] = (uint16_t)text[i];
  }
  desc_str[0] = (uint16_t)((TUSB_DESC_STRING << 8) | (2 * count + 2));
  return desc_str;
}
