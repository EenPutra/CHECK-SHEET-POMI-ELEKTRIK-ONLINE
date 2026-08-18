/* img-helper.js — shared photo intake + aspect-ratio-safe PDF placement.
 *
 * Loaded by every PM check sheet via <script src="img-helper.js"></script>,
 * alongside firebase-config.js / db-helper.js.
 *
 * Why this exists: every check sheet used to hand its evidence photos straight
 * to pdf.addImage(dataUrl,'JPEG',x,y,BOX_W,BOX_H) — i.e. it forced each photo
 * into a fixed box. jsPDF does not letterbox, it scales X and Y independently,
 * so a portrait phone shot dropped into a landscape box came out visibly
 * squashed and any text in the picture (nameplates, megger readings, IR scans)
 * became unreadable. Everything here exists to make that impossible:
 *
 *   IMG.read(file, cb)   normalise a picked file into a right-sized JPEG data
 *                        URL and report its true pixel size, so the page never
 *                        holds an 8 MB string and always knows the ratio.
 *   IMG.fit(w,h,nat)     letterbox maths — biggest w/h that fits a box without
 *                        changing the aspect ratio, plus centring offsets.
 *   IMG.place(pdf,...)   one-call drop-in for pdf.addImage() that applies fit()
 *                        and returns the rectangle it actually painted.
 *
 * IMG.place() falls back to jsPDF's own getImageProperties() when the caller
 * has no stored dimensions, so photos restored from an older draft or from a
 * Firestore record saved before this file existed still come out undistorted.
 */
(function (global) {
  var MAX_EDGE = 1600;   // longest side kept, px — ~200dpi at full A4 width
  var JPEG_Q = 0.9;

  function decode(dataUrl, cb) {
    var im = new Image();
    // Ask for the raw stored pixels. Browsers that honour EXIF on a canvas would
    // otherwise rotate the photo for us AND get rotated again by normalise(),
    // landing it on its side; browsers that ignore this property never rotated
    // it in the first place. Either way decode() now yields unoriented pixels.
    try { im.style.imageOrientation = 'none'; } catch (e) { }
    im.onload = function () { cb(im); };
    im.onerror = function () { cb(null); };
    im.src = dataUrl;
  }

  /* EXIF orientation tag of a JPEG, 1 when absent/unreadable. Phone cameras
   * routinely shoot portrait as a landscape frame plus an orientation flag;
   * browsers disagree about honouring it on a canvas, so we bake the rotation
   * into the pixels ourselves and every consumer sees an upright photo. */
  function exifOrientation(buf) {
    var v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0, false) !== 0xFFD8) return 1;
    var off = 2, len = v.byteLength;
    while (off + 4 <= len) {
      var marker = v.getUint16(off, false); off += 2;
      if (marker === 0xFFE1) {
        if (v.getUint32(off + 2, false) !== 0x45786966) return 1;   // "Exif"
        var tiff = off + 8;
        var little = v.getUint16(tiff, false) === 0x4949;
        var dir = tiff + v.getUint32(tiff + 4, little);
        var n = v.getUint16(dir, little);
        for (var i = 0; i < n; i++) {
          var e = dir + 2 + i * 12;
          if (v.getUint16(e, little) === 0x0112) return v.getUint16(e + 8, little);
        }
        return 1;
      }
      if ((marker & 0xFF00) !== 0xFF00) return 1;
      off += v.getUint16(off, false);
    }
    return 1;
  }

  function orientationOf(dataUrl) {
    try {
      var b64 = dataUrl.split(',')[1];
      if (!b64) return 1;
      var bin = atob(b64), ab = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) ab[i] = bin.charCodeAt(i);
      return exifOrientation(ab.buffer) || 1;
    } catch (e) { return 1; }
  }

  /* Downscale to MAX_EDGE, bake in the EXIF rotation, re-encode as JPEG, and
   * report the resulting pixel size. Aspect ratio is never altered here. */
  function normalise(im, orientation) {
    var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    if (!w || !h) return null;
    var s = Math.min(1, MAX_EDGE / Math.max(w, h));
    var dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
    var swap = orientation >= 5 && orientation <= 8;   // 90 deg turns swap the axes
    var cw = swap ? dh : dw, ch = swap ? dw : dh;
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);  // flatten alpha, JPEG has none
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, dw, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, dw, dh); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, dh); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, dh, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, dh, dw); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, dw); break;
    }
    ctx.drawImage(im, 0, 0, dw, dh);
    return { dataUrl: c.toDataURL('image/jpeg', JPEG_Q), w: cw, h: ch, ratio: cw / ch };
  }

  var IMG = {
    MAX_EDGE: MAX_EDGE,

    /* File -> {dataUrl,w,h,ratio}; cb(null) when it is not a usable image. */
    read: function (file, cb) {
      if (!file) { cb(null); return; }
      var looksLikeImage = /^image\//i.test(file.type || '') ||
        /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name || '');
      if (!looksLikeImage) { alert('File harus berupa gambar.'); cb(null); return; }
      var r = new FileReader();
      r.onload = function (e) { IMG.prepare(e.target.result, cb, true); };
      r.onerror = function () { cb(null); };
      r.readAsDataURL(file);
    },

    /* Same normalisation for a data URL we already hold — used by the sheets
     * that run their own EXIF fix first (pass alreadyUpright = true to skip
     * rotating twice). Returns {dataUrl,w,h,ratio}. */
    prepare: function (dataUrl, cb, applyExif) {
      if (!dataUrl) { cb(null); return; }
      var orientation = applyExif ? orientationOf(dataUrl) : 1;
      decode(dataUrl, function (im) {
        if (!im) { alert('Format gambar tidak bisa diproses. Gunakan JPG atau PNG.'); cb(null); return; }
        cb(normalise(im, orientation));
      });
    },

    /* Measure a data URL we already hold (drafts saved before this helper). */
    measure: function (dataUrl, cb) {
      if (!dataUrl) { cb(null); return; }
      decode(dataUrl, function (im) {
        cb(im ? { w: im.naturalWidth || im.width, h: im.naturalHeight || im.height } : null);
      });
    },

    /* Biggest w/h inside boxW x boxH keeping nat's aspect ratio, centred.
     * nat may be {w,h}, {width,height}, a bare ratio number, or null/unknown
     * (unknown assumes 4:3, the usual phone-camera shape). */
    fit: function (boxW, boxH, nat) {
      var ratio = 4 / 3;
      if (typeof nat === 'number' && isFinite(nat) && nat > 0) ratio = nat;
      else if (nat) {
        var w = nat.w || nat.width, h = nat.h || nat.height;
        if (w > 0 && h > 0) ratio = w / h;
      }
      var dw = boxW, dh = dw / ratio;
      if (dh > boxH) { dh = boxH; dw = dh * ratio; }
      return { w: dw, h: dh, dx: (boxW - dw) / 2, dy: (boxH - dh) / 2 };
    },

    /* Aspect ratio of a stored photo, from whatever the page knows about it. */
    ratioOf: function (pdf, dataUrl, nat) {
      if (nat) {
        var w = nat.w || nat.width, h = nat.h || nat.height;
        if (w > 0 && h > 0) return w / h;
      }
      if (pdf && pdf.getImageProperties && dataUrl) {
        try {
          var p = pdf.getImageProperties(dataUrl);
          if (p && p.width > 0 && p.height > 0) return p.width / p.height;
        } catch (e) { }
      }
      return 4 / 3;
    },

    /* Drop-in for pdf.addImage(): draws dataUrl centred inside the box at x,y
     * with its own aspect ratio preserved. Returns the painted rect, or null. */
    place: function (pdf, dataUrl, x, y, boxW, boxH, nat, fmt) {
      if (!dataUrl) return null;
      var f = IMG.fit(boxW, boxH, IMG.ratioOf(pdf, dataUrl, nat));
      try {
        pdf.addImage(dataUrl,
          fmt || (/^data:image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG'),
          x + f.dx, y + f.dy, f.w, f.h, undefined, 'MEDIUM');
      } catch (e) { return null; }
      return { x: x + f.dx, y: y + f.dy, w: f.w, h: f.h };
    }
  };

  global.IMG = IMG;
})(typeof window !== 'undefined' ? window : this);
