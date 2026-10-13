'use strict';

// /logs: the watcher's own log (and the rotated .1 file) in the browser, with a live view, a text filter and a plain-text
// download. Read-only; like the other pages it has no password and is meant for the home network only.

var fs = require('fs');

var MAX_LINES = 5000;
var DEFAULT_LINES = 300;

// Secrets are never meant to reach the log, but redact the usual shapes anyway before any line leaves the TV.
function redact(text) {
  return text.replace(/((?:x-plex-token|token|api[_-]?key|apikey|password|authorization)["']?\s*[=:]\s*["']?)[^&\s"',}]+/gi, '$1[hidden]');
}

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n'); } catch (e) { return []; }
}

// The last n lines, reaching back into the rotated file when the current one is short.
function tail(logFile, n) {
  var lines = readLines(logFile);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length < n) {
    var older = readLines(logFile + '.1');
    if (older.length && older[older.length - 1] === '') older.pop();
    lines = older.slice(-(n - lines.length)).concat(lines);
  }
  return redact(lines.slice(-n).join('\n'));
}

function esc(t) {
  return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

function page(title) {
  return '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(title) + '</title><style>' +
    ':root{color-scheme:dark}*{box-sizing:border-box}html,body{height:100%}' +
    'body{margin:0;padding:max(10px,1.2vh) 14px;font:16px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#111114;color:#eee;overflow:hidden}' +
    'main{max-width:1100px;margin:0 auto;height:100%;display:flex;flex-direction:column;gap:8px}' +
    'h1{font-size:clamp(15px,2.6vh,22px);font-weight:600;margin:0}p#meta{margin:0;color:#8b8b93;font-size:clamp(11px,1.7vh,14px)}' +
    '.bar{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
    'input,select,.btn,.tg{font:inherit;font-size:14px;color:#eee;background:#1b1b20;border:1px solid #2c2c33;border-radius:10px;padding:.45em .7em}' +
    'input{flex:1 1 200px;min-width:0}.btn{color:#ddd;text-decoration:none;background:#2a2a31;border-color:#3a3a42;cursor:pointer}' +
    '.tg{display:flex;align-items:center;gap:8px;cursor:pointer}.sw{position:relative;width:2.6em;height:1.5em;border-radius:1em;background:#3a3a42;transition:background .15s}' +
    '.sw:after{content:"";position:absolute;top:.17em;left:.17em;width:1.16em;height:1.16em;border-radius:50%;background:#fff;transition:left .15s}' +
    '.tg.on .sw{background:#34a853}.tg.on .sw:after{left:1.27em}' +
    '#log{flex:1 1 auto;min-height:0;margin:0;overflow:auto;background:#1b1b20;border:1px solid #2c2c33;border-radius:12px;padding:10px 12px;' +
    'font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d6d6dc;white-space:pre-wrap;word-break:break-word}' +
    '#log .l{display:block}#log .t{color:#6b6b73}#log .e{color:#ff8a80}#log .w{color:#ffd180}#log .c{color:#9ad0ff}' +
    'footer{flex:0 0 auto;text-align:center;color:#6b6b73;font-size:12px}' +
    '</style></head><body><main><h1>' + esc(title) + '</h1><p id="meta">Loading...</p>' +
    '<div class="bar"><input id="q" type="search" placeholder="Filter (for example error, sound program, bar vanished)" autocomplete="off">' +
    '<select id="n"><option value="100">100 lines</option><option value="300" selected>300 lines</option><option value="1000">1000 lines</option><option value="5000">5000 lines</option></select>' +
    '<button class="tg on" id="live" type="button">Live refresh<span class="sw"></span></button>' +
    '<a class="btn" id="dl" href="/logs.txt?lines=5000" download="av-overlay.log">Download</a><a class="btn" href="/status">Status</a></div>' +
    '<pre id="log"></pre><footer>Times are UTC. Errors are red, warnings amber, changes blue.</footer></main>' +
    '<script>(function(){var q=document.getElementById("q"),n=document.getElementById("n"),lv=document.getElementById("live"),log=document.getElementById("log"),meta=document.getElementById("meta"),' +
    'raw="",live=true,timer=null,busy=false;' +
    'function esc(t){return t.replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}' +
    'function cls(l){if(/ (failed|error|exception|uncaught|unhandled)|failed:/i.test(l))return"e";if(/ (warn|expired|vanished|went away|lost)/i.test(l))return"w";if(/ info change:|sound program:|app pushed:/.test(l))return"c";return""}' +
    'function render(){var f=q.value.trim().toLowerCase(),ls=raw?raw.split("\\n"):[],shown=0,out=[];' +
    'ls.forEach(function(l){if(f&&l.toLowerCase().indexOf(f)<0)return;shown++;var m=l.match(/^(\\S+Z) (.*)$/s),c=cls(l);' +
    'out.push("<span class=\\"l"+(c?" "+c:"")+"\\">"+(m?"<span class=\\"t\\">"+esc(m[1].replace("T"," ").replace(/\\.\\d+Z$/,""))+"</span> "+esc(m[2]):esc(l))+"</span>")});' +
    'var stick=log.scrollTop+log.clientHeight>=log.scrollHeight-40;log.innerHTML=out.join("")||"<span class=\\"t\\">Nothing matches.</span>";if(stick)log.scrollTop=log.scrollHeight;' +
    'meta.textContent=shown+" of "+ls.length+" lines"+(f?" match \\""+q.value.trim()+"\\"":"")+" - updated "+new Date().toLocaleTimeString("en-AU")}' +
    'function load(){if(busy)return;busy=true;fetch("/logs.txt?lines="+n.value,{cache:"no-store"}).then(function(r){return r.text()}).then(function(t){raw=t;busy=false;render()}).catch(function(){busy=false;meta.textContent="Cannot reach the watcher"})}' +
    'function setLive(on){live=on;if(on)lv.classList.add("on");else lv.classList.remove("on");if(timer){clearInterval(timer);timer=null}if(on){timer=setInterval(load,3000)}}' +
    'q.oninput=render;n.onchange=load;lv.onclick=function(){setLive(!live)};setLive(true);load();log.scrollTop=log.scrollHeight})()</script>' +
    '</body></html>';
}

// handler(req, res, path, title) -> true when the request was a /logs request
module.exports = function createLogs(opts) {
  return function handle(req, res, path) {
    if (path !== '/logs' && path !== '/logs.txt') return false;
    // no CORS header here: another website must not be able to read the log through the visitor's browser
    var headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (path === '/logs') {
      headers['Content-Type'] = 'text/html; charset=utf-8';
      res.writeHead(200, headers);
      res.end(page(opts.title()));
      return true;
    }
    var m = /[?&]lines=(\d+)/.exec(req.url);
    var n = Math.min(MAX_LINES, Math.max(1, m ? Number(m[1]) : DEFAULT_LINES));
    headers['Content-Type'] = 'text/plain; charset=utf-8';
    res.writeHead(200, headers);
    res.end(tail(opts.logFile, n));
    return true;
  };
};
module.exports.tail = tail;
module.exports.redact = redact;
