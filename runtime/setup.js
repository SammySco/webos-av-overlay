'use strict';

// /setup page and its JSON endpoints, served by the watcher on the info port.
//   GET  /setup                 the settings form
//   POST /setup/save            validate + apply + persist (JSON body)
//   POST /setup/test            {kind:"amp"|"plex"|"jellyfin", ...} connectivity check
//   GET  /setup/sound/state     what the sound-program engine currently sees (for the live line on the page)
//   POST /setup/sound/apply     run the sound-program rules now
// The Plex token and Jellyfin API key are write-only: never sent back to the browser or written to the log.

var http = require('http');
var https = require('https');

var HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;
var IP_RE = /^[0-9A-Fa-f:.]+$/;

function esc(t) {
  return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function readJson(req, cb) {
  var body = '', done = false;
  req.setEncoding('utf8');
  req.on('data', function (c) {
    body += c;
    if (body.length > 32768 && !done) { done = true; cb(new Error('too large')); req.destroy(); }
  });
  req.on('end', function () {
    if (done) return;
    done = true;
    try { cb(null, JSON.parse(body || '{}')); } catch (e) { cb(new Error('bad json')); }
  });
}

function validUrl(u) {
  try { var p = new (require('url').URL)(u); return (p.protocol === 'http:' || p.protocol === 'https:') && !!p.hostname; }
  catch (e) { return false; }
}

module.exports = function createSetup(ctx) {
  function send(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(obj));
  }

  var ICONS = {
    amp:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    plex:     '<svg width="28" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#E5A00D"><path d="M3.987 8.409c-.96 0-1.587.28-2.12.933v-.72H0v8.88s.038.018.127.037c.138.03.821.187 1.331-.249.441-.377.542-.814.542-1.318v-1.283c.533.573 1.147.813 2 .813 1.84 0 3.253-1.493 3.253-3.48 0-2.12-1.36-3.613-3.266-3.613Zm16.748 5.595.406.591c.391.614.894.906 1.492.908.621-.012 1.064-.562 1.226-.755 0 0-.307-.27-.686-.72-.517-.614-1.214-1.755-1.24-1.803l-1.198 1.779Zm-3.205-1.955c0-2.08-1.52-3.64-3.52-3.64s-3.467 1.587-3.467 3.573a3.48 3.48 0 0 0 3.507 3.52c1.413 0 2.626-.84 3.253-2.293h-2.04l-.093.093c-.427.4-.72.533-1.227.533-.787 0-1.373-.506-1.453-1.266h4.986c.04-.214.054-.307.054-.52Zm-7.671-.219c0 .769.11 1.701.868 2.722l.056.069c-.306.526-.742.88-1.248.88-.399 0-.814-.211-1.138-.579a2.177 2.177 0 0 1-.538-1.441V6.409H9.86l-.001 5.421Zm9.283 3.46h-2.39l2.247-3.332-2.247-3.335h2.39l2.248 3.335-2.248 3.332Zm1.593-1.286Zm-17.162-.342c-.933 0-1.68-.773-1.68-1.72s.76-1.666 1.68-1.666c.92 0 1.68.733 1.68 1.68 0 .946-.733 1.706-1.68 1.706Zm18.361-1.974L24 8.622h-2.391l-.87 1.293 1.195 1.773Zm-9.404-.466c.16-.706.72-1.133 1.493-1.133.773 0 1.373.467 1.507 1.133h-3Z"/></svg>',
    jellyfin: '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#00A4DC"><path d="M12 .002C8.826.002-1.398 18.537.16 21.666c1.56 3.129 22.14 3.094 23.682 0C25.384 18.573 15.177 0 12 0zm7.76 18.949c-1.008 2.028-14.493 2.05-15.514 0C3.224 16.9 9.92 4.755 12.003 4.755c2.081 0 8.77 12.166 7.759 14.196zM12 9.198c-1.054 0-4.446 6.15-3.93 7.189.518 1.04 7.348 1.027 7.86 0 .511-1.027-2.874-7.19-3.93-7.19z"/></svg>',
    display:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>',
    infobar:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>',
    sound:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
    chev:     '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
  };
  function ico(k) { return ICONS[k] || ''; }

  function page(L) {
    var s = ctx.getSettings();
    var sound = ctx.getSound() || {};
    var ch = L.choices || { inputs: [], tvApps: [], atv: [], seen: [] };
    var rulesForPage = (sound.rules || []).map(function (r) {
      var kind = r.kind;
      if (!kind) kind = 'any'; // rules saved before source types existed keep matching every source until changed
      return { app: r.app, kind: kind, program: r.program, decoder: r.decoder };
    });
    var data = JSON.stringify({
      programs: L.programs, decoders: L.decoders, inputs: L.inputs, choices: L.choices,
      sound: { enabled: !!sound.enabled, tvInput: sound.tvInput || 'audio1', appInput: sound.appInput || '',
        default: sound.default || null, rules: rulesForPage, seen: sound.seen || [] }
    }).replace(/</g, '\\u003c');
    var volNames = { numeric: 'Numeric', db: 'Decibels (dB)' };
    var volModes = ctx.volumeModes.map(function (m) {
      return '<option value="' + m + '"' + (m === s.volumeDisplay ? ' selected' : '') + '>' + volNames[m] + '</option>';
    }).join('');
    var CLABELS = { 'top-left': 'Top left', 'top-center': 'Top center', 'top-right': 'Top right',
      'middle-left': 'Middle left', 'middle-right': 'Middle right',
      'bottom-left': 'Bottom left', 'bottom-center': 'Bottom center', 'bottom-right': 'Bottom right' };
    var corners = ctx.corners.map(function (c) {
      return '<option value="' + c + '"' + (c === s.corner ? ' selected' : '') + '>' + esc(CLABELS[c] || c) + '</option>';
    }).join('');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>AV overlay setup</title><style>' +
      ':root{color-scheme:dark}body{margin:0;padding:24px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#111114;color:#eee}' +
      'main{max-width:760px;margin:0 auto}h1{font-size:22px;font-weight:600;margin:0 0 4px}' +
      'details{border-top:1px solid #232328}details:first-of-type{border-top:none}' +
      'summary{list-style:none;display:flex;align-items:center;gap:8px;cursor:pointer;padding:16px 0 8px;font-size:17px;font-weight:600;color:#ccccd4;-webkit-user-select:none;user-select:none}' +
      'summary::-webkit-details-marker{display:none}summary svg{flex-shrink:0}' +
      '.chev{flex-shrink:0;color:#4a4a52;transition:transform .18s}details[open] .chev{transform:rotate(90deg)}' +
      'p{margin:0 0 14px;color:#8b8b93;font-size:14px}label{display:block;margin:12px 0 4px;color:#c8c8ce;font-size:14px}' +
      'input[type=text],input[type=password],input[type=number],select{width:100%;box-sizing:border-box;padding:10px 12px;font:inherit;color:#fff;background:#1b1b20;border:1px solid #3a3a42;border-radius:10px}' +
      '.row{display:flex;gap:10px}.row>div{flex:1}.row>div.narrow{flex:0 0 110px}.check{display:flex;align-items:center;gap:8px;margin:12px 0;color:#c8c8ce}' +
      '.filters{display:flex;flex-wrap:wrap;gap:6px 18px;margin:6px 0 8px}.filters label{display:flex;align-items:center;gap:6px;margin:0;font-size:14px}.rule{display:flex;gap:8px;margin:8px 0;align-items:center}.rule .appwrap{flex:1.3;display:flex;flex-direction:column;gap:6px;min-width:0}.rule .appwrap select,.rule .appwrap input{width:100%}.rule select{flex:1}.rule button{flex:0 0 auto}' +
      'nav{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap}button,a.btn{font:inherit;color:#fff;text-decoration:none;background:#2a2a31;border:1px solid #3a3a42;padding:9px 14px;border-radius:10px;cursor:pointer}' +
      'button.primary{background:#2f5d3f;border-color:#3f7255}button:hover,a.btn:hover{filter:brightness(1.15)}#msg{margin-top:16px;min-height:22px;font-size:14px}.ok{color:#9fe0b6}.bad{color:#ffaaaa}' +
      ':focus{outline:3px solid #fff;outline-offset:2px}html{-webkit-text-size-adjust:100%}' +
      '@media (max-width:640px){body{padding:16px 14px}.row.stack{flex-direction:column;gap:0}' +
      '.rule{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px;margin:10px 0;background:#17171b;border:1px solid #2a2a30;border-radius:12px}' +
      '.rule .appwrap,.rule button{grid-column:1/-1}.rule select{min-width:0;width:100%}nav button,nav a.btn{flex:1 1 140px;text-align:center}}' +
      '@media (min-width:1500px){body{font-size:26px}main{max-width:1200px}input[type=text],input[type=password],input[type=number],select,button,a.btn{font-size:26px;padding:16px 20px}}' +
      '</style></head><body><main><h1>AV overlay setup</h1><p>Settings are saved on the TV and apply straight away.</p>' +
      '<details><summary>' + ico('chev') + ico('amp') + 'Yamaha receiver</summary><div class="row"><div><label for="ampHost">IP address or hostname</label>' +
      '<input id="ampHost" type="text" value="' + esc(s.ampHost) + '" placeholder="e.g. 192.168.1.50" autocomplete="off"></div>' +
      '<div class="narrow"><label for="ampPort">Port</label><input id="ampPort" type="number" min="1" max="65535" value="' + esc(s.ampPort) + '"></div></div>' +
      '</details><details><summary>' + ico('chev') + ico('plex') + 'Plex (optional)</summary><label for="plexUrl">Server URL</label>' +
      '<input id="plexUrl" type="text" value="' + esc(s.plexUrl) + '" placeholder="http://192.168.1.10:32400" autocomplete="off">' +
      '<label for="plexToken">Token (' + (s.plexTokenSet ? 'saved - leave blank to keep it' : 'not set') + ')</label>' +
      '<input id="plexToken" type="password" value="" placeholder="X-Plex-Token" autocomplete="new-password">' +
      (s.plexTokenSet ? '<div class="check"><input id="plexClear" type="checkbox"><label for="plexClear" style="margin:0">Remove the saved Plex settings</label></div>' : '') +
      '<label for="plexPlayer">Player IP (optional, picks one session when several are playing)</label>' +
      '<input id="plexPlayer" type="text" value="' + esc(s.plexPlayer) + '" placeholder="e.g. the Apple TV address" autocomplete="off">' +
      '</details><details><summary>' + ico('chev') + ico('jellyfin') + 'Jellyfin (optional)</summary><label for="jellyfinUrl">Server URL</label>' +
      '<input id="jellyfinUrl" type="text" value="' + esc(s.jellyfinUrl) + '" placeholder="http://192.168.1.10:8096" autocomplete="off">' +
      '<label for="jellyfinApiKey">API key (' + (s.jellyfinApiKeySet ? 'saved - leave blank to keep it' : 'not set') + ')</label>' +
      '<input id="jellyfinApiKey" type="password" value="" placeholder="Jellyfin API key" autocomplete="new-password">' +
      (s.jellyfinApiKeySet ? '<div class="check"><input id="jellyfinClear" type="checkbox"><label for="jellyfinClear" style="margin:0">Remove the saved Jellyfin settings</label></div>' : '') +
      '<label for="jellyfinDevice">Device / client name (optional, filters to one session)</label>' +
      '<input id="jellyfinDevice" type="text" value="' + esc(s.jellyfinDevice) + '" placeholder="e.g. Infuse, Apple TV" autocomplete="off">' +
      '</details><details><summary>' + ico('chev') + ico('display') + 'Display</summary><div class="check"><input id="autoInfo" type="checkbox"' + (s.autoInfo ? ' checked' : '') + '>' +
      '<label for="autoInfo" style="margin:0">Show the info bar by itself when the stream or amp info changes</label></div>' +
      '<label for="corner">Info bar position</label><select id="corner">' + corners + '</select>' +
      '<label for="volMode">Volume number</label><select id="volMode">' + volModes + '</select>' +
      (function(){var sz=[75,100,125,150],nm={75:'Small',100:'Normal',125:'Large',150:'XL'};
      return '<div class="row stack"><div><label for="volFont">Volume font size</label><select id="volFont">' +
        sz.map(function(v){return '<option value="'+v+'"'+(s.volFontSize===v||(!s.volFontSize&&v===100)?' selected':'')+'>'+nm[v]+'</option>'}).join('')+
        '</select></div><div><label for="infoFont">Info bar font size</label><select id="infoFont">' +
        sz.map(function(v){return '<option value="'+v+'"'+(s.infoFontSize===v||(!s.infoFontSize&&v===100)?' selected':'')+'>'+nm[v]+'</option>'}).join('')+
        '</select></div></div>';})() +
      '</details><details><summary>' + ico('chev') + ico('infobar') + 'Info bar</summary>' +
      '<div class="row stack"><div><label for="iLayout">Layout</label>' +
      '<select id="iLayout"><option value="stack"' + (s.infoLayout === 'banner' ? '' : ' selected') + '>Stack (one row per line)</option>' +
      '<option value="banner"' + (s.infoLayout === 'banner' ? ' selected' : '') + '>Banner (single line)</option></select></div>' +
      '<div><label for="iShow">Show for (seconds)</label><input id="iShow" type="number" min="1" max="60" step="1" value="' + esc(Math.round((s.infoShowMs || 5000) / 1000)) + '"></div>' +
      '<div><label for="iDelay">Appear delay (seconds)</label><input id="iDelay" type="number" min="0" max="10" step="1" value="' + esc(Math.round((s.infoDelayMs !== undefined ? s.infoDelayMs : 1000) / 1000)) + '"></div></div>' +
      '<label>Rows shown on the info bar</label>' +
      '<div class="filters">' +
      ['program:Sound program', 'source:Source', 'app:App', 'audio:Audio (amp)', 'plex:Plex', 'jellyfin:Jellyfin', 'processing:Processing', 'video:Video', 'colour:Colour'].map(function (kl) {
        var k = kl.split(':')[0], l = kl.split(':')[1];
        var checked = (s.hiddenRows || []).indexOf(k) < 0;
        return '<label><input type="checkbox" class="rowVis" value="' + k + '"' + (checked ? ' checked' : '') + '> ' + l + '</label>';
      }).join('') + '</div>' +
      '</details><details><summary>' + ico('chev') + ico('sound') + 'Sound program per app (Yamaha)</summary>' +
      '<p>Choose the receiver sound program for each app or input. LG apps (installed on this TV), Live TV and HDMI inputs are detected on the TV; Apple TV apps are sent by Home Assistant (see docs/HOME-ASSISTANT.md). A rule picked as an LG app only applies to the LG app, and one picked as an Apple TV app only to the Apple TV, so the two Netflix entries can differ. The receiver is only changed while it is on the input below.</p>' +
      '<div class="check"><input id="sEnabled" type="checkbox"><label for="sEnabled" style="margin:0">Switch the sound program automatically</label></div>' +
      '<div class="row stack"><div><label for="sTv">Receiver input the TV is on</label><select id="sTv"></select></div>' +
      '<div><label for="sAppIn">Input the Apple TV is on</label><select id="sAppIn"></select></div></div>' +
      '<label>Default when no rule matches</label><div class="row stack"><div><select id="dProg"></select></div><div><select id="dDec"></select></div></div>' +
      '<label>Rules</label><div class="filters"><label><input type="checkbox" id="f_live"> Live TV</label><label><input type="checkbox" id="f_inputs"> HDMI inputs</label><label><input type="checkbox" id="f_lg"> LG apps</label><label><input type="checkbox" id="f_atv"> Apple TV apps</label><label><input type="checkbox" id="f_amp"> Receiver sources</label></div>' +
      '<p style="margin:0 0 6px">Tick what to show in the list below. Hidden rules are still saved and still apply.</p><div id="rules"></div>' +
      '<nav><button id="addRule">Add rule</button><button id="refreshApps">Refresh app list</button><button id="applyNow">Apply now (saved rules)</button></nav>' +
      '<p id="soundNow" style="margin-top:14px"></p>' +
      '</details>' +
      '<nav><button id="save" class="primary">Save</button><button id="testAmp">Test receiver</button><button id="testPlex">Test Plex</button><button id="testJellyfin">Test Jellyfin</button>' +
      '<a class="btn" href="/status">Status page</a></nav><div id="msg"></div></main>' +
      '<script type="application/json" id="data">' + data + '</script>' +
      '<script>(function(){function $(i){return document.getElementById(i)}var D=JSON.parse($("data").textContent),msg=$("msg");' +
      'function say(t,ok){msg.textContent=t;msg.className=ok?"ok":"bad"}' +
      'function pretty(p){return p.split("_").join(" ")}' +
      'function opt(sel,v,label,cur){var o=document.createElement("option");o.value=v;o.textContent=label;if(v===cur)o.selected=true;sel.appendChild(o)}' +
      'function fillProg(sel,cur){opt(sel,"","(leave unchanged)",cur||"");D.programs.forEach(function(p){opt(sel,p,pretty(p),cur)})}' +
      'function fillDec(sel,cur){opt(sel,"","(no change)",cur||"");D.decoders.forEach(function(p){opt(sel,p,pretty(p),cur)})}' +
      'function sync(ps,ds){ds.disabled=ps.value!=="surr_decoder"}' +
      'var S=D.sound,inputs=D.inputs.length?D.inputs.slice():["audio1","audio2","audio3","hdmi1","hdmi2","hdmi3","hdmi4"];' +
      'if(inputs.indexOf(S.tvInput)<0)inputs.push(S.tvInput);inputs.forEach(function(i){opt($("sTv"),i,i,S.tvInput)});' +
      'opt($("sAppIn"),"","any HDMI input",S.appInput);["HDMI 1","HDMI 2","HDMI 3","HDMI 4"].forEach(function(h){opt($("sAppIn"),h,h,S.appInput)});' +
      '$("sEnabled").checked=S.enabled;fillProg($("dProg"),S.default&&S.default.program);fillDec($("dDec"),S.default&&S.default.decoder);' +
      '$("dProg").onchange=function(){sync($("dProg"),$("dDec"))};sync($("dProg"),$("dDec"));' +
            'var F={live:true,inputs:true,lg:true,atv:true,amp:true};' +
      'try{var sv=JSON.parse(localStorage.getItem("avoFilters")||"{}");Object.keys(F).forEach(function(k){if(sv[k]===false)F[k]=false})}catch(e){}' +
      'var TAG={input:"",lg:" (LG app)",atv:" (Apple TV)",amp:" (receiver)",any:" (any source)"};' +
      'function catOf(id){var i=id.indexOf("|"),kind=id.slice(0,i),name=id.slice(i+1);if(kind==="input")return name==="Live TV"?"live":"inputs";return kind}' +
      'function fill(as,cur){' +
      '  while(as.firstChild)as.removeChild(as.firstChild);' +
      '  var C=D.choices,have={};' +
      '  function add(parent,kind,v,l){var id=kind+"|"+v;if(have[id.toLowerCase()])return;have[id.toLowerCase()]=1;var o=document.createElement("option");o.value=id;o.textContent=l+TAG[kind];parent.appendChild(o)}' +
      '  function group(label,kind,items,cat){if(cat&&!F[cat])return;var g=document.createElement("optgroup");g.label=label;items.forEach(function(it){var v=typeof it==="string"?it:it.value,l=typeof it==="string"?it:it.label;add(g,kind,v,l)});if(g.children.length)as.appendChild(g)}' +
      '  var first=document.createElement("option");first.value="";first.textContent="Choose an app or input...";as.appendChild(first);' +
      '  group("Live TV","input",C.inputs.filter(function(x){return x.value==="Live TV"}),"live");' +
      '  group("HDMI inputs","input",C.inputs.filter(function(x){return x.value!=="Live TV"}),"inputs");' +
      '  group("LG apps (installed on this TV)","lg",C.tvApps,"lg");' +
      '  group("Apple TV apps (sent by Home Assistant)","atv",C.atv,"atv");' +
      '  group("Receiver\'s own sources (TIDAL, net radio, ...)","amp",C.amp,"amp");group("Seen recently (any source)","any",C.seen);' +
      '  if(cur&&cur!=="__other"&&!have[cur.toLowerCase()]){var g=document.createElement("optgroup");g.label="Current rule";var i=cur.indexOf("|");add(g,cur.slice(0,i),cur.slice(i+1),cur.slice(i+1));as.appendChild(g)}' +
      '  var oo=document.createElement("option");oo.value="__other";oo.textContent="Other (type a name)...";as.appendChild(oo);' +
      '  as.value=cur||""}' +
      'function rowCat(as){return as.value&&as.value!=="__other"?catOf(as.value):"any"}' +
      'function showRow(row){var as=row.children[0].children[0],c=rowCat(as);row.style.display=(c==="any"||F[c])?"":"none"}' +
      'function refreshAll(){Array.prototype.forEach.call($("rules").children,function(row){var as=row.children[0].children[0],cur=as.value;fill(as,cur);showRow(row)})}' +
      '["live","inputs","lg","atv","amp"].forEach(function(k){var cb=$("f_"+k);cb.checked=F[k];cb.onchange=function(){F[k]=cb.checked;try{localStorage.setItem("avoFilters",JSON.stringify(F))}catch(e){}refreshAll()}});' +
      'function addRule(r){r=r||{};var d=document.createElement("div");d.className="rule";' +
      '  var w=document.createElement("div");w.className="appwrap";var as=document.createElement("select");var ai=document.createElement("input");ai.type="text";ai.placeholder="App or input name";ai.style.display="none";' +
      '  var cur=(r.app||"").trim();var ck=cur?(r.kind||"any")+"|"+cur:"";' +
      '  fill(as,ck);' +
      '  if(cur&&as.value!==ck){as.value="__other";ai.style.display="";ai.value=cur}' +
      '  as.onchange=function(){ai.style.display=as.value==="__other"?"":"none";if(as.value==="__other")ai.focus();showRow(d)};' +
      '  w.appendChild(as);w.appendChild(ai);' +
      '  var p=document.createElement("select");fillProg(p,r.program);var c=document.createElement("select");fillDec(c,r.decoder);p.onchange=function(){sync(p,c)};sync(p,c);' +
      '  var x=document.createElement("button");x.textContent="Remove";x.onclick=function(){d.remove()};' +
      '  d.appendChild(w);d.appendChild(p);d.appendChild(c);d.appendChild(x);$("rules").appendChild(d);showRow(d)}' +
      'S.rules.forEach(addRule);$("addRule").onclick=function(){addRule({})};' +
      'function collect(){var rules=[];Array.prototype.forEach.call($("rules").children,function(d){var k=d.children;' +
      'var sel=k[0].children[0],txt=k[0].children[1],kind="any",name;if(sel.value==="__other"){name=txt.value}else{var i=sel.value.indexOf("|");kind=sel.value.slice(0,i);name=sel.value.slice(i+1)}rules.push({app:name.trim(),kind:kind,program:k[1].value,decoder:k[2].value})});' +
      'return{enabled:$("sEnabled").checked,tvInput:$("sTv").value,appInput:$("sAppIn").value,default:{program:$("dProg").value,decoder:$("dDec").value},rules:rules}}' +
      'function body(){var b={ampHost:$("ampHost").value.trim(),ampPort:$("ampPort").value,plexUrl:$("plexUrl").value.trim(),plexToken:$("plexToken").value,' +
      'plexPlayer:$("plexPlayer").value.trim(),jellyfinUrl:$("jellyfinUrl").value.trim(),jellyfinApiKey:$("jellyfinApiKey").value,' +
      'jellyfinDevice:$("jellyfinDevice").value.trim(),autoInfo:$("autoInfo").checked,corner:$("corner").value,volumeDisplay:$("volMode").value,' +
      'infoLayout:$("iLayout").value,infoShowMs:Math.round(Number($("iShow").value))*1000,infoDelayMs:Math.round(Number($("iDelay").value))*1000,' +
      'volFontSize:Number($("volFont").value),infoFontSize:Number($("infoFont").value),' +
      'hiddenRows:Array.prototype.filter.call(document.querySelectorAll(".rowVis"),function(c){return !c.checked}).map(function(c){return c.value}),' +
      'sound:collect()};if($("plexClear"))b.plexClear=$("plexClear").checked;if($("jellyfinClear"))b.jellyfinClear=$("jellyfinClear").checked;return b}' +
      'function post(p,b){return fetch(p,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b||{})}).then(function(r){return r.json()})}' +
      '$("save").onclick=function(){say("Saving...",true);post("/setup/save",body()).then(function(j){if(j.ok){say("Saved.",true);window.setTimeout(function(){location.reload()},700)}else say(j.error||"Could not save",false)}).catch(function(){say("Request failed",false)})};' +
      '$("testAmp").onclick=function(){say("Testing...",true);var b=body();post("/setup/test",{kind:"amp",host:b.ampHost,port:b.ampPort}).then(function(j){say(j.ok?"Receiver found: "+j.model+(j.version?" (API "+j.version+")":""):(j.error||"No answer"),j.ok)}).catch(function(){say("Request failed",false)})};' +
      '$("testPlex").onclick=function(){say("Testing...",true);var b=body();post("/setup/test",{kind:"plex",url:b.plexUrl,token:b.plexToken}).then(function(j){say(j.ok?"Plex answered ("+j.sessions+" active session"+(j.sessions===1?"":"s")+")":(j.error||"No answer"),j.ok)}).catch(function(){say("Request failed",false)})};' +
      '$("testJellyfin").onclick=function(){say("Testing...",true);var b=body();post("/setup/test",{kind:"jellyfin",url:b.jellyfinUrl,apiKey:b.jellyfinApiKey}).then(function(j){say(j.ok?"Jellyfin answered ("+j.sessions+" active session"+(j.sessions===1?"":"s")+")":(j.error||"No answer"),j.ok)}).catch(function(){say("Request failed",false)})};' +
      'function now(){fetch("/setup/sound/state",{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){var c=j.current||{};' +
      '$("soundNow").textContent="Right now: "+(c.key||"nothing recognised")+(c.pushed?" (app sent by Home Assistant)":"")+" - last action: "+((c.last&&c.last.result)||"none")}).catch(function(){})}' +
      '$("applyNow").onclick=function(){post("/setup/sound/apply").then(function(){window.setTimeout(now,1500)})};' +
      '$("refreshApps").onclick=function(){say("Refreshing…",true);fetch("/setup/sound/refresh",{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){if(j.ok){D.choices=j.choices;refreshAll();say("App list refreshed.",true)}else say(j.error||"Refresh failed",false)}).catch(function(){say("Request failed",false)})};' +
      'now();window.setInterval(now,4000);' +
      '}());</script></body></html>';
  }

  function testAmp(host, port, cb) {
    if (!HOST_RE.test(host || '')) return cb(new Error('Enter a valid IP address or hostname'));
    port = Number(port) || 80;
    if (port < 1 || port > 65535) return cb(new Error('Port must be 1-65535'));
    var req = http.get({ host: host, port: port, path: '/YamahaExtendedControl/v1/system/getDeviceInfo', timeout: 2500 }, function (res) {
      var b = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { if (b.length < 65536) b += c; });
      res.on('end', function () {
        var j = null;
        try { j = JSON.parse(b); } catch (e) {}
        if (j && j.response_code === 0) cb(null, { model: j.model_name || 'Yamaha receiver', version: j.api_version });
        else cb(new Error('Something answered, but it is not a Yamaha Extended Control receiver'));
      });
    });
    req.on('timeout', function () { req.destroy(new Error('No answer from ' + host + ':' + port)); });
    req.on('error', function (e) { cb(new Error(e.message)); });
  }

  function testPlex(url, token, cb) {
    if (!validUrl(url)) return cb(new Error('Enter a full URL such as http://192.168.1.10:32400'));
    var s = ctx.getPlexSecret();
    // the saved token is only ever used for the saved server, never for an address typed into the form
    token = token || (s && s.url === url ? s.token : '');
    if (!token) return cb(new Error('Enter the Plex token'));
    var u = new (require('url').URL)(url.replace(/\/+$/, '') + '/status/sessions');
    var mod = u.protocol === 'https:' ? https : http;
    var req = mod.get({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname,
      headers: { Accept: 'application/json', 'X-Plex-Token': token }, timeout: 3000, rejectUnauthorized: false }, function (res) {
      var b = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { if (b.length < 262144) b += c; });
      res.on('end', function () {
        if (res.statusCode === 401) return cb(new Error('Plex rejected the token'));
        if (res.statusCode !== 200) return cb(new Error('Plex answered HTTP ' + res.statusCode));
        var n = 0;
        try { n = Number(JSON.parse(b).MediaContainer.size) || 0; } catch (e) {}
        cb(null, { sessions: n });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('No answer from the Plex server')); });
    req.on('error', function (e) { cb(new Error(e.message)); });
  }

  function testJellyfin(url, apiKey, cb) {
    if (!validUrl(url)) return cb(new Error('Enter a full URL such as http://192.168.1.10:8096'));
    var s = ctx.getJellyfinSecret();
    apiKey = apiKey || (s && s.url === url ? s.apiKey : '');
    if (!apiKey) return cb(new Error('Enter the Jellyfin API key'));
    var u = new (require('url').URL)(url.replace(/\/+$/, '') + '/Sessions');
    var mod = u.protocol === 'https:' ? https : http;
    var req = mod.get({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname,
      headers: { Accept: 'application/json', 'X-MediaBrowser-Token': apiKey }, timeout: 3000, rejectUnauthorized: false }, function (res) {
      var b = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { if (b.length < 262144) b += c; });
      res.on('end', function () {
        if (res.statusCode === 401) return cb(new Error('Jellyfin rejected the API key'));
        if (res.statusCode !== 200) return cb(new Error('Jellyfin answered HTTP ' + res.statusCode));
        var n = 0;
        try { n = JSON.parse(b).filter(function (x) { return !!x.NowPlayingItem; }).length; } catch (e) {}
        cb(null, { sessions: n });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('No answer from the Jellyfin server')); });
    req.on('error', function (e) { cb(new Error(e.message)); });
  }

  function validate(b) {
    var out = {};
    if (b.ampHost !== undefined) {
      var h = String(b.ampHost).trim();
      if (h && !HOST_RE.test(h)) return { error: 'The receiver address is not valid' };
      out.ampHost = h;
    }
    if (b.ampPort !== undefined && String(b.ampPort).trim() !== '') {
      var p = Number(b.ampPort);
      if (!(p >= 1 && p <= 65535)) return { error: 'Port must be 1-65535' };
      out.ampPort = Math.round(p);
    }
    if (b.corner !== undefined) {
      if (ctx.corners.indexOf(b.corner) < 0) return { error: 'Unknown position' };
      out.corner = b.corner;
    }
    if (b.infoLayout !== undefined) {
      if (b.infoLayout !== 'stack' && b.infoLayout !== 'banner') return { error: 'Unknown layout' };
      out.infoLayout = b.infoLayout;
    }
    if (b.infoShowMs !== undefined) {
      var sm = Math.round(Number(b.infoShowMs));
      if (!(sm >= 1000 && sm <= 60000)) return { error: 'Show duration must be 1–60 seconds' };
      out.infoShowMs = sm;
    }
    if (b.infoDelayMs !== undefined) {
      var dm = Math.round(Number(b.infoDelayMs));
      if (!(dm >= 0 && dm <= 10000)) return { error: 'Appear delay must be 0–10 seconds' };
      out.infoDelayMs = dm;
    }
    if (b.hiddenRows !== undefined) {
      if (!Array.isArray(b.hiddenRows)) return { error: 'Invalid hidden rows' };
      var rowKeys = ['program', 'source', 'app', 'audio', 'plex', 'jellyfin', 'processing', 'video', 'colour'];
      out.hiddenRows = b.hiddenRows.filter(function (r) { return rowKeys.indexOf(r) >= 0; });
    }
    if (b.volFontSize !== undefined) {
      var vfs = [75, 100, 125, 150].indexOf(Number(b.volFontSize)) >= 0 ? Number(b.volFontSize) : null;
      if (!vfs) return { error: 'Invalid volume font size' };
      out.volFontSize = vfs;
    }
    if (b.infoFontSize !== undefined) {
      var ifs = [75, 100, 125, 150].indexOf(Number(b.infoFontSize)) >= 0 ? Number(b.infoFontSize) : null;
      if (!ifs) return { error: 'Invalid info font size' };
      out.infoFontSize = ifs;
    }
    if (b.autoInfo !== undefined) out.autoInfo = !!b.autoInfo;
    if (b.volumeDisplay !== undefined) {
      if (ctx.volumeModes.indexOf(b.volumeDisplay) < 0) return { error: 'Unknown volume display' };
      out.volumeDisplay = b.volumeDisplay;
    }
    if (b.sound !== undefined) {
      var sv = ctx.profiles.validate(b.sound);
      if (sv.error) return { error: sv.error };
      out.sound = sv.value;
    }
    if (b.plexClear) out.plexClear = true;
    else if (b.plexUrl !== undefined || b.plexToken !== undefined || b.plexPlayer !== undefined) {
      var url = String(b.plexUrl || '').trim();
      if (url && !validUrl(url)) return { error: 'The Plex URL must start with http:// or https://' };
      var player = String(b.plexPlayer || '').trim();
      if (player && !IP_RE.test(player)) return { error: 'The Plex player IP is not valid' };
      out.plexUrl = url;
      out.plexPlayer = player;
      if (b.plexToken) out.plexToken = String(b.plexToken).trim();
    }
    if (b.jellyfinClear) out.jellyfinClear = true;
    else if (b.jellyfinUrl !== undefined || b.jellyfinApiKey !== undefined || b.jellyfinDevice !== undefined) {
      var jurl = String(b.jellyfinUrl || '').trim();
      if (jurl && !validUrl(jurl)) return { error: 'The Jellyfin URL must start with http:// or https://' };
      out.jellyfinUrl = jurl;
      out.jellyfinDevice = String(b.jellyfinDevice || '').trim();
      if (b.jellyfinApiKey) out.jellyfinApiKey = String(b.jellyfinApiKey).trim();
    }
    return { value: out };
  }

  // returns true when the request was handled
  return function handle(req, res, path) {
    if (path === '/setup' && req.method === 'GET') {
      ctx.profiles.lists(function (L) {
        L.choices = ctx.profiles.choices();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(page(L));
      });
      return true;
    }
    if (path === '/setup/sound/state' && req.method === 'GET') {
      send(res, 200, { current: ctx.profiles.current() });
      return true;
    }
    if (path === '/setup/sound/apply' && req.method === 'POST') {
      ctx.profiles.applyNow();
      send(res, 200, { ok: true });
      return true;
    }
    if (path === '/setup/sound/refresh' && req.method === 'GET') {
      ctx.profiles.refreshTitles(function () {
        send(res, 200, { ok: true, choices: ctx.profiles.choices() });
      });
      return true;
    }
    if (path === '/setup/save' && req.method === 'POST') {
      readJson(req, function (err, b) {
        if (err) return send(res, 400, { ok: false, error: err.message });
        var v = validate(b);
        if (v.error) return send(res, 400, { ok: false, error: v.error });
        var r = ctx.applySettings(v.value);
        send(res, r && r.error ? 400 : 200, r && r.error ? { ok: false, error: r.error } : { ok: true });
      });
      return true;
    }
    if (path === '/setup/test' && req.method === 'POST') {
      readJson(req, function (err, b) {
        if (err) return send(res, 400, { ok: false, error: err.message });
        if (b.kind === 'amp') testAmp(String(b.host || '').trim(), b.port, function (e, info) {
          send(res, 200, e ? { ok: false, error: e.message } : { ok: true, model: info.model, version: info.version });
        });
        else if (b.kind === 'plex') testPlex(String(b.url || '').trim(), String(b.token || '').trim(), function (e, info) {
          send(res, 200, e ? { ok: false, error: e.message } : { ok: true, sessions: info.sessions });
        });
        else if (b.kind === 'jellyfin') testJellyfin(String(b.url || '').trim(), String(b.apiKey || '').trim(), function (e, info) {
          send(res, 200, e ? { ok: false, error: e.message } : { ok: true, sessions: info.sessions });
        });
        else send(res, 400, { ok: false, error: 'unknown test' });
      });
      return true;
    }
    return false;
  };
};
