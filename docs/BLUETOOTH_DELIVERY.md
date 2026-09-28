# Bluetooth delivery confirmation

The browser opens the device picker directly from the button click, then loads an authenticated image and checks its metadata against the connected panel. Unknown configuration packet formats and incompatible panels fail before image writes. The configuration parser also accepts the upstream legacy 65-byte Wi-Fi packet when it is the final packet.

Direct-write commands and acknowledgements use big-endian command words. Configuration lengths, sequence numbers and dimensions use little-endian integers. Every START, DATA and explicit END write must receive its matching application acknowledgement (an exact command echo or its high-bit variant). An ATT write response alone is not delivery confirmation. NACKs fail the operation.

Some firmware automatically responds to the final DATA with END (0x72), followed by refresh completion (0x73). The client accepts this only after all image bytes were sent and does not send a second END. Early notifications remain queued while ATT writes finish. A successful result has `refreshConfirmed: true` only after 0x73; a device refresh timeout (0x74), disconnect or missing confirmation is an error. This is confirmation reported by the device, not an independent visual inspection of the panel.

Image loading is bounded to 30 seconds; connection and each discovery operation to 10 seconds; the complete configuration request (including notification subscription and ATT write) to 5 seconds. START has a 10-second deadline. DATA, END and refresh completion each allow 90 seconds, following the upstream SDK's conservative budget for blocking panel writes. The UI remains busy while waiting for the refresh confirmation. It never automatically retries a partial upload.

Every exit removes notification/disconnect listeners and clears timers. Timed-out subscription and connection promises cannot initiate later commands; a connection that arrives late is disconnected. Browser Bluetooth operations themselves cannot be cancelled, so an already-issued ATT write may finish after timeout, but it cannot advance the transfer.

Protocol references: [OpenDisplay Python SDK](https://github.com/OpenDisplay/py-opendisplay) (`opendisplay/device.py`, `protocol/commands.py`, `protocol/responses.py`, `protocol/config_parser.py`) and [OpenDisplay firmware](https://github.com/OpenDisplay/Firmware) (`include/opendisplay_structs.h`). Tests use synthetic notifications and hanging browser promises; physical-panel testing still requires hardware.
