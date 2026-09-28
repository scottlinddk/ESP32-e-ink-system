# E-paper project comparison — 28 September 2026

This comparison starts with [the supplied Reddit post](https://www.reddit.com/r/eink/comments/1wrdyhm/a_little_shoutout_to_some_great_opensource_epaper/), its linked [paperlesspaper article](https://paperlesspaper.de/en/blog/open-source-eink-projekte), and the project suggestions in the comments. The original repository baseline is `fa2a797`. Existing local Raspberry Pi database work was excluded and preserved.

## Projects reviewed

| Project | Verified capabilities and transferable ideas | Sources |
|---|---|---|
| OpenDisplay | Open BLE firmware/protocol, hardware interrogation, image conversion/rotation, multiple encodings and device-dependent partial updates. This app already used direct-write commands, but lacked capability checks. | [SDK and protocol](https://github.com/OpenDisplay/py-opendisplay), [firmware structures](https://github.com/OpenDisplay/Firmware/blob/main/include/opendisplay_structs.h) |
| Tesserae | Browser page composition, calendars, RSS and Home Assistant widgets, scheduled rotation, quiet hours and multiple device transports. Its client contract uses individual tokens, frame polling, ETags and telemetry. | [Architecture](https://docs.tesserae.ink/dev/architecture/), [widget gallery](https://docs.tesserae.ink/widgets/gallery/), [client protocol](https://docs.tesserae.ink/dev/client-protocol/), [devices](https://docs.tesserae.ink/install/devices/) |
| OpenEPaperLink | Reuses electronic shelf labels through an access point. Image uploads, JSON drawing templates, fonts and external calendar adapters are reusable ideas. RF firmware is a separate hardware ecosystem. | [Maintained wiki](https://github.com/OpenEPaperLink/OpenEPaperLink/wiki), [image upload](https://github.com/OpenEPaperLink/OpenEPaperLink/wiki/Image-upload), [templates](https://github.com/OpenEPaperLink/OpenEPaperLink/wiki/Json-template), [calendar](https://github.com/OpenEPaperLink/OpenEPaperLink/wiki/ICS-calendar) |
| Inkplate | Open boards/library, including an 800×600 panel, grayscale, partial refresh, network connectivity, SD images and calendar/picture-frame examples. | [Inkplate 6](https://www.crowdsupply.com/soldered/inkplate-6), [official Arduino library](https://github.com/SolderedElectronics/Inkplate-Arduino-library) |
| TRMNL | Separate open firmware/BYOS, self-hosted Terminus playlists, shared plugins/recipes and local preview tooling. These do not imply the entire commercial service or hardware is open. | [Organization guide](https://github.com/usetrmnl), [plugins](https://github.com/usetrmnl/plugins), [Terminus](https://github.com/usetrmnl/terminus), [TRMNLP](https://github.com/usetrmnl/trmnlp), [firmware API](https://github.com/usetrmnl/trmnl-firmware#web-server-endpoints) |
| The Open Book | A DIY reader with UTF-8 text, wrapping, navigation and persisted reading progress. Babel/Unifont demonstrates why readable international text matters. The creator describes software as pre-alpha. | [Repository](https://github.com/joeycastillo/The-Open-Book), [creator documentation](https://www.oddlyspecificobjects.com/projects/openbook/) |
| Modos / Glider | FPGA display controller, grayscale modes, regional updates and dithering, with monitor video inputs. Image conversion is transferable; monitor latency is not an application setting. | [Glider features](https://github.com/Modos-Labs/Glider#features) |
| EPDiy | ESP32/S3 controller for multiple bare e-reader panels, grayscale, framebuffer/update modes and power control. Supports separating panel geometry from transport/driver implementation. | [Repository](https://github.com/vroland/epdiy), [API](https://epdiy.readthedocs.io/en/latest/api.html) |
| epdInky | ESP32-P4/C6 board with PSRAM, microSD, orientation sensor, RTC and fuel gauge. Examples use FastEPD; EPDiy support is described as forthcoming. | [Repository](https://github.com/ddB0515/epdInky) |
| Martin Fasani boards | Prebuilt EPDiy and related controllers, large panels and image-download examples. These overlap EPDiy's software lessons; purchasing a board is not an app feature. | [Store](https://www.tindie.com/stores/fasani/), [manufacturer projects](https://fasani.de/category/language-en/), [board datasheet](https://d3s5r33r268y59.cloudfront.net/datasheets/31247/2024-04-26-06-49-48/epdiy_features.pdf) |
| Silk Screen Reader (formerly de-link) | ESP32-S3 reader PCB with display connector, buttons, microSD and optional touch/frontlight. Its repository says the revision is untested and firmware is closed beta without a release. The linked website could not be loaded; the canonical repository supplies the evidence. | [Repository](https://github.com/iandchasse/silkscreen-pcb) |

The article's author also describes their own OpenPaper frames. That is useful context for image/frame workflows, rather than an additional requirement to clone their product or cloud service.

## Feature backlog and implementation plans

Each linked issue contains the problem, primary sources, implementation steps, acceptance criteria and testing scope. The list groups portable capabilities into independently reviewable changes; it does not equate every service in a competitor's integration catalog with a required clone.

| Issue | Missing capability at baseline | Delivery boundary |
|---|---|---|
| [#97](https://github.com/scottlinddk/ESP32-e-ink-system/issues/97) | Panel dimensions, rotation and transfer compatibility | Validated monochrome profiles; dynamic BMP/raw rendering; connected-device checks. No new physical panel driver. |
| [#98](https://github.com/scottlinddk/ESP32-e-ink-system/issues/98) | Readable Danish/Latin characters and punctuation | Explicit bitmap glyph coverage, NFC normalization and code-point wrapping. Not universal script shaping. |
| [#99](https://github.com/scottlinddk/ESP32-e-ink-system/issues/99) | Personal notes and photos | Local image upload, bounded decoding, threshold/error diffusion, fit controls and real text/image widgets. |
| [#100](https://github.com/scottlinddk/ESP32-e-ink-system/issues/100) | RSS/Atom news selection | Safe bounded feeds connected to the active pipeline, preserving NewsAPI. |
| [#101](https://github.com/scottlinddk/ESP32-e-ink-system/issues/101) | Calendar agenda | Encrypted ICS feed URL, recurrence/timezone/all-day handling. Deliberately reintroduces ICS after migration007 removed the old calendar/OAuth code. |
| [#102](https://github.com/scottlinddk/ESP32-e-ink-system/issues/102) | Home Assistant and custom sensor data | Scoped authenticated push webhook and freshness-aware rows; no hosted-server access to a private LAN is needed. |
| [#103](https://github.com/scottlinddk/ESP32-e-ink-system/issues/103) | Actual unsaved-layout preview | Read-only live render endpoint and cancellable editor preview. |
| [#104](https://github.com/scottlinddk/ESP32-e-ink-system/issues/104) | Multiple pages and schedules | Named layouts, deterministic rotation and timezone-aware quiet windows. |
| [#105](https://github.com/scottlinddk/ESP32-e-ink-system/issues/105) | Unattended delivery and reported device health | Revocable device tokens, frame polling/ETags, heartbeats and a reference polling bridge. |
| [#106](https://github.com/scottlinddk/ESP32-e-ink-system/issues/106) | Portable configuration recipes | Versioned, validated non-secret export/import, review before applying and starter layouts. |

The repository already had a widget registry, encrypted provider credentials, six data sources, a layout editor and BMP previews. Those were reused rather than counted as missing. Unrelated account/billing placeholders and unfinished Raspberry Pi changes are outside this feature comparison.

## Hardware and validation limits

FPGA video/monitor modes, panel waveforms, grayscale/color controller support, touch, frontlights, physical buttons, storage sockets, battery electronics and accelerometers need suitable boards and drivers. They are researched here but are not represented as completed application features. Partial updates also need positive capability detection and previous-frame state; full refresh remains the default.

The maintained OpenDisplay SDK documents direct-write truncation when panel width is not divisible by eight. The browser sender rejects these widths, including the legacy 250-pixel profile, before image writes; BMP export remains available. It also verifies a single monochrome panel's native dimensions and uses the documented big-endian command headers. This replaces an unsafe assumption in the original helper. Encrypted or unknown configurations fail closed; use a compatible authenticated client rather than disabling device security.

Software tests cover rendering, contracts, authorization, parsing and scheduling. They do not verify physical refresh, ghosting, battery life, or the availability of a user's third-party credentials. Database migrations must be applied before activating the new persisted settings.
