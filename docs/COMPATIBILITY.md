# Compatibility: Yamaha receivers and LG webOS TVs

AV Overlay shows on-screen volume, audio and video format and per-app sound programs on a **rooted LG webOS TV**
paired with a **Yamaha network receiver** (RX-V, RX-A, RX-S, MusicCast) over eARC or ARC. This page lists which
Yamaha receivers and which LG TVs it is expected to work with.

**Only one combination is confirmed:** an LG OLED65C2PSC (C2, 2022 OLED) on webOS 11.2.0 with a Yamaha RX-V485
(Extended Control API 2.17, system version 1.91). Every other row is **expected**, not tested. If you try another
combination, please send a
[compatibility report](https://github.com/SammySco/webos-av-overlay/issues/new?template=compatibility_report.yml).

## Yamaha receivers

The overlay needs the receiver's JSON Extended Control API (`/YamahaExtendedControl/v1`) and its UDP event
subscription (port 41100), with Network Standby enabled. The older XML API (`/YamahaRemoteControl/ctrl`) is used only
to switch the receiver's front-panel volume scale between 0-97 and dB when you change the volume display on the setup
page. If a receiver lacks it, that one sync is skipped and logged; volume, the info bar and sound programs are
unaffected. Whether a model has eARC or only ARC is a separate question from this table.

### Check your receiver

```sh
curl http://RECEIVER_IP/YamahaExtendedControl/v1/system/getDeviceInfo
curl http://RECEIVER_IP/YamahaExtendedControl/v1/main/getSignalInfo
```

Both should return `"response_code":0`. `getDeviceInfo` includes `model_name`, `api_version` and `system_version`;
please include them in a compatibility report. The RX-V485 reports `"api_version":2.17`.

### Yamaha models

| Yamaha model | Series | Era | JSON API + UDP events | Volume-scale sync (XML) | Status with AV Overlay |
| --- | --- | --- | --- | --- | --- |
| Yamaha RX-V485 | RX-V "85" | 2018-2019 | Yes (API 2.17) | Yes | **Confirmed** |
| Yamaha RX-V585 | RX-V "85" | 2018-2019 | Yes | Yes | Expected to work |
| Yamaha RX-V685 | RX-V "85" | 2018-2019 | Yes | Yes | Expected to work |
| Yamaha RX-V785 | RX-V "85" | 2018-2019 | Yes | Yes | Expected to work |
| Yamaha RX-V483 | RX-V "83" | 2017 | Yes | Yes | Expected to work |
| Yamaha RX-V583 | RX-V "83" | 2017 | Yes | Yes | Expected to work |
| Yamaha RX-V683 | RX-V "83" | 2017 | Yes | Yes | Expected to work |
| Yamaha RX-V481 | RX-V "81" | 2016 | Yes | Yes | Expected to work |
| Yamaha RX-V581 | RX-V "81" | 2016 | Yes | Yes | Expected to work |
| Yamaha RX-V681 | RX-V "81" | 2016 | Yes | Yes | Expected to work |
| Yamaha RX-V781 | RX-V "81" | 2016 | Yes | Yes | Expected to work |
| Yamaha RX-A750 to RX-A3080 | Aventage | 2015-2019 | Yes | Yes | Expected to work (only the two end models are named in the source list) |
| Yamaha RX-S601 | Slimline RX-S | 2015-2018 | Yes | Yes | Expected to work |
| Yamaha RX-S602 | Slimline RX-S | 2015-2018 | Yes | Yes | Expected to work |
| Yamaha RX-V4A | RX-V "A" | 2020 onwards | Yes | No | Expected to work (no volume-scale sync) |
| Yamaha RX-V6A | RX-V "A" | 2020 onwards | Yes | No | Expected to work (no volume-scale sync) |
| Yamaha RX-A2A | Aventage "A" | 2021 onwards | Yes | No | Expected to work (no volume-scale sync) |
| Yamaha RX-A4A | Aventage "A" | 2021 onwards | Yes | No | Expected to work (no volume-scale sync) |
| Yamaha RX-A6A | Aventage "A" | 2021 onwards | Yes | No | Expected to work (no volume-scale sync) |
| Yamaha RX-A8A | Aventage "A" | 2021 onwards | Yes | No | Expected to work (no volume-scale sync) |
| Yamaha RX-300A | RX-300 | 2024 onwards | Yes | No | Expected to work (no volume-scale sync) |
| Yamaha RX-V381 | RX-V "80" entry | 2016-2019 | No | No | Not supported (no network control) |
| Yamaha RX-V383 | RX-V "80" entry | 2016-2019 | No | No | Not supported (no network control) |
| Yamaha RX-V385 | RX-V "80" entry | 2016-2019 | No | No | Not supported (no network control) |

"Expected" means the receiver is reported to offer those APIs; it has not been tested with this overlay. Also searched
as RXV485, RX V485 and so on: the model names above are written in full so they can be found.

## LG webOS TVs

LG compatibility depends on two things: the TV must run **webOS 4.0 or newer** (the app's minimum) and it must be
**rooted** with the [Homebrew Channel](https://www.webosbrew.org/). Rooting depends on the exact firmware, not the
model name, and LG has patched the known exploits on most recent firmware, so check your TV at
[CanI.RootMy.TV](https://cani.rootmy.tv) before you start. Rooting is not covered here and can void your warranty.
Any LG line (OLED, QNED, NanoCell, UHD) follows the same rule; the table lists OLED series names as examples.

| Model year | OLED series | webOS at launch | Meets webOS 4.0+ | Rooting (firmware-dependent) | Status with AV Overlay |
| --- | --- | --- | --- | --- | --- |
| 2022 | A2, B2, **C2**, G2, Z2 | 22 (7) | Yes | Latest firmware reported patched; works only on TVs still on a vulnerable version | **C2 confirmed** (OLED65C2PSC, webOS 11.2.0); others depend on firmware |
| 2021 | A1, B1, C1, G1, Z1 | 6 | Yes | Latest firmware reported patched | Depends on firmware |
| 2020 | BX, CX, GX, WX, ZX | 5 | Yes | Latest firmware reported patched | Depends on firmware |
| 2019 | B9, C9, E9, W9 | 4.5 | Yes | No patched 4.5 firmware reported yet | Expected to work once rooted |
| 2018 | B8, C8, E8, G8, W8 | 4.0 | Yes | webOS 4.0 not expected to be patched | Expected to work once rooted |
| 2023 | B3, C3, G3, Z3 | 23 (8) | Yes | RootMyTV never worked; no data found for newer methods | Unknown, check first |
| 2025 | B5, C5, G5 | 25 (10) | Yes | No data found | Unknown, check first |
| 2024 | B4, C4, G4, M4, Z4 | 24 (9) | Yes | All webOS 9 releases reported patched | Unlikely: not currently rootable |
| 2017 and earlier | all | 3.x and older | No | Not applicable | Not supported (below webOS 4.0) |

The rooting column summarises the webosbrew, RootMyTV, DejaVuln and faultmanager project notes as of August 2025 and
will age; the CanI.RootMy.TV result for your own TV is the one that counts.

## Reporting what works

Open a [compatibility report](https://github.com/SammySco/webos-av-overlay/issues/new?template=compatibility_report.yml)
with your TV model and webOS version, the receiver's `model_name`, `api_version` and `system_version`, and whether
the volume popup, info bar and sound programs worked. Confirmed combinations will be added to this page.
