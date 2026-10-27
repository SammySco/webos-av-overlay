# Home Assistant: telling the overlay which Apple TV app is playing

The overlay switches the Yamaha sound program per app (set the rules at `http://<tv>:41101/setup`).
It detects Live TV, HDMI inputs, webOS apps and Plex players on the TV by itself, but the Apple TV does not
report its app to the TV, so Home Assistant sends the app name to the overlay.

## 1. Add the REST command (configuration.yaml)

```yaml
rest_command:
  av_overlay_app:
    url: "http://TV_IP:41101/app?name={{ name | urlencode }}"
    method: get
```

Replace `TV_IP` with the TV's address (for example `192.168.1.50`). Restart or reload Home Assistant.

## 2. Add the automation

Replace `media_player.apple_tv` with your Apple TV entity ID (check Developer Tools → States). In the automation
editor choose **Edit in YAML** and paste this (no leading dash and no `id`):

```yaml
alias: Apple TV app -> AV overlay
description: Sends the Apple TV app name to the AV overlay on the TV, which sets the Yamaha sound program from its rules.
mode: restart
triggers:
  - trigger: state
    entity_id: media_player.apple_tv
    attribute: app_name
  - trigger: state
    entity_id: media_player.apple_tv
  - trigger: homeassistant
    event: start
conditions: []
actions:
  - variables:
      atv: media_player.apple_tv
  - choose:
      - conditions:
          - condition: template
            value_template: "{{ is_state(atv, ['playing', 'paused']) }}"
        sequence:
          - action: rest_command.av_overlay_app
            data:
              name: "{{ state_attr(atv, 'app_name') | default('', true) }}"
      - conditions:
          - condition: template
            value_template: "{{ is_state(atv, ['off', 'standby', 'unavailable', 'unknown']) }}"
        sequence:
          - wait_template: "{{ is_state(atv, ['playing', 'paused']) }}"
            timeout: "00:01:30"
            continue_on_timeout: true
          - condition: template
            value_template: "{{ not is_state(atv, ['playing', 'paused']) }}"
          - action: rest_command.av_overlay_app
            data:
              name: ""
    default:
      - condition: template
        value_template: "{{ state_attr(atv, 'app_name') | default('', true) | length > 0 }}"
      - action: rest_command.av_overlay_app
        data:
          name: "{{ state_attr(atv, 'app_name') }}"
```

An empty name clears the app, and it is only sent when the Apple TV is off, asleep or unavailable for 90 seconds. While it is `idle` or `on` the app name is still sent if there is one, because some apps never report `playing`: YouTube opens as `idle` with `app_name: YouTube` and often stays that way. An idle Apple TV with no app name (a long pause or the home screen can look like that) keeps the last app, so pausing Netflix does not drop the App row, reset the sound program or re-pop the bar. The watcher still forgets a pushed name after 12 hours. An automation set up from an older copy of this guide waited for `playing` or `paused` here and never sent YouTube; replace the `default:` block with the one above. If you put this in `automations.yaml` directly, make it a list item: start with
`- id: '<any unique id>'` and indent everything else by two spaces.
On older Home Assistant versions use `platform:` and `service:` in place of `trigger:`/`action:`.

Also make sure `configuration.yaml` has a single `rest_command:` block (a second one replaces the first), then
restart Home Assistant.

The last app name sent is kept across a watcher restart (a redeploy or an update), so the right rule still applies
afterwards; it is forgotten when the TV itself restarts, until the automation sends it again.

### Dashboard buttons and the status page

- To show or hide the bar from a dashboard, call the overlay from Home Assistant itself with a `rest_command` (for
  example `url: "http://TV_IP:41101/tv/show"`, and `/tv/hide`, `/info`). A `rest_command` is sent by Home Assistant
  itself, so it does not depend on the browser.
- The status page works in a **Webpage (iframe) card**: `http://TV_IP:41101/status`. Its own buttons (Show on TV,
  Live, Auto info, row switches and ordering) work inside the frame.

## 3. Optional: "Spotify on Apple TV" script

Spotify Connect to the Apple TV only works while the Spotify tvOS app is running, and the Apple TV must be on
the right input. This script does everything in one tap:

```yaml
alias: Spotify on Apple TV
icon: mdi:spotify
description: Switches the TV and amp to the Apple TV and opens its Spotify app.
mode: single
sequence:
  - action: media_player.turn_on
    target:
      entity_id: media_player.apple_tv
  - action: media_player.select_source
    target:
      entity_id: media_player.living_room_tv
    data:
      source: Apple TV          # whatever your TV calls the Apple TV input
  - action: media_player.select_source
    target:
      entity_id: media_player.yamaha_receiver
    data:
      source: HDMI 1 eARC from TV
  - delay:
      seconds: 3
  - action: media_player.select_source
    target:
      entity_id: media_player.apple_tv
    data:
      source: Spotify
```

Add a Button card on your dashboard pointing at `script.spotify_on_apple_tv` with tap action
`Perform action → script.turn_on`. One tap wakes the Apple TV, switches all inputs and opens
Spotify — "Apple TV" then appears in Spotify Connect on your phone.

## 4. Switch over from the old automation

1. Turn off the old "Apple TV app -> Yamaha sound program" automation, so the two do not fight over the receiver.
2. Open `http://<tv>:41101/setup`, check the rules and the two input fields (receiver input the TV is on, and the
   HDMI input the Apple TV is on), and tick **Switch the sound program automatically**. Save.
3. Use **Apply now**, or start something on the Apple TV, and watch the "Right now" line on the page.

## How a rule is chosen

1. The app name sent by Home Assistant, while the TV is on the HDMI input you set for the Apple TV.
2. The Plex player product (for example `Infuse`) while Plex reports a session on an HDMI input.
3. The LG foreground app: `Live TV`, `HDMI 1`..`HDMI 4`, or the title of a webOS app such as `Netflix`.

The first rule whose name matches (ignoring case) wins; otherwise the default is used. Nothing happens unless
the receiver is on the configured TV input, and the receiver is only commanded when its current program differs.
Names the overlay has seen are offered as suggestions when you add a rule.
