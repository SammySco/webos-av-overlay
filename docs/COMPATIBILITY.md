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

| Model Year | Series | Models | Status |
| --- | --- | --- | --- |
| 2024 onwards | RX-300 | Yamaha RX-300A | Expected to work (no volume-scale sync) |
| 2021 onwards | Aventage "A" | Yamaha RX-A2A | Expected to work (no volume-scale sync) |
| 2021 onwards | Aventage "A" | Yamaha RX-A4A | Expected to work (no volume-scale sync) |
| 2021 onwards | Aventage "A" | Yamaha RX-A6A | Expected to work (no volume-scale sync) |
| 2021 onwards | Aventage "A" | Yamaha RX-A8A | Expected to work (no volume-scale sync) |
| 2020 onwards | RX-V "A" | Yamaha RX-V4A | Expected to work (no volume-scale sync) |
| 2020 onwards | RX-V "A" | Yamaha RX-V6A | Expected to work (no volume-scale sync) |
| 2018-2019 | RX-V "85" | Yamaha RX-V485 | **Confirmed** (API 2.17) |
| 2018-2019 | RX-V "85" | Yamaha RX-V585 | Expected to work |
| 2018-2019 | RX-V "85" | Yamaha RX-V685 | Expected to work |
| 2018-2019 | RX-V "85" | Yamaha RX-V785 | Expected to work |
| 2017 | RX-V "83" | Yamaha RX-V483 | Expected to work |
| 2017 | RX-V "83" | Yamaha RX-V583 | Expected to work |
| 2017 | RX-V "83" | Yamaha RX-V683 | Expected to work |
| 2016 | RX-V "81" | Yamaha RX-V481 | Expected to work |
| 2016 | RX-V "81" | Yamaha RX-V581 | Expected to work |
| 2016 | RX-V "81" | Yamaha RX-V681 | Expected to work |
| 2016 | RX-V "81" | Yamaha RX-V781 | Expected to work |
| 2015-2019 | Aventage RX-A | Yamaha RX-A750 to RX-A3080 (only the end models are named in the source list) | Expected to work |
| 2015-2018 | Slimline RX-S | Yamaha RX-S601 | Expected to work |
| 2015-2018 | Slimline RX-S | Yamaha RX-S602 | Expected to work |
| 2016-2019 | RX-V "80" entry | Yamaha RX-V381 | Not supported (no network control) |
| 2016-2019 | RX-V "80" entry | Yamaha RX-V383 | Not supported (no network control) |
| 2016-2019 | RX-V "80" entry | Yamaha RX-V385 | Not supported (no network control) |

"Expected" means the receiver is reported to offer those APIs; it has not been tested with this overlay. Also searched
as RXV485, RX V485 and so on: the model names above are written in full so they can be found.

## LG webOS TVs

LG compatibility depends on two things: the TV must run **webOS 4.0 or newer** (the app's minimum) and it must be
**rooted** with the [Homebrew Channel](https://www.webosbrew.org/). Rooting depends on the exact firmware, not the
model name, and LG has patched the known exploits on most recent firmware, so check your TV at
[CanI.RootMy.TV](https://cani.rootmy.tv) before you start. Rooting is not covered here and can void your warranty.
Any LG line (OLED, QNED, NanoCell, UHD) follows the same rule; the table lists the OLED models as examples.

Model years map to webOS as follows: 2018 = webOS 4.0, 2019 = 4.5, 2020 = 5, 2021 = 6, 2022 = 22 (7), 2023 = 23 (8),
2024 = 24 (9), 2025 = 25 (10). Newer firmware can raise a TV above its launch version; the confirmed C2 now runs 11.2.0.

| Model Year | Series | Models | Status |
| --- | --- | --- | --- |
| 2025 | OLED B-series | LG B5 | Unknown, check first |
| 2025 | OLED C-series | LG C5 | Unknown, check first |
| 2025 | OLED G-series | LG G5 | Unknown, check first |
| 2024 | OLED B-series | LG B4 | Unlikely (webOS 9 reported patched) |
| 2024 | OLED C-series | LG C4 | Unlikely (webOS 9 reported patched) |
| 2024 | OLED G-series | LG G4 | Unlikely (webOS 9 reported patched) |
| 2024 | OLED M-series | LG M4 | Unlikely (webOS 9 reported patched) |
| 2024 | OLED Z-series | LG Z4 | Unlikely (webOS 9 reported patched) |
| 2023 | OLED B-series | LG B3 | Unknown, check first |
| 2023 | OLED C-series | LG C3 | Unknown, check first |
| 2023 | OLED G-series | LG G3 | Unknown, check first |
| 2023 | OLED Z-series | LG Z3 | Unknown, check first |
| 2022 | OLED A-series | LG A2 | Depends on firmware |
| 2022 | OLED B-series | LG B2 | Depends on firmware |
| 2022 | OLED C-series | LG C2 (OLED65C2PSC) | **Confirmed** (webOS 11.2.0) |
| 2022 | OLED G-series | LG G2 | Depends on firmware |
| 2022 | OLED Z-series | LG Z2 | Depends on firmware |
| 2021 | OLED A-series | LG A1 | Depends on firmware |
| 2021 | OLED B-series | LG B1 | Depends on firmware |
| 2021 | OLED C-series | LG C1 | Depends on firmware |
| 2021 | OLED G-series | LG G1 | Depends on firmware |
| 2021 | OLED Z-series | LG Z1 | Depends on firmware |
| 2020 | OLED B-series | LG BX | Depends on firmware |
| 2020 | OLED C-series | LG CX | Depends on firmware |
| 2020 | OLED G-series | LG GX | Depends on firmware |
| 2020 | OLED W-series | LG WX | Depends on firmware |
| 2020 | OLED Z-series | LG ZX | Depends on firmware |
| 2019 | OLED B-series | LG B9 | Expected to work once rooted |
| 2019 | OLED C-series | LG C9 | Expected to work once rooted |
| 2019 | OLED E-series | LG E9 | Expected to work once rooted |
| 2019 | OLED W-series | LG W9 | Expected to work once rooted |
| 2018 | OLED B-series | LG B8 | Expected to work once rooted |
| 2018 | OLED C-series | LG C8 | Expected to work once rooted |
| 2018 | OLED E-series | LG E8 | Expected to work once rooted |
| 2018 | OLED G-series | LG G8 | Expected to work once rooted |
| 2018 | OLED W-series | LG W8 | Expected to work once rooted |
| 2017 and earlier | All lines | All LG webOS TVs | Not supported (below webOS 4.0) |

The Status column summarises the webosbrew, RootMyTV, DejaVuln and faultmanager project notes as of August 2025 and
will age; the CanI.RootMy.TV result for your own TV is the one that counts.

## Reporting what works

Open a [compatibility report](https://github.com/SammySco/webos-av-overlay/issues/new?template=compatibility_report.yml)
with your TV model and webOS version, the receiver's `model_name`, `api_version` and `system_version`, and whether
the volume popup, info bar and sound programs worked. Confirmed combinations will be added to this page.
