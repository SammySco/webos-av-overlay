#!/usr/bin/env node
'use strict';
// A small fake Denon AVR for testing without a receiver: telnet/ASCII on one port and the web API on another.
//   node scripts/fake-denon.js [telnetPort=2323] [httpPort=8088]
// Then point the watcher at it: EARC_AMP_TYPE=denon EARC_AMP_HOST=127.0.0.1 EARC_AMP_PORT=2323
// Type commands on stdin to simulate the remote: MV45, MV455, MUON, MUOFF, SIBD, MSSTEREO, PWSTANDBY ...
// Like the real X2400H only one telnet client is allowed: a second connection is refused (closed).
var net = require('net'), http = require('http');

function createFakeDenon(opts) {
  opts = opts || {};
  var st = { PW: 'ON', ZM: 'ON', MV: '50', MU: 'OFF', SI: 'TV', MS: 'DOLBY DIGITAL' };
  var client = null, received = [];
  function line(k) { return k + st[k] + '\r'; }
  function send(t) { if (client) client.write(t); }
  function apply(cmd) {
    cmd = String(cmd).trim(); if (!cmd) return;
    received.push(cmd);
    var k = cmd.slice(0, 2), v = cmd.slice(2);
    if (!st.hasOwnProperty(k)) return;
    if (v === '?') { send(line(k)); if (k === 'MV') send('MVMAX 98\r'); return; }
    if (k === 'MV' && (v === 'UP' || v === 'DOWN')) { var n = Number(st.MV.length === 3 ? st.MV / 10 : st.MV) + (v === 'UP' ? 0.5 : -0.5); st.MV = n % 1 ? String(Math.round(n * 10)).padStart(3, '0') : String(n).padStart(2, '0'); }
    else st[k] = v;
    if (k === 'PW') st.ZM = v === 'ON' ? 'ON' : 'OFF';
    send(line(k));
  }
  var telnet = net.createServer(function (s) {
    if (client) { s.destroy(); return; } // single client, like the receiver
    client = s; s.setEncoding('latin1');
    var buf = '';
    s.on('data', function (d) { buf += d; var p = buf.split('\r'); buf = p.pop(); p.forEach(apply); });
    s.on('close', function () { if (client === s) client = null; });
    s.on('error', function () {});
  });
  function db() { var n = st.MV.length === 3 ? Number(st.MV) / 10 : Number(st.MV); return (n - 80).toFixed(1); }
  var web = http.createServer(function (req, res) {
    if (req.url.indexOf('/goform/formMainZone_MainZoneXmlStatusLite.xml') === 0) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      return res.end('<?xml version="1.0" encoding="utf-8" ?>\n<item>\n<Power><value>' + st.PW + '</value></Power>\n<InputFuncSelect><value>' + st.SI +
        '</value></InputFuncSelect>\n<VolumeDisplay><value>Absolute</value></VolumeDisplay>\n<MasterVolume><value>' + db() + '</value></MasterVolume>\n<Mute><value>' + st.MU.toLowerCase() + '</value></Mute>\n</item>\n');
    }
    if (req.url === '/goform/AppCommand.xml' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      return res.end('<?xml version="1.0" encoding="utf-8" ?>\n<rx>\n<cmd>\n<surround>' + st.MS + '                    </surround>\n</cmd>\n</rx>\n');
    }
    res.writeHead(403); res.end();
  });
  return {
    state: st, received: received, apply: apply,
    hasClient: function () { return !!client; },
    listen: function (tp, hp, cb) { var n = 0; function d() { if (++n === 2 && cb) cb(telnet.address().port, web.address().port); } telnet.listen(tp, '127.0.0.1', d); web.listen(hp, '127.0.0.1', d); },
    close: function () { if (client) client.destroy(); telnet.close(); web.close(); }
  };
}
module.exports = createFakeDenon;

if (require.main === module) {
  var f = createFakeDenon();
  f.listen(Number(process.argv[2]) || 2323, Number(process.argv[3]) || 8088, function (tp, hp) {
    console.log('fake Denon: telnet 127.0.0.1:' + tp + ', web http://127.0.0.1:' + hp + ' - type commands (e.g. MV455, MUON, SIBD)');
  });
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) { d.split(/\r?\n/).forEach(f.apply); });
}
