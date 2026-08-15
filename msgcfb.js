"use strict";
/* Minimal Outlook .msg reader: a Compound File (CFB) parser plus the handful of
   MAPI streams a compliance record needs (subject, sender, date, body, attachments).
   Exposes window.MsgParse(arrayBuffer) -> {subject, from, sentDate, body, attachments:[{name, bytes, mime}]}
   Throws on anything that isn't a valid .msg. */
(function () {
  var SECT_FREE = 0xffffffff, SECT_END = 0xfffffffe;

  function parseCFB(buf) {
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    if (dv.getUint32(0, true) !== 0xe011cfd0 || dv.getUint32(4, true) !== 0xe11ab1a1) {
      throw new Error("not a compound file");
    }
    var sectorShift = dv.getUint16(30, true);           // 9 (v3) or 12 (v4)
    var ssz = 1 << sectorShift;
    var miniShift = dv.getUint16(32, true);             // 6
    var msz = 1 << miniShift;
    var numFAT = dv.getUint32(44, true);
    var firstDir = dv.getUint32(48, true);
    var miniCutoff = dv.getUint32(56, true) || 4096;
    var firstMiniFAT = dv.getUint32(60, true);
    var firstDIFAT = dv.getUint32(68, true);

    function sectOff(n) { return (n + 1) * ssz; }

    // DIFAT: 109 entries in the header, then a chain of DIFAT sectors
    var difat = [];
    for (var i = 0; i < 109; i++) {
      var v = dv.getUint32(76 + i * 4, true);
      if (v !== SECT_FREE) difat.push(v);
    }
    var ds = firstDIFAT;
    var guard = 0;
    while (ds !== SECT_END && ds !== SECT_FREE && guard++ < 10000) {
      var base = sectOff(ds);
      var per = ssz / 4 - 1;
      for (var j = 0; j < per; j++) {
        var e = dv.getUint32(base + j * 4, true);
        if (e !== SECT_FREE) difat.push(e);
      }
      ds = dv.getUint32(base + per * 4, true);
    }
    difat = difat.slice(0, numFAT);

    // FAT
    var fat = [];
    difat.forEach(function (s) {
      var b = sectOff(s);
      for (var k = 0; k < ssz / 4; k++) fat.push(dv.getUint32(b + k * 4, true));
    });

    function chain(start) {
      var out = [], s = start, g = 0;
      while (s !== SECT_END && s !== SECT_FREE && g++ < 1000000) {
        out.push(s);
        s = fat[s];
        if (s === undefined) break;
      }
      return out;
    }
    function readChain(start, size) {
      var secs = chain(start);
      var out = new Uint8Array(size);
      var pos = 0;
      for (var c = 0; c < secs.length && pos < size; c++) {
        var take = Math.min(ssz, size - pos);
        out.set(u8.subarray(sectOff(secs[c]), sectOff(secs[c]) + take), pos);
        pos += take;
      }
      return out;
    }

    // directory entries
    var dirBytes = readChain(firstDir, chain(firstDir).length * ssz);
    var entries = [];
    for (var off = 0; off + 128 <= dirBytes.length; off += 128) {
      var d2 = new DataView(dirBytes.buffer, dirBytes.byteOffset + off, 128);
      var nameLen = d2.getUint16(64, true);
      var type = d2.getUint8(66);
      if (type === 0) continue;
      var name = "";
      for (var n = 0; n + 1 < Math.max(0, nameLen - 2); n += 2) {
        name += String.fromCharCode(d2.getUint16(n, true));
      }
      entries.push({
        idx: off / 128, name: name, type: type,
        left: d2.getUint32(68, true), right: d2.getUint32(72, true), child: d2.getUint32(76, true),
        start: d2.getUint32(116, true), size: d2.getUint32(120, true),
      });
    }
    var byIdx = {};
    entries.forEach(function (e) { byIdx[e.idx] = e; });
    var root = entries.filter(function (e) { return e.type === 5; })[0];
    if (!root) throw new Error("no root storage");

    // mini stream + mini FAT
    var miniStream = readChain(root.start, root.size);
    var miniFAT = [];
    chain(firstMiniFAT).forEach(function (s) {
      var b = sectOff(s);
      for (var k = 0; k < ssz / 4; k++) miniFAT.push(dv.getUint32(b + k * 4, true));
    });
    function readMini(start, size) {
      var out = new Uint8Array(size);
      var pos = 0, s = start, g = 0;
      while (s !== SECT_END && s !== SECT_FREE && pos < size && g++ < 1000000) {
        var take = Math.min(msz, size - pos);
        out.set(miniStream.subarray(s * msz, s * msz + take), pos);
        pos += take;
        s = miniFAT[s];
        if (s === undefined) break;
      }
      return out;
    }
    function readStream(e) {
      if (e.size === 0) return new Uint8Array(0);
      return e.size < miniCutoff ? readMini(e.start, e.size) : readChain(e.start, e.size);
    }

    // walk the directory tree into full paths
    var streams = {};
    function walkSibs(idx, path) {
      if (idx === SECT_FREE || idx === 0xffffffff) return;
      var e = byIdx[idx];
      if (!e) return;
      walkSibs(e.left, path);
      visit(e, path);
      walkSibs(e.right, path);
    }
    function visit(e, path) {
      var p = path + e.name;
      if (e.type === 1) {           // storage
        walkSibs(e.child, p + "/");
      } else if (e.type === 2) {    // stream
        streams[p] = readStream(e);
      }
    }
    walkSibs(root.child, "/");
    return streams;
  }

  /* ---- MAPI extraction ---- */
  function utf16(u8a) {
    var s = "";
    for (var i = 0; i + 1 < u8a.length; i += 2) s += String.fromCharCode(u8a[i] | (u8a[i + 1] << 8));
    return s.replace(/\u0000+$/, "");
  }
  function latin1(u8a) {
    var s = "";
    for (var i = 0; i < u8a.length; i++) s += String.fromCharCode(u8a[i]);
    return s.replace(/\u0000+$/, "");
  }
  function prop(streams, prefix, tag) {
    var a = streams[prefix + "__substg1.0_" + tag + "001F"];
    if (a) return utf16(a);
    var b = streams[prefix + "__substg1.0_" + tag + "001E"];
    if (b) return latin1(b);
    return "";
  }
  function filetimeToDate(lo, hi) {
    var ms = (hi * 4294967296 + lo) / 10000 - 11644473600000;
    var d = new Date(ms);
    return isFinite(d.getTime()) && d.getFullYear() > 1990 ? d : null;
  }
  function dateFromProps(streams, prefix) {
    var p = streams[prefix + "__properties_version1.0"];
    if (!p) return null;
    var dvp = new DataView(p.buffer, p.byteOffset, p.byteLength);
    var start = prefix === "/" ? 32 : 24; // root header is 32 bytes, others 24 (attachments 8)
    for (var off = start; off + 16 <= p.byteLength; off += 16) {
      var tag = dvp.getUint32(off, true);
      if (tag === 0x00390040 || tag === 0x0e060040) {
        var d = filetimeToDate(dvp.getUint32(off + 8, true), dvp.getUint32(off + 12, true));
        if (d) return d;
      }
    }
    return null;
  }

  var MsgParse = function (buf) {
    var streams = parseCFB(buf);
    var out = {
      subject: prop(streams, "/", "0037"),
      from: prop(streams, "/", "0C1A") || prop(streams, "/", "5D01") || prop(streams, "/", "0C1F"),
      body: prop(streams, "/", "1000"),
      sentDate: dateFromProps(streams, "/"),
      attachments: [],
    };
    var seen = {};
    Object.keys(streams).forEach(function (k) {
      var m = k.match(/^\/(__attach_version1\.0_#\d{8})\//);
      if (m && !seen[m[1]]) seen[m[1]] = true;
    });
    Object.keys(seen).sort().forEach(function (att) {
      var pre = "/" + att + "/";
      var data = streams[pre + "__substg1.0_37010102"];
      if (!data || !data.length) return; // embedded message or empty
      var name = prop(streams, pre, "3707") || prop(streams, pre, "3704") || "attachment";
      var mime = prop(streams, pre, "370E");
      out.attachments.push({ name: name, bytes: data, mime: mime });
    });
    return out;
  };
  if (typeof window !== "undefined") window.MsgParse = MsgParse;
  if (typeof module !== "undefined" && module.exports) module.exports = { MsgParse: MsgParse };
})();
