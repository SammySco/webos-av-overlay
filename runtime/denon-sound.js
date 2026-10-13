'use strict';

// Denon/Marantz surround modes and inputs for the per-app sound rules (the Denon side of profiles.js).
// The receiver's Deviceinfo.xml names the model, the sound-mode genres and the inputs (with their on-screen names), but
// not the full surround-mode list, so the modes come from a per-model table. MS commands are generic: the receiver
// picks a decoder that suits the signal (MSMOVIE on a Dolby source plays Dolby Surround, and so on).
// Modes are applied with GET /goform/formiPhoneAppDirect.xml?MS<mode> on the web port, which works while Home
// Assistant holds the single telnet connection.

var shared = require('./shared.js');

var DEFAULT_MODES = ['AUTO', 'MOVIE', 'MUSIC', 'GAME', 'DIRECT', 'PURE DIRECT', 'STEREO', 'MCH STEREO', 'DOLBY DIGITAL',
  'DTS SURROUND', 'NEURAL:X', 'VIRTUAL', 'ROCK ARENA', 'JAZZ CLUB', 'MONO MOVIE', 'MATRIX', 'VIDEO GAME'];
var MODEL_MODES = {
  'AVR-X2400H': DEFAULT_MODES
};
var MODE_LABELS = {
  'AUTO': 'Auto', 'MOVIE': 'Movie', 'MUSIC': 'Music', 'GAME': 'Game', 'DIRECT': 'Direct', 'PURE DIRECT': 'Pure Direct',
  'STEREO': 'Stereo', 'MCH STEREO': 'Multi Ch Stereo', 'DOLBY DIGITAL': 'Dolby (Atmos / Surround)', 'DTS SURROUND': 'DTS (Neural:X / Surround)',
  'NEURAL:X': 'DTS Neural:X', 'VIRTUAL': 'Virtual', 'ROCK ARENA': 'Rock Arena', 'JAZZ CLUB': 'Jazz Club', 'MONO MOVIE': 'Mono Movie',
  'MATRIX': 'Matrix', 'VIDEO GAME': 'Video Game'
};
// Deviceinfo FuncName -> SI code (what the status and telnet report as the input)
var FUNC_TO_SI = {
  'TV AUDIO': 'TV', 'CBL/SAT': 'SAT/CBL', 'DVD': 'DVD', 'BLU-RAY': 'BD', 'GAME': 'GAME', 'AUX1': 'AUX1', 'AUX2': 'AUX2',
  'MEDIA PLAYER': 'MPLAY', 'IPOD/USB': 'USB/IPOD', 'CD': 'CD', 'TUNER': 'TUNER', 'BLUETOOTH': 'BT', 'PHONO': 'PHONO',
  'HEOS MUSIC': 'NET', 'NETWORK': 'NET', '8K': '8K'
};
var DEFAULT_INPUTS = [{ value: 'TV', label: 'TV Audio' }, { value: 'SAT/CBL', label: 'CBL/SAT' }, { value: 'BD', label: 'Blu-ray' },
  { value: 'DVD', label: 'DVD' }, { value: 'GAME', label: 'Game' }, { value: 'MPLAY', label: 'Media Player' }, { value: 'AUX1', label: 'AUX1' },
  { value: 'AUX2', label: 'AUX2' }, { value: 'CD', label: 'CD' }, { value: 'TUNER', label: 'Tuner' }, { value: 'BT', label: 'Bluetooth' },
  { value: 'USB/IPOD', label: 'iPod/USB' }, { value: 'NET', label: 'HEOS Music' }];

function tag(xml, name) { var m = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(xml); return m ? m[1] : null; }
function all(xml, name) { var re = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>', 'g'), out = [], m; while ((m = re.exec(xml))) out.push(m[1]); return out; }
function txt(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }

// -> { model, genres: ['MOVIE', ...], inputs: [{value: SI code, label: on-screen name}] }
function parseDeviceInfo(xml) {
  xml = String(xml || '');
  var model = txt(tag(xml, 'ModelName')) || null;
  var genres = [];
  var sm = tag(xml, 'SoundMode');
  if (sm) all(tag(sm, 'Genre') || '', 'DispName').forEach(function (g) { g = txt(g).toUpperCase(); if (g) genres.push(g); });
  var inputs = [], seen = {};
  (all(xml, 'ShortcutControl').filter(function (b) { return b.indexOf('<Shortcut>') >= 0; })[0] ? all(all(xml, 'ShortcutControl').filter(function (b) { return b.indexOf('<Shortcut>') >= 0; })[0], 'Shortcut') : []).forEach(function (s) {
    if (txt(tag(s, 'Category')) !== '4') return; // 4 = input source
    var fn = txt(tag(s, 'FuncName')), label = txt(tag(s, 'DispName')) || fn;
    var si = FUNC_TO_SI[fn.toUpperCase()] || fn.toUpperCase();
    if (!si || seen[si]) return;
    seen[si] = 1;
    inputs.push({ value: si, label: label });
  });
  return { model: model, genres: genres, inputs: inputs };
}

function modesFor(model) { return (model && MODEL_MODES[model]) || DEFAULT_MODES; }
function modeLabel(m) { return MODE_LABELS[m] || m; }
function commandPath(mode) { return '/goform/formiPhoneAppDirect.xml?MS' + encodeURIComponent(mode); }

module.exports = { DEFAULT_MODES: DEFAULT_MODES, DEFAULT_INPUTS: DEFAULT_INPUTS, MODE_LABELS: MODE_LABELS,
  parseDeviceInfo: parseDeviceInfo, modesFor: modesFor, modeLabel: modeLabel, commandPath: commandPath, extend: shared.extend };
