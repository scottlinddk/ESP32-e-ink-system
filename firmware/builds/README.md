# Firmware Builds

Place compiled firmware binaries here. The backend serves this directory at `/firmware/`.

## Building the default firmware

1. Copy `config.h.example` to `config.h` and fill in your values:
   ```
   cp firmware/config.h.example firmware/config.h
   ```

2. Install [PlatformIO](https://platformio.org/install):
   ```
   pip install platformio
   ```

3. Build and copy the binary:
   ```
   cd firmware
   pio run -e esp32dev
   cp .pio/build/esp32dev/firmware.bin builds/default.bin
   ```

The backend will serve `default.bin` at `/firmware/default.bin` and the flash page will automatically use it.

## Version

To set the version shown in the UI, set `DEFAULT_FIRMWARE_VERSION` in the backend `.env` file.
