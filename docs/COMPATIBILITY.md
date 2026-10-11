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

<table width="100%">
  <thead>
    <tr>
      <th align="left" width="13%">Model Year</th>
      <th align="left" width="19%">Series</th>
      <th align="left" width="38%">Models</th>
      <th align="left" width="30%">Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>2024 onwards</td>
      <td>RX-300</td>
      <td>Yamaha RX-300A</td>
      <td>Expected to work (no volume-scale sync)</td>
    </tr>
    <tr>
      <td>2021 onwards</td>
      <td>Aventage "A"</td>
      <td>Yamaha RX-A2A</td>
      <td>Expected to work (no volume-scale sync)</td>
    </tr>
    <tr>
      <td>2021 onwards</td>
      <td>Aventage "A"</td>
      <td>Yamaha RX-A4A</td>
      <td>Expected to work (no volume-scale sync)</td>
    </tr>
    <tr>
      <td>2021 onwards</td>
      <td>Aventage "A"</td>
      <td>Yamaha RX-A6A</td>
      <td>Expected to work (no volume-scale sync)</td>
    </tr>
    <tr>
      <td>2021 onwards</td>
      <td>Aventage "A"</td>
      <td>Yamaha RX-A8A</td>
      <td>Expected to work (no volume-scale sync)</td>
    </tr>
    <tr>
      <td>2020 onwards</td>
      <td>RX-V "A"</td>
      <td>Yamaha RX-V4A</td>
      <td>Expected to work (no volume-scale sync)</td>
    </tr>
    <tr>
      <td>2020 onwards</td>
      <td>RX-V "A"</td>
      <td>Yamaha RX-V6A</td>
      <td>Expected to work (no volume-scale sync)</td>
    </tr>
    <tr>
      <td>2018-2019</td>
      <td>RX-V "85"</td>
      <td>Yamaha RX-V485</td>
      <td><b>Confirmed</b> (API 2.17)</td>
    </tr>
    <tr>
      <td>2018-2019</td>
      <td>RX-V "85"</td>
      <td>Yamaha RX-V585</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2018-2019</td>
      <td>RX-V "85"</td>
      <td>Yamaha RX-V685</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2018-2019</td>
      <td>RX-V "85"</td>
      <td>Yamaha RX-V785</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2017</td>
      <td>RX-V "83"</td>
      <td>Yamaha RX-V483</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2017</td>
      <td>RX-V "83"</td>
      <td>Yamaha RX-V583</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2017</td>
      <td>RX-V "83"</td>
      <td>Yamaha RX-V683</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2016</td>
      <td>RX-V "81"</td>
      <td>Yamaha RX-V481</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2016</td>
      <td>RX-V "81"</td>
      <td>Yamaha RX-V581</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2016</td>
      <td>RX-V "81"</td>
      <td>Yamaha RX-V681</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2016</td>
      <td>RX-V "81"</td>
      <td>Yamaha RX-V781</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2015-2019</td>
      <td>Aventage RX-A</td>
      <td>Yamaha RX-A750 to RX-A3080 (only the end models are named in the source list)</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2015-2018</td>
      <td>Slimline RX-S</td>
      <td>Yamaha RX-S601</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2015-2018</td>
      <td>Slimline RX-S</td>
      <td>Yamaha RX-S602</td>
      <td>Expected to work</td>
    </tr>
    <tr>
      <td>2016-2019</td>
      <td>RX-V "80" entry</td>
      <td>Yamaha RX-V381</td>
      <td>Not supported (no network control)</td>
    </tr>
    <tr>
      <td>2016-2019</td>
      <td>RX-V "80" entry</td>
      <td>Yamaha RX-V383</td>
      <td>Not supported (no network control)</td>
    </tr>
    <tr>
      <td>2016-2019</td>
      <td>RX-V "80" entry</td>
      <td>Yamaha RX-V385</td>
      <td>Not supported (no network control)</td>
    </tr>
  </tbody>
</table>

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

<table width="100%">
  <thead>
    <tr>
      <th align="left" width="13%">Model Year</th>
      <th align="left" width="19%">Series</th>
      <th align="left" width="38%">Models</th>
      <th align="left" width="30%">Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>2025</td>
      <td>OLED B-series</td>
      <td>LG B5</td>
      <td>Unknown, check first</td>
    </tr>
    <tr>
      <td>2025</td>
      <td>OLED C-series</td>
      <td>LG C5</td>
      <td>Unknown, check first</td>
    </tr>
    <tr>
      <td>2025</td>
      <td>OLED G-series</td>
      <td>LG G5</td>
      <td>Unknown, check first</td>
    </tr>
    <tr>
      <td>2024</td>
      <td>OLED B-series</td>
      <td>LG B4</td>
      <td>Unlikely (webOS 9 reported patched)</td>
    </tr>
    <tr>
      <td>2024</td>
      <td>OLED C-series</td>
      <td>LG C4</td>
      <td>Unlikely (webOS 9 reported patched)</td>
    </tr>
    <tr>
      <td>2024</td>
      <td>OLED G-series</td>
      <td>LG G4</td>
      <td>Unlikely (webOS 9 reported patched)</td>
    </tr>
    <tr>
      <td>2024</td>
      <td>OLED M-series</td>
      <td>LG M4</td>
      <td>Unlikely (webOS 9 reported patched)</td>
    </tr>
    <tr>
      <td>2024</td>
      <td>OLED Z-series</td>
      <td>LG Z4</td>
      <td>Unlikely (webOS 9 reported patched)</td>
    </tr>
    <tr>
      <td>2023</td>
      <td>OLED B-series</td>
      <td>LG B3</td>
      <td>Unknown, check first</td>
    </tr>
    <tr>
      <td>2023</td>
      <td>OLED C-series</td>
      <td>LG C3</td>
      <td>Unknown, check first</td>
    </tr>
    <tr>
      <td>2023</td>
      <td>OLED G-series</td>
      <td>LG G3</td>
      <td>Unknown, check first</td>
    </tr>
    <tr>
      <td>2023</td>
      <td>OLED Z-series</td>
      <td>LG Z3</td>
      <td>Unknown, check first</td>
    </tr>
    <tr>
      <td>2022</td>
      <td>OLED A-series</td>
      <td>LG A2</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2022</td>
      <td>OLED B-series</td>
      <td>LG B2</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2022</td>
      <td>OLED C-series</td>
      <td>LG C2 (OLED65C2PSC)</td>
      <td><b>Confirmed</b> (webOS 11.2.0)</td>
    </tr>
    <tr>
      <td>2022</td>
      <td>OLED G-series</td>
      <td>LG G2</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2022</td>
      <td>OLED Z-series</td>
      <td>LG Z2</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2021</td>
      <td>OLED A-series</td>
      <td>LG A1</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2021</td>
      <td>OLED B-series</td>
      <td>LG B1</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2021</td>
      <td>OLED C-series</td>
      <td>LG C1</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2021</td>
      <td>OLED G-series</td>
      <td>LG G1</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2021</td>
      <td>OLED Z-series</td>
      <td>LG Z1</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2020</td>
      <td>OLED B-series</td>
      <td>LG BX</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2020</td>
      <td>OLED C-series</td>
      <td>LG CX</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2020</td>
      <td>OLED G-series</td>
      <td>LG GX</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2020</td>
      <td>OLED W-series</td>
      <td>LG WX</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2020</td>
      <td>OLED Z-series</td>
      <td>LG ZX</td>
      <td>Depends on firmware</td>
    </tr>
    <tr>
      <td>2019</td>
      <td>OLED B-series</td>
      <td>LG B9</td>
      <td>Expected to work once rooted</td>
    </tr>
    <tr>
      <td>2019</td>
      <td>OLED C-series</td>
      <td>LG C9</td>
      <td>Expected to work once rooted</td>
    </tr>
    <tr>
      <td>2019</td>
      <td>OLED E-series</td>
      <td>LG E9</td>
      <td>Expected to work once rooted</td>
    </tr>
    <tr>
      <td>2019</td>
      <td>OLED W-series</td>
      <td>LG W9</td>
      <td>Expected to work once rooted</td>
    </tr>
    <tr>
      <td>2018</td>
      <td>OLED B-series</td>
      <td>LG B8</td>
      <td>Expected to work once rooted</td>
    </tr>
    <tr>
      <td>2018</td>
      <td>OLED C-series</td>
      <td>LG C8</td>
      <td>Expected to work once rooted</td>
    </tr>
    <tr>
      <td>2018</td>
      <td>OLED E-series</td>
      <td>LG E8</td>
      <td>Expected to work once rooted</td>
    </tr>
    <tr>
      <td>2018</td>
      <td>OLED G-series</td>
      <td>LG G8</td>
      <td>Expected to work once rooted</td>
    </tr>
    <tr>
      <td>2018</td>
      <td>OLED W-series</td>
      <td>LG W8</td>
      <td>Expected to work once rooted</td>
    </tr>
    <tr>
      <td>2017 and earlier</td>
      <td>All lines</td>
      <td>All LG webOS TVs</td>
      <td>Not supported (below webOS 4.0)</td>
    </tr>
  </tbody>
</table>

The Status column summarises the webosbrew, RootMyTV, DejaVuln and faultmanager project notes as of August 2025 and
will age; the CanI.RootMy.TV result for your own TV is the one that counts.

## Reporting what works

Open a [compatibility report](https://github.com/SammySco/webos-av-overlay/issues/new?template=compatibility_report.yml)
with your TV model and webOS version, the receiver's `model_name`, `api_version` and `system_version`, and whether
the volume popup, info bar and sound programs worked. Confirmed combinations will be added to this page.
