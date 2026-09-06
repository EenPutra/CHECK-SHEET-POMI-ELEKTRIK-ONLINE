> **PERINTAH UTAMA (cek setiap kali dokumen ini dibuka):** Cek **SEMUA fitur A sampai R di bawah, satu per satu, sampai tuntas** — jangan berhenti di tengah dan jangan cuma cek fitur yang "kelihatannya relevan" dari permintaan user. Urutannya: **A → B → C → D → E → F → G → H → I → J → K → L → M → N → O → P → Q → R**. Untuk tiap huruf: (1) baca isinya, (2) `grep` nama fungsi/id terkait di HTML tujuan, (3) bandingkan dengan versi di dokumen ini, (4) kalau beda/kurang → terapkan; kalau sudah sama → lanjut ke huruf berikutnya. Baru boleh dianggap selesai kalau ke-18 huruf (A–R) sudah dicek semua, walaupun user cuma minta "perbaiki crop modal" atau semacamnya — karena satu perbaikan sering menyeret fitur lain yang saling terhubung (mis. fix di B bisa berdampak ke C/D/E yang sama-sama pakai `imgArr`/`cropModalState`). **Jangan laporkan "sudah selesai" ke user sebelum benar-benar menuntaskan pengecekan A sampai R.**



# Fitur Reusable — Referensi dari `fegt.html`

## 📅 Riwayat Revisi Dokumen
> Setiap kali dokumen ini diupdate karena ada fitur/fix baru yang perlu direplikasi ke file lain, tambahkan baris baru di tabel ini (jangan timpa baris lama) — supaya gampang dibandingkan versi mana yang terakhir dicek ke suatu file.

| Versi | Tanggal | Perubahan |
|---|---|---|
| v1.12 | 2026-08-16 | **PENUTUP roll-out Fitur R (dan Fitur O di mana relevan) — 100% TUNTAS untuk seluruh repo.** Melengkapi 7 file yang tersisa dari audit v1.9: `beltscale-b12/e23/e45.html` (sudah punya Fitur O, ditambah Fitur R), `coal_feeder_calibration.html` (2 galeri berbagi 1 crop modal, ditambah Fitur R sekali), `form_o2_report.html` (sumber asli Fitur O/P/Q, di-backport Fitur R), `mark_vie_inspection.html` (Fitur R saja — **Fitur O TIDAK relevan**: `mvRowEvidence[i]` didesain khusus maksimal 1 foto per baris, bukan array multi-foto, jadi tidak ada yang bisa ditukar posisi), `material-warehouse.html` (Fitur R saja — **Fitur O TIDAK relevan**: setiap aset cuma punya SATU foto/`image_data` string tunggal, bukan array/galeri sama sekali; user secara eksplisit mengonfirmasi boleh menambah Fitur R meski ada catatan v1.11 soal file ini — Fitur R aman diterapkan karena cuma memutar pixel SUMBER sebelum crop, tidak menyentuh arsitektur penyimpanan `image_data` yang sudah ada). <br><br>**Rekap akhir seluruh 18 file bersistem crop preset:** Fitur R (Rotasi) ada di SEMUA 18 file. Fitur O (Urutkan Foto) ada di 15 file yang punya galeri multi-foto; TIDAK ADA (by design, bukan belum-dikerjakan) di 3 file dengan galeri maks-1-foto-per-slot: `generator_stator_leak_monitoring.html`, `mark_vie_inspection.html`, `material-warehouse.html`. |
| v1.11 | 2026-08-16 | **Audit penuh bug widthCm/heightCm/offsetX terbuang** (lanjutan v1.8/v1.10) ke SEMUA 18 file yang punya sistem crop preset. Hasil: **16 file sudah AMAN** (save & restore sudah menyertakan `widthCm`/`heightCm`/`offsetX` dengan benar, kadang lewat literal object langsung, kadang lewat statement `if` terpisah setelah literal — dua pola ini SAMA-SAMA valid, jangan disangka bug hanya karena field-nya tidak ada di dalam literal `{}`-nya): `beltscale-b12.html`, `beltscale-e23.html`, `beltscale-e45.html`, `cems_calibration.html` (evidence diteruskan sebagai object utuh, tidak di-strip sama sekali), `coal-silo-level.html`, `dcs-hmi-inspection.html`, `fegt.html`, `form_o2_report.html`, `generator_stator_leak_monitoring.html` (evidenceItems diteruskan utuh), `maintenance_report_form.html` (sections diteruskan utuh), `mark_vie_inspection.html`, `opacity.html`, `ph-analyzer.html`, `so2.html` (so2Photos diteruskan utuh). **3 file yang genuinely bug sudah diperbaiki di v1.8/v1.10**: `coal_feeder_calibration.html`, `flow-meter-fgd.html`, `pm-hg-analyzer.html`. **`material-warehouse.html` SENGAJA DIABAIKAN** dari fix ini atas keputusan user — foto di file ini disimpan sebagai string dataUrl polos ke kolom `image_data` (bukan object dengan metadata crop), `currentImageMeta.widthCm/heightCm/offsetX` memang tidak pernah dikirim ke database sejak awal (bukan 'dibuang', tapi arsitekturnya beda), dan fungsi `iePhotoDrawSize()` yang sudah dibuat untuk itu tidak pernah dipanggil di manapun (dead code). **PENTING kalau nanti ada permintaan terkait foto/PDF di file ini: JANGAN otomatis 'benerin' kode mati ini tanpa nanya dulu ke user apakah memang mau fitur itu diaktifkan** — sudah pernah ditanya dan user bilang abaikan. |
| v1.10 | 2026-08-16 | Fix **bug kritis widthCm/heightCm/offsetX terbuang saat simpan & restore** (sama seperti v1.8 di `coal_feeder_calibration.html`) ke 2 file lain yang punya masalah identik: `flow-meter-fgd.html` (fungsi `ki` di `dbCollectData` + mapping restore per-asset di `applyRecordToForm`) dan `pm-hg-analyzer.html` (fungsi `ki` di `dbCollectData` + mapping restore before/after di `hgRestoreRecord`). Di kedua file, kode PDF-nya sendiri sudah benar (`entry.widthCm||DEFAULT_CROP_W_CM`), jadi cukup pastikan `widthCm`/`heightCm`/`offsetX` ikut ke-preserve di jalur simpan+restore. |
| v1.8 | 2026-08-16 | **BUG KRITIS ditemukan & diperbaiki di `coal_feeder_calibration.html`:** `widthCm`/`heightCm`/`offsetX` (preset ukuran crop per foto) DIBUANG saat SIMPAN (`dbCollectData` → fungsi `ki`, dan `cf4kCollectData`) maupun saat BUKA ULANG dari history/draft (`applyRecordToForm`, `cf4kApplyData`) — di KEDUA galeri (utama + 4000HR). Akibatnya preset crop yang dipilih user tidak pernah benar-benar tersimpan ke database; setiap kali record dibuka ulang (history atau print-to-PDF dari halaman setelah edit), semua foto jatuh ke ukuran `DEFAULT_CROP_W_CM`x`DEFAULT_CROP_H_CM` (7.2x5.18cm) di PDF, menyebabkan foto tampak "penyet"/gepeng kalau rasio asli foto beda dari rasio default. Kode PDF-nya sendiri sebenarnya sudah benar (sudah menghormati `img.widthCm||DEFAULT`), masalahnya data itu tidak pernah sampai ke sana. Fix: keempat fungsi di atas sekarang ikut menyertakan `widthCm`/`heightCm`/`offsetX` (kalau ada) saat mapping object foto. **Bug identik ditemukan juga di `flow-meter-fgd.html` dan `pm-hg-analyzer.html` (belum diperbaiki, menunggu konfirmasi user).**
| v1.9 | 2026-08-15 | Roll-out **Fitur O + Fitur R** ke `so2.html` — melengkapi checklist manual yang dilacak user (11 file: cems_calibration, checksheet-temperature, coal-silo-level, dcs-hmi-inspection, maintenance_report_form, opacity, fegt, flow-meter-fgd, generator_stator_leak_monitoring, ph-analyzer, so2 — SEMUA selesai). Galeri generik `so2Photos[groupKey]` dapat tombol Urutkan Foto + panah kiri/kanan (Fitur O) via `renderPhotoGallery()`, dan tombol rotasi di crop modal (Fitur R). **Fitur Q TIDAK relevan** — caption sudah live-sync via `oninput` langsung ke array. <br><br>⚠️ **BELUM tuntas untuk seluruh repo** — audit ulang ditemukan 7 file lain yang punya `CROP_PRESETS` (sistem crop modal kanonis) tapi BELUM punya **Fitur R**: `beltscale-b12/e23/e45.html` (sudah ada Fitur O, R belum), `coal_feeder_calibration.html` (2 galeri, sudah ada Fitur O, R belum), `form_o2_report.html` (sumber asli Fitur O/P/Q, tapi R ditemukan belakangan jadi belum ke-backport ke sini), `mark_vie_inspection.html` dan `material-warehouse.html` (belum ada Fitur O ATAUPUN R sama sekali — belum pernah disentuh rollout ini). File-file ini TIDAK ada di checklist manual user di atas, jadi belum dikerjakan — nunggu konfirmasi user apakah mau dilanjutkan. |
| v1.7 | 2026-08-15 | Tambah **Fitur R (Rotasi Gambar)** ke `generator_stator_leak_monitoring.html`. **Fitur O (Urutkan Foto) TIDAK relevan** di file ini — galeri evidence-nya sengaja 1-foto-per-item (`item.images[0]`, `replaceIdx` selalu 0 kalau sudah ada foto), jadi tidak ada urutan untuk ditukar. Fitur Q juga tidak relevan dengan alasan yang sama. |
| v1.6 | 2026-08-15 | Lanjutan roll-out **Fitur O (Urutkan Foto) + Fitur R (Rotasi Gambar)** ke `flow-meter-fgd.html` (galeri `fmImages`, pola sama dengan `dcs-hmi-inspection.html`/`opacity.html`) — +fix Fitur Q laten: sync caption dari DOM yang jalan di awal `fmRenderPreviews` dihapus (redundan karena `oninput` sudah live-sync), dipindah jadi sync-before-mutate di `fmRemoveImg`/`imgReEditFm` saja. |
| v1.5 | 2026-08-15 | Lanjutan roll-out **Fitur O (Urutkan Foto) + Fitur R (Rotasi Gambar)** ke `fegt.html`: diterapkan ke KEDUA galeri Cleaning Hole — **CL** (`cleaningImages`, pola `document.createElement`, +fix Fitur Q laten: sync caption dari DOM yang jalan di awal `clRenderPreviews` dihapus, dipindah ke sebelum `splice` di `clRemoveImg`/`clReEdit` saja) dan **LD** (`ldCleaningImages`, pola `map().join('')`, Fitur Q TIDAK relevan karena caption sudah live-sync via `oninput` langsung tanpa fungsi sync-dari-DOM terpisah). Fitur R ditambahkan sekali di crop modal global file ini (satu modal dipakai bersama oleh CL & LD, jadi otomatis berlaku untuk keduanya). |
| v1.4 | 2026-08-15 | Tambah **Fitur R: Rotasi Gambar 90° di Crop Modal** (tombol ⟲/⟳ mengambang di crop modal, memutar foto SUMBER lewat canvas — beda dari Fitur K yang rotasi shape anotasi, bukan foto). Ditemukan sudah diterapkan di `pm-hg-analyzer.html` oleh sesi lain tapi belum pernah didokumentasikan. Mulai roll-out sistematis **Fitur O (Urutkan Foto) + Fitur R (Rotasi Gambar)** ke seluruh modul yang belum punya, satu file per commit/push. Diterapkan ke: `cems_calibration.html`, `checksheet-temperature.html` (O saja — tidak punya crop modal), `coal-silo-level.html` (+fix Fitur Q laten), `dcs-hmi-inspection.html` (+fix Fitur Q laten — sync caption redundan di awal render ketimpa nilai stale setelah hapus foto), `opacity.html` (galeri 7A/7B, +fix Fitur Q laten sama), `maintenance_report_form.html` (struktur beda — nested `sections[type][idx].images[]`, satu `renderSection()` render banyak item sekaligus, jadi Fitur O di-key per `type_idx`; Fitur Q TIDAK relevan di file ini karena caption cuma live-sync via `oninput` langsung ke array tanpa fungsi sync-dari-DOM terpisah; ditemukan & diperbaiki bonus: `ReferenceError` laten di onload alur "Edit Gambar" yang salah ketik `cropModalState` — variabel yang benar di file ini adalah `cropModal`).
| v1.3 | 2026-08-15 | Audit penuh `pm-hg-analyzer.html` terhadap Fitur A–Q. Ditemukan & diperbaiki 3 hal: (1) **Fitur A** — dropdown "Penyimpanan"/"Kamera" kepotong/tidak bisa diklik karena `position:absolute` di dalam tabel `overflow-x:auto` (efek clip vertikal ikut kena, sesuai perilaku standar CSS); fix pakai `position:fixed` dihitung dari `getBoundingClientRect()` tombolnya, ditambahkan sebagai catatan wajib-cek baru di Fitur A. (2) Input **"Keterangan"** foto belum ada sama sekali di galeri evidence-nya padahal field `caption` sudah ada di data model & PDF-mapping sejak lama — ditambahkan input-nya + render caption ke PDF. (3) **Fitur D** (Geser Posisi Gambar) ternyata "mati": CSS & fungsi `nudgeImageInArray` sudah ada, PDF-nya sudah baca `offsetX`, tapi tombol ◀▶-nya tidak pernah ditempel ke markup — diaktifkan. Ditambahkan juga catatan bahwa `mark_vie_inspection.html` SENGAJA tidak punya input caption (desain 1-foto-per-baris, caption otomatis dari label baris) — bukan gap yang perlu diperbaiki. |
| v1.2 | 2026-08-15 | Tambah **Fitur O: Urutkan Foto (Tukar Posisi Kiri/Kanan)**, **Fitur P: Header + Baris Foto Pertama Tidak Terpisah Halaman (page-break keep-together)**, dan **Fitur Q: Sinkronisasi Caption SEBELUM Array Diubah** (fix bug caption ketuker yang kejadian pas reorder maupun hapus foto). Ketiganya ditemukan/diterapkan pertama kali di `form_o2_report.html`. |
| v1.1 | 2026-08-14 | Tambah **Fitur N: Checkbox Vektor untuk PDF** (kotak+centang digambar via `drawCheckboxBs`, bukan karakter unicode `✓` yang tidak didukung font standar jsPDF dan tercetak sebagai titik). Perkuat **Fitur C (Crop Ulang)** dengan catatan wajib: foto hasil re-crop harus mengganti entry LAMA di index yang sama (`imgArr.splice(replaceIdx,1,entry)`), bukan dihapus lalu `push` ke akhir array — sebelumnya ini bikin foto pindah urutan ke paling akhir sementara keterangannya tertukar. Update contoh kode di **Fitur M** yang masih menampilkan pola `imgArr.push(entry)` lama. Diterapkan ke 15 file (14 HTML + `shared.js`), sumber: `coal_feeder_calibration.html`. |
| v1.0 | (sebelum dicatat) | Versi awal dokumen — Fitur A–M. |

---

> **Cara pakai dokumen ini (untuk Claude):** Saat user upload HTML lain dan minta salah satu/semua fitur di bawah diterapkan:
> 1. Baca dulu file yang diupload SECARA UTUH — cek struktur tabel/checksheet dan CSS/tema warnanya. **JANGAN diubah/disentuh.**
> 2. Untuk tiap fitur yang diminta: cek apakah file itu SUDAH punya fitur serupa (mis. sudah ada crop modal versi lama dari `shared.js` — lihat bagian "⚠️ Potensi Konflik" di tiap fitur). Kalau sudah ada, **gabungkan** (ambil yang kurang, jangan timpa total). Kalau belum ada, tempel kode dari dokumen ini lalu **adaptasi** placeholder (ditandai `{{ }}`) sesuai konteks file itu (nama variabel data, id elemen, dsb).
> 3. Fitur print/PDF: kalau perbedaannya besar (struktur tabel PDF beda total, bukan cuma nambah elemen) → **tanya dulu ke user** sebelum ubah. Kalau cuma nambah (preview, background template, dsb) → langsung kerjakan.
> 4. Kode di bawah ini sudah diringkas — sebelum ditempel, cek ulang nama fungsi & id supaya tidak bentrok dengan yang sudah ada di file tujuan.
> 5. **Struktur form (section collapse, badge counter, add/delete item, sync dom↔state) SENGAJA TIDAK dimasukkan** di dokumen ini — itu ditangani terpisah per file karena strukturnya beda-beda.
> 6. Kalau suatu fitur butuh konfigurasi tambahan yang cuma user yang tahu (nama modul, path file background, dst) — **jangan menebak**, tanyakan/ingatkan ke user apa yang kurang.

**Dependensi umum yang dipakai fitur-fitur di bawah:**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script> <!-- kalau butuh tabel -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script> <!-- untuk preview PDF -->
<script src="shared.js"></script>
```
Semua pakai `cdnjs.cloudflare.com` (bukan `unpkg.com`) — sesuai konvensi Tracking-Prevention-safe yang sudah berjalan.

---

## Daftar Fitur — Checklist A→Q (cek SEMUA, urut, jangan lompat)
- [ ] [A. Upload Gambar (kamera/galeri + convert + HEIC)](#a-upload-gambar)
- [ ] [B. Crop Modal 3-Mode (Default / Preset / Manual)](#b-crop-modal-3-mode)
- [ ] [C. Crop Ulang (✂️ scissors, re-edit tanpa upload baru)](#c-crop-ulang)
- [ ] [D. Geser Posisi Gambar di Hasil PDF (nudge + reflow)](#d-geser-posisi-gambar)
- [ ] [E. Drag/Resize Kotak Crop](#e-dragresize-kotak-crop)
- [ ] [F. Autosave Draft (pola `shared.js`)](#f-autosave-draft)
- [ ] [G. Loading Overlay (riwayat / simpan / export PDF)](#g-loading-overlay)
- [ ] [H. Background Template PDF](#h-background-template-pdf)
- [ ] [I. Preview PDF Sebelum Download (PDF.js canvas, mobile-safe)](#i-preview-pdf)
- [ ] [J. Edit Gambar (Insert Shape: Teks/Panah/Garis/Kotak/Oval)](#j-edit-gambar-insert-shape-teksfoto)
- [ ] [K. Rotasi Kotak & Oval](#k-rotasi-kotak--oval-ekstensi--belum-ada-di-fegthtml)
- [ ] [L. Tabel Info Pekerjaan — Grid Full-Width (Label | Value)](#l-tabel-info-pekerjaan--grid-full-width-label--value)
- [ ] [M. Upload Otomatis Foto ke Google Drive (backup, via shared.js)](#m-upload-otomatis-foto-ke-google-drive)
- [ ] [N. Checkbox Vektor untuk PDF (Y/N, Pass/Fail)](#n-checkbox-vektor-untuk-pdf)
- [ ] [O. Urutkan Foto (Tukar Posisi Kiri/Kanan)](#o-urutkan-foto-tukar-posisi-kirikanan)
- [ ] [P. Header + Baris Foto Pertama Tidak Terpisah Halaman](#p-header--baris-foto-pertama-tidak-terpisah-halaman)
- [ ] [Q. Sinkronisasi Caption SEBELUM Array Diubah](#q-sinkronisasi-caption-sebelum-array-diubah)
- [ ] [R. Rotasi Gambar 90° di Crop Modal](#r-rotasi-gambar-90-di-crop-modal)
- [ ] [Checklist Konfigurasi per File Baru](#checklist-konfigurasi)
- [ ] [⚠️ Potensi Konflik Global](#potensi-konflik-global)

> Checklist `[ ]` di atas cuma alat bantu baca — dokumen ini statis (bukan tempat centang beneran). Yang WAJIB: setiap kali menerapkan fitur ke HTML lain, telusuri A→M ini di kepala/kerja sendiri sampai semuanya ke-cek, baru selesai.

---

## A. Upload Gambar
**Tujuan:** user pilih sumber foto (kamera langsung / galeri), file dikonversi ke JPEG dataURL, siap dilempar ke crop modal.

**⚠️ POLA TERKINI (sejak beberapa file terakhir) — bukan lagi pola `triggerUpload`/`fileInput` tunggal di bawah:** file-file yang sudah direvisi (`form_o2_report.html`, `pm-hg-analyzer.html`, `coal_feeder_calibration.html`, dll) pakai pola **1 `<input type="file" multiple>` PER slot galeri** (id dinamis per channel/step/item), dengan tombol "+" yang toggle dropdown "Penyimpanan"/"Kamera" via `toggleSourceChoices(elementId)` + `openFileInputSource(inputId, source)` (keduanya dari `shared.js`, signature 1-2 argumen — BUKAN pola 2-argumen `toggleSourceChoices(type, idx)` di kode contoh bawah, itu sudah usang). Upload banyak file sekaligus (`multiple`) dialihkan ke `puHandleMultiUpload(fileArr, imgArr, side, modulePrefix)` (skip-crop otomatis, lihat Fitur N di bawah); upload 1 file tetap lewat `imgOpenCropper(...)` seperti biasa (buka crop modal). **Cek dulu file tujuan pakai pola yang mana sebelum menempel kode contoh Fitur A di bawah** — kode contoh ini cuma fallback untuk file yang belum punya upload sama sekali.

**⚠️ BUG DITEMUKAN (Agustus 2026, `pm-hg-analyzer.html`) — dropdown Penyimpanan/Kamera "kepotong"/tidak bisa diklik:** kalau tombol "+" upload ditaruh **di dalam tabel yang dibungkus elemen `overflow-x:auto`** (mis. class `.preview-wrap` di `shared.css`, dipakai buat tabel lebar yang perlu di-scroll horizontal di HP), dropdown pilihan sumber (`position:absolute` relatif ke tombol) sering **kepotong dan tidak kelihatan/tidak bisa diklik**. Penyebabnya: `overflow-x:auto` tanpa `overflow-y` eksplisit membuat browser otomatis mengubah `overflow-y` jadi `auto` juga (perilaku standar CSS) — jadi arah vertikal ikut ke-clip, bukan cuma horizontal. Ini gampang lolos dari review kode karena tidak kelihatan dari HTML/JS-nya doang, baru ketahuan pas dites di tabel yang benar-benar lebar/banyak baris.
**Fix:** dropdown-nya JANGAN `position:absolute`, pakai **`position:fixed`** yang dihitung dari `getBoundingClientRect()` tombol saat diklik (jadi lolos dari clipping ancestor manapun):
```js
function xxOpenSrcMenu(anchorEl, elId) {
  var el = document.getElementById(elId);
  if (!el) return;
  var alreadyOpen = (el.style.display === 'flex' || el.style.display === 'block');
  document.querySelectorAll('[id^="xxSrc_"]').forEach(function(d){ d.style.display = 'none'; }); // tutup dropdown lain yg masih terbuka
  if (alreadyOpen) return;
  var r = anchorEl.getBoundingClientRect();
  el.style.display = 'block';
  var elW = el.offsetWidth || 150, elH = el.offsetHeight || 90;
  var left = Math.min(Math.max(8, r.left), window.innerWidth - elW - 8);
  var top = r.bottom + 4;
  if (top + elH > window.innerHeight - 8) top = r.top - elH - 4; // kalau kepotong di bawah layar, tampil di ATAS tombol
  el.style.left = left + 'px'; el.style.top = top + 'px';
}
```
Lalu HTML dropdown-nya: `style="display:none;position:fixed;...;z-index:9999"` (bukan `position:absolute;top:...px`), dan tombol "+" pakai `onclick="xxOpenSrcMenu(this,'xxSrc_...')"` (kirim `this` sebagai anchor). **Cek dulu apakah upload button di file tujuan ada di dalam elemen `overflow-x:auto`/`overflow:auto`/`overflow:scroll`** — kalau tidak (mis. galeri berdiri sendiri di luar tabel, seperti di `form_o2_report.html`), bug ini tidak terjadi dan tidak perlu fix ini.

**⚠️ Potensi Konflik:** `shared.js` sudah py fungsi serupa: `fileToJpegDataUrl(file, callback)` + `strategy2()` — lebih baik dari versi lokal di bawah karena sudah otomatis panggil `showImgLoading()`/`hideImgLoading()` dan `showHeicWarning()` untuk file HEIC. **Kalau file tujuan sudah manggil `fileToJpegDataUrl` dari shared.js, JANGAN diganti** — biarkan pakai itu. Kode di bawah hanya untuk file yang belum punya converter sama sekali.

**📝 Soal input "Keterangan"/caption per foto — bukan bagian resmi Fitur A, tapi sering dicek bareng:** hampir semua file dengan galeri multi-foto (banyak foto per section/channel/step) punya `<input placeholder="Keterangan"...>` atau `placeholder="Caption..."` (nama placeholder BEDA-BEDA antar file, jangan cuma grep 1 kata) yang nulis ke `imgArr[idx].caption` lewat `oninput`, lalu dibaca lagi di generator PDF buat dicetak di bawah foto. **Pengecualian yang VALID (bukan bug):** file dengan pola **1 foto per baris checklist** (mis. `mark_vie_inspection.html`) sengaja TIDAK punya input caption terpisah — caption di PDF-nya diambil otomatis dari label baris checklist itu sendiri (`{caption: label baris}`), karena sudah jelas foto itu punya konteks apa tanpa perlu diketik ulang. **Cek dulu pola galerinya (banyak-foto-bebas vs satu-foto-per-baris) sebelum menyimpulkan caption "belum ada" itu gap atau memang desain yang disengaja.**

```html
<!-- tombol sumber upload -->
<div class="source-choices" id="sourceChoices-{{type}}-{{idx}}" style="display:none">
    <button type="button" onclick="triggerUpload('{{type}}',{{idx}},-1,'camera')">📷 Kamera</button>
    <button type="button" onclick="triggerUpload('{{type}}',{{idx}},-1,'storage')">🖼️ Galeri</button>
</div>
<input type="file" id="fileInput" accept="image/*" style="display:none">
```

```js
function toggleSourceChoices(type, idx) {
    var el = document.getElementById('sourceChoices-'+type+'-'+idx);
    if (!el) return;
    el.style.display = (el.style.display === 'flex' || el.style.display === 'block') ? 'none' : 'flex';
}

function triggerUpload(type, idx, replaceIdx, source) {
    cropModal._pending = {type:type, idx:idx, replaceIdx:replaceIdx};
    var choiceEl = document.getElementById('sourceChoices-'+type+'-'+idx);
    if (choiceEl) choiceEl.style.display = 'none';
    openFileInputSource('fileInput', source || 'storage'); // openFileInputSource ada di shared.js
}

document.getElementById('fileInput').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    // PAKAI shared.js kalau tersedia:
    if (typeof fileToJpegDataUrl === 'function') {
        fileToJpegDataUrl(file, function(dataUrl) { if (dataUrl) openCropModal(dataUrl); });
        return;
    }
    // fallback lokal (dipakai HANYA kalau shared.js versi lama/tidak punya fileToJpegDataUrl):
    fileToDataUrlLocal(file, function(dataUrl) { if (dataUrl) openCropModal(dataUrl); });
});

function fileToDataUrlLocal(file, callback) {
    var looksLikeImage = file && (/^image\//i.test(file.type||'') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name||''));
    if (!looksLikeImage) { alert('File harus berupa gambar.'); callback(null); return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
        var img = new Image();
        img.onload = function() {
            try {
                var c = document.createElement('canvas');
                var maxSide = 1800;
                var scale = Math.min(maxSide/(img.naturalWidth||maxSide), maxSide/(img.naturalHeight||maxSide), 1);
                c.width = Math.max(1, Math.round((img.naturalWidth||800)*scale));
                c.height = Math.max(1, Math.round((img.naturalHeight||600)*scale));
                c.getContext('2d').drawImage(img,0,0,c.width,c.height);
                callback(c.toDataURL('image/jpeg', 0.92));
            } catch(e) { callback(ev.target.result); }
        };
        img.onerror = function() {
            var ext = (file.name||'').split('.').pop().toLowerCase();
            if ((ext==='heic'||ext==='heif') && typeof showHeicWarning === 'function') showHeicWarning();
            else alert('Format gambar tidak bisa diproses. Gunakan JPG atau PNG.');
            callback(null);
        };
        img.src = ev.target.result;
    };
    reader.onerror = function() { alert('Gagal membaca file'); callback(null); };
    reader.readAsDataURL(file);
}
```
**Butuh dari user:** tidak ada — otomatis pakai `shared.js` kalau ada.

---

## B. Crop Modal 3-Mode
**Tujuan:** setelah pilih foto, user crop dengan 3 pilihan mode:
- **Default** — langsung 7.2×5.18cm (tidak perlu isi apa-apa), kotak crop = seluruh gambar (tidak dipotong).
- **Preset** — pilih rasio (3:2/4:3/5:4/16:9/A4/Letter) + orientasi Potrait/Lanskap, isi salah satu Panjang/Lebar, sisi lain otomatis mengikuti rasio. Sisi acuan (long side) default **7cm** (⚠️ direvisi lagi dari 10cm, lihat poin 7 di bawah). Cap tiap sisi sekarang **terpisah**: Panjang (horizontal) vs Lebar (vertikal) punya batas beda-beda, dihitung dari margin PDF file itu sendiri — bukan angka tunggal 20cm lagi (lihat poin 7).
- **1:1** — **preset terpisah, BUKAN bagian dari daftar rasio Preset di atas** dan tidak terpengaruh toggle Potrait/Lanskap (bujur sangkar tidak punya orientasi). Klik tombol 1:1 → kotak langsung jadi persegi, klik Potrait/Lanskap saat 1:1 aktif tidak mengubah bentuk kotak.
- **Manual** — bebas, kedua sisi punya batas terpisah (Panjang vs Lebar), lihat poin 7 di bawah untuk cara hitungnya per file.

**🆕 Update penting (per revisi terbaru, wajib ada di semua file yang pakai crop modal ini):**
1. **Kotak crop selalu reset ke ukuran PENUH gambar dulu**, sebelum ukuran/rasio mode yang baru diterapkan — dipicu di 2 titik: (a) setiap pindah tab **Default/Preset/Manual** (di `setCropMode()`), dan (b) setiap toggle **Potrait ↔ Lanskap** saat masih di tab Preset (di `setCropOrientation()`). Sebelum fix ini, box dihitung ulang dari sisa posisi/ukuran box SEBELUMNYA (stale) — akibatnya box kelihatan kekecilan/nyangkut di posisi lama dan user harus geser-geser manual dulu.
2. **1:1 dipisah total dari daftar `CROP_PRESETS`** (yang dulu isinya `1:1, 3:2, 4:3, 5:4, 16:9, A4, Letter`) — sekarang `CROP_PRESETS` cuma `3:2, 4:3, 5:4, 16:9, A4, Letter`, dan 1:1 jadi tombol+fungsi sendiri (`applySquarePreset()`) di baris terpisah di bawah tombol Potrait/Lanskap.
3. `PRESET_DEFAULT_LONG_CM` naik dari **4cm → 10cm**.
4. `MANUAL_MAX_CM` naik dari **7cm → 20cm**, dan cap preset (`longMax`/`shortMax` di `getMaxForField`) yang dulu hardcode `7`/`5` sekarang ikut `MANUAL_MAX_CM` (jadi `20`/`20`, bukan `7`/`5` lagi). Atribut HTML `max="7"` di kedua input cm (`cropWcm`/`cropHcm`) juga ikut naik jadi `max="20"`.
5. **Klik Potrait/Lanskap saat preset 1:1 lagi aktif → kotak dikembalikan ke ukuran PENUH gambar dan status 1:1 dilepas** (`_activePresetIdx=-1`, tidak ada preset aktif, label ganti jadi "Pilih salah satu rasio di bawah") — **BUKAN** auto-menerapkan salah satu rasio. Ini revisi ke-2: percobaan pertama (`applyPreset(lastRatioPresetIdx)` otomatis) ternyata salah — box malah kelihatan "mengecil tiba-tiba" karena rasio manapun yang jauh dari bentuk asli gambar (mis. preset 16:9 potrait di foto 4:3) pasti menghasilkan box lebih kecil dari full image; itu secara matematis benar tapi bukan yang diinginkan user saat mereka bilang "kembalikan ke full". Jadi user memang harus klik salah satu tombol rasio (3:2/4:3/dst) SETELAHNYA secara manual untuk memilih bentuknya — `cropModal._lastRatioPresetIdx` (dicatat tiap `applyPreset(i)` dipanggil) TETAP dipakai, tapi hanya di `setCropMode()` (dispatch pas pindah TAB balik ke Preset), bukan di `setCropOrientation()`.
6. **🆕 (revisi ke-3) Klik 1:1 → tombol Potrait/Lanskap harus ikut dilepas statusnya** (`classList.remove('active')` pada `cropOrientPotrait` dan `cropOrientLandscape`, di dalam `applySquarePreset()`). Sebelum fix ini, kalau user sempat aktifkan Potrait/Lanskap dulu lalu klik 1:1, tombol orientasi itu TETAP kelihatan aktif (hijau) berbarengan dengan tombol 1:1 — padahal 1:1 tidak punya orientasi. Ini bukan cuma bug visual: tombol orientasi yang "nyangkut aktif" itu adalah akar penyebab bug lama di poin 5 (box "mengecil tiba-tiba" saat pindah 1:1 → Potrait/Lanskap) — begitu tombol orientasi dilepas statusnya secara eksplisit di `applySquarePreset()`, tidak ada state orientasi basi yang bisa ikut kebaca lagi setelahnya.
7. **🆕 (revisi ke-4) Bug hapus angka ukuran (Panjang/Lebar) tidak bisa dikosongkan untuk diketik ulang** — plus batas maksimal Manual dipecah jadi per-sumbu (bukan satu angka lagi).
   - **Gejala:** saat user coba hapus angka di field "Panjang (cm)" / "Lebar (cm)" untuk ganti ke angka baru, field langsung "dipaksa" balik ke angka lain (mis. 0.5) sebelum sempat mengetik angka barunya — field jadi seperti tidak bisa dikosongkan.
   - **Akar masalah:** input `cropWcm`/`cropHcm` cuma punya `oninput`, tanpa `onblur`. Handler `onCustomCmChange` (dan `onPresetFieldChange` di mode Preset) langsung clamp + tulis-ulang nilai ke input di **setiap keystroke**. Begitu field dikosongkan (`''`), `clampCmValue('')` → `NaN` → fallback ke `0.5` → langsung ditulis balik ke field sebelum user sempat mengetik digit berikutnya.
   - **Fix:** pisahkan `oninput` dari `onblur`:
     - `onCustomCmChange(field)` (di `oninput`) — HANYA update preview kotak crop kalau angkanya valid & positif; kalau field kosong/`NaN`, fallback ke nilai tersimpan sebelumnya (`cropModal(State)._cropWcm/_cropHcm`), dan **tidak pernah** menimpa balik nilai input yang sedang diketik.
     - `onCustomCmCommit(field)` (fungsi baru, dipasang di `onblur`) — baru di sini nilai di-clamp ke batas min/max, dibulatkan 1 desimal, dan ditulis ulang ke input.
     - `onPresetFieldChange(field, commit)` dapat parameter `commit` (boolean): `commit=false` (dipanggil dari oninput) → kalau field kosong/`NaN`, langsung `return` tanpa memaksa apa-apa; `commit=true` (dipanggil dari onblur) → barulah fallback `0.5` diterapkan kalau masih kosong, dan nilai ditulis balik ke input.
     - Tambahkan `onblur="onCustomCmCommit('w')"` / `onCustomCmCommit('h')` ke kedua input HTML `cropWcm`/`cropHcm`.
   - **Sekalian direvisi (poin ini juga menggantikan angka lama di poin 3-4 di atas):** `PRESET_DEFAULT_LONG_CM` turun dari 10cm → **7cm**. `MANUAL_MAX_CM` (satu angka untuk kedua sisi) dipecah jadi **`MANUAL_MAX_W_CM`** (Panjang/horizontal — dibatasi ketat karena kalau kelebihan lebar kertas A4, box otomatis dikecilkan) dan **`MANUAL_MAX_H_CM`** (Lebar/vertikal — lebih longgar karena kalau kelebihan cuma pindah halaman, bukan mengecil diam-diam). Nilainya **dihitung per file** dari margin PDF-nya masing-masing (bukan angka tetap 20/20 lagi):
     `MANUAL_MAX_W_CM = (210mm − marginX×2 − buffer 6mm) / 10`,
     `MANUAL_MAX_H_CM = (297mm − marginTop − marginBottom − buffer 7mm) / 10`.
     `getMaxForField(field)` disederhanakan jadi `return field === 'w' ? MANUAL_MAX_W_CM : MANUAL_MAX_H_CM;` — tidak lagi tergantung mode (Preset/Manual) atau orientasi (Potrait/Lanskap). `applySquarePreset()` pakai `Math.min(PRESET_DEFAULT_LONG_CM, MANUAL_MAX_W_CM, MANUAL_MAX_H_CM)`.
     Contoh nilai yang sudah dihitung: margin 15/20/30mm → W=17.4cm, H=24cm; margin 20/20/20mm → W=16.4cm, H=25cm; margin 25/25/25mm → W=15.4cm, H=24cm.
8. **🆕 (revisi ke-5) Foto evidence rata tengah (center) saat print to PDF**, bukan rata kiri seperti sebelumnya. Ini di luar crop modal itu sendiri (terjadi di kode PDF-export, fungsi yang menggambar foto ke `doc.addImage`), tapi terkait erat karena posisi X akhirnya tetap perlu menghormati `widthCm`/`heightCm` hasil crop. Caranya beda tergantung layout foto di tiap file:
   - **Layout 1-foto-per-baris** (foto flow satu-satu ke bawah): pusatkan foto terhadap `contentW` penuh — ganti titik awal X dari `marginX+3` (rata kiri) jadi `marginX + (contentW - lebarFoto)/2`.
   - **Layout 2-kolom-tetap** (mis. Before | After bersebelahan): pusatkan foto **di dalam kolomnya sendiri** (`colW`), bukan di dalam halaman penuh — supaya Before dan After tetap sejajar kiri-kanan, cuma foto di dalam tiap kolom yang dipusatkan: `xKolom + (colW - lebarFoto)/2`.
   - **Layout flow multi-ukuran** (ukuran foto macam-macam sesuai hasil crop, wrap otomatis ke baris baru): perlu direstruktur jadi **2 pass** — Pass 1 kelompokkan gambar ke baris-baris dulu (butuh tahu total lebar 1 baris sebelum bisa dipusatkan), Pass 2 baru gambar tiap baris rata tengah terhadap `contentW` (`curX = marginX + (contentW - totalRowW) / 2`, lalu tiap foto di baris itu digambar berurutan mulai dari `curX`).
   - Nudge geser manual per-foto (`offsetX`) di semua layout di atas tetap jalan, ditambahkan di atas posisi tengah yang baru (`... + (img.offsetX||0)*10`), lalu tetap di-clamp ke batas halaman (`Math.max(marginX, Math.min(..., pw-marginX-lebarFoto))`) supaya nudge tidak bisa mendorong foto keluar halaman.

**⚠️ Potensi Konflik BESAR:** `shared.js` sudah punya crop engine generik sendiri dengan nama fungsi **SAMA PERSIS**: `cropReset()`, `cropAndSave()`, `skipCrop()`, `imgOpenCropper()`. Kalau file tujuan MASIH memanggil `imgOpenCropper(...)` di tombol upload-nya (pola lama, ukuran dalam PIXEL bukan CM, tanpa mode Default/Preset/Manual) — deklarasi fungsi baru di `<script>` inline file itu (dimuat setelah `shared.js`) akan **menimpa** punya `shared.js` secara otomatis karena global function declaration terakhir yang menang. Ini AMAN selama seluruh alur upload di file itu diarahkan ke `openCropModal()` versi baru (bukan campur aduk manggil `imgOpenCropper` di satu tempat dan `openCropModal` di tempat lain). **Cek dulu semua pemanggil crop di file tujuan, ganti semua ke `openCropModal(dataUrl)` / `triggerUpload(...)` versi baru ini secara konsisten.**

```html
<!-- Taruh sebelum </body>, sekali saja per halaman -->
<div id="cropModal">
    <div class="crop-dialog">
        <div class="crop-header">
            <div class="crop-header-title">✂️ Crop Gambar</div>
            <div class="crop-header-hint">Drag pojok/sisi untuk resize • Drag tengah untuk pindah</div>
        </div>
        <div id="cropWrap">
            <img id="cropImg" src="">
            <div id="cropBox">
                <div class="crop-handle nw"></div><div class="crop-handle ne"></div>
                <div class="crop-handle sw"></div><div class="crop-handle se"></div>
                <div class="crop-handle n"></div><div class="crop-handle s"></div>
                <div class="crop-handle w"></div><div class="crop-handle e"></div>
                <div class="crop-grid"></div>
            </div>
        </div>
        <div class="crop-footer">
            <div class="crop-size-panel">
                <div class="crop-size-row" id="cropModeRow">
                    <button type="button" class="crop-mode-btn" id="cropModeDefault" onclick="setCropMode('default')">⭐ Default</button>
                    <button type="button" class="crop-mode-btn" id="cropModePreset" onclick="setCropMode('preset')">▦ Preset</button>
                    <button type="button" class="crop-mode-btn" id="cropModeManual" onclick="setCropMode('manual')">✋ Manual</button>
                </div>
                <div class="crop-default-label" id="cropDefaultLabel" style="display:none">Ukuran cetak: 7.2 × 5.18 cm — gambar penuh (tidak dipotong)</div>
                <div id="cropPresetControls" style="display:none">
                    <div class="crop-size-row" id="cropPresetRow"></div>
                    <div class="crop-size-row" style="margin-top:8px">
                        <button type="button" class="crop-orient-btn" id="cropOrientPotrait" onclick="setCropOrientation('portrait')">⬍ Potrait</button>
                        <button type="button" class="crop-orient-btn" id="cropOrientLandscape" onclick="setCropOrientation('landscape')">⬌ Lanskap</button>
                    </div>
                    <div class="crop-size-row" style="margin-top:8px">
                        <button type="button" class="crop-preset-btn" id="cropPresetSquare" onclick="applySquarePreset()" title="Rasio 1:1 berdiri sendiri, tidak ikut Potrait/Lanskap">◻ 1:1</button>
                    </div>
                </div>
                <div class="crop-size-row" id="cropCmRow" style="margin-top:8px;display:none">
                    <div class="crop-cm-field"><label>Panjang (cm)</label><input type="number" id="cropWcm" min="0.5" max="16.4" step="0.1" value="5" oninput="onCustomCmChange('w')" onblur="onCustomCmCommit('w')"></div>
                    <div class="crop-cm-field"><label>Lebar (cm)</label><input type="number" id="cropHcm" min="0.5" max="25" step="0.1" value="5" oninput="onCustomCmChange('h')" onblur="onCustomCmCommit('h')"></div>
                    <!-- ⚠️ max="16.4"/max="25" di atas cuma contoh (margin PDF 20/20/20mm) -- HITUNG ULANG per file
                         sesuai margin PDF-nya sendiri, lihat rumus & tabel contoh di poin 7. -->
                    <div class="crop-size-label" id="cropSizeLabel">Bebas (ukuran default saat cetak)</div>
                </div>
            </div>
            <div class="crop-btns">
                <button class="crop-btn crop-btn-outline" onclick="cropReset()">↺ Reset</button>
                <button class="crop-btn crop-btn-outline" onclick="closeCropModal()">Batal</button>
                <button class="crop-btn crop-btn-save" onclick="cropAndSave()">✓ Simpan</button>
            </div>
        </div>
    </div>
</div>
```

```css
/* Struktural saja — sesuaikan warna (#1a221e dkk) ke tema file tujuan kalau perlu */
#cropModal{display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.85);flex-direction:column;align-items:center;justify-content:center;padding:12px}
#cropModal.show{display:flex}
.crop-dialog{background:#1a221e;border:1px solid #2a3a30;border-radius:10px;width:min(96vw,540px);overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5)}
.crop-header{background:#243228;padding:10px 16px;display:flex;align-items:center;justify-content:space-between}
.crop-header-title{font-weight:700;font-size:13px;color:#e0f0e8;letter-spacing:0.5px}
.crop-header-hint{font-size:10px;color:#8aab96}
#cropWrap{position:relative;width:100%;height:min(55vw,320px);background:#111;overflow:hidden;user-select:none;-webkit-user-select:none}
#cropImg{position:absolute;max-width:none;pointer-events:none;display:block}
#cropBox{position:absolute;border:2px solid #2ecc71;box-shadow:0 0 0 9999px rgba(0,0,0,0.45);cursor:move;touch-action:none;min-width:40px;min-height:40px}
.crop-handle{position:absolute;width:12px;height:12px;background:#2ecc71;border-radius:2px}
.crop-handle.nw{top:-6px;left:-6px;cursor:nw-resize} .crop-handle.ne{top:-6px;right:-6px;cursor:ne-resize}
.crop-handle.sw{bottom:-6px;left:-6px;cursor:sw-resize} .crop-handle.se{bottom:-6px;right:-6px;cursor:se-resize}
.crop-handle.n{width:10px;height:10px;top:-5px;left:50%;transform:translateX(-50%);cursor:n-resize}
.crop-handle.s{width:10px;height:10px;bottom:-5px;left:50%;transform:translateX(-50%);cursor:s-resize}
.crop-handle.w{width:10px;height:10px;left:-5px;top:50%;transform:translateY(-50%);cursor:w-resize}
.crop-handle.e{width:10px;height:10px;right:-5px;top:50%;transform:translateY(-50%);cursor:e-resize}
.crop-grid{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;background:
  repeating-linear-gradient(0deg,transparent,transparent 33.3%,rgba(255,255,255,0.08) 33.3%,rgba(255,255,255,0.08) 33.4%,transparent 33.4%,transparent 66.6%,rgba(255,255,255,0.08) 66.6%,rgba(255,255,255,0.08) 66.7%,transparent 66.7%),
  repeating-linear-gradient(90deg,transparent,transparent 33.3%,rgba(255,255,255,0.08) 33.3%,rgba(255,255,255,0.08) 33.4%,transparent 33.4%,transparent 66.6%,rgba(255,255,255,0.08) 66.6%,rgba(255,255,255,0.08) 66.7%,transparent 66.7%)}
.crop-footer{padding:10px 14px;background:#1a221e;border-top:1px solid #2a3a30}
.crop-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
.crop-btn{padding:7px 16px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600}
.crop-btn-outline{background:transparent;border:1px solid #4a6a55;color:#aac8b5}
.crop-btn-save{background:#2ecc71;color:#fff}
.crop-size-panel{border-top:1px solid #2a3a30;padding-top:8px;margin-top:2px}
.crop-size-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.crop-preset-btn,.crop-orient-btn,.crop-mode-btn{padding:5px 10px;border-radius:6px;border:1px solid #3a4f42;background:#222e26;color:#aac8b5;font-size:11px;font-weight:600;cursor:pointer}
.crop-preset-btn.active,.crop-orient-btn.active,.crop-mode-btn.active{background:#2ecc71;color:#0e150f;border-color:#2ecc71}
.crop-mode-btn{padding:6px 12px;font-size:12px}
.crop-cm-field{display:flex;flex-direction:column;gap:2px}
.crop-cm-field label{font-size:9px;color:#8aab96;font-weight:600}
.crop-cm-field input{width:64px;padding:5px 6px;font-size:12px;border-radius:5px;border:1px solid #3a4f42;background:#0f1512;color:#e0f0e8}
.crop-size-label{font-size:11px;color:#7fd9a4;font-weight:600;margin-left:4px}
.crop-default-label{font-size:12px;color:#7fd9a4;font-weight:600;padding:4px 2px}
```

```js
// ── STATE (tambahkan ke deklarasi state utama file) ──
var cropModal = document.getElementById('cropModal');
cropModal._pending = null;
cropModal._ratioLocked = false;
cropModal._cropWcm = null;
cropModal._cropHcm = null;
cropModal._orientation = 'portrait';
cropModal._activePresetIdx = -1;
cropModal._lastRatioPresetIdx = -1; // 🆕 ingat preset rasio (bukan 1:1) terakhir dipakai
cropModal._mode = 'default';
cropModal._presetRatio = 1;

var DEFAULT_CROP_W_CM = 7.2, DEFAULT_CROP_H_CM = 5.18;
var PRESET_DEFAULT_LONG_CM = 10;   // 🆕 dulu 4
var MANUAL_MAX_CM = 20;            // 🆕 dulu 7
var CROP_PRESETS = [               // 🆕 1:1 SUDAH TIDAK di sini — lihat applySquarePreset()
    {label:'3:2', w:3, h:2}, {label:'4:3', w:4, h:3},
    {label:'5:4', w:5, h:4}, {label:'16:9', w:16, h:9}, {label:'A4', w:210, h:297}, {label:'Letter', w:216, h:279}
];

function renderPresetButtons() {
    var row = document.getElementById('cropPresetRow');
    if (!row) return;
    row.innerHTML = '';
    CROP_PRESETS.forEach(function(p, i) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'crop-preset-btn'; btn.id = 'cropPreset-'+i;
        btn.textContent = p.label; btn.onclick = function () { applyPreset(i); };
        row.appendChild(btn);
    });
}
function highlightPreset(activeIdx) {
    CROP_PRESETS.forEach(function (p, idx) {
        var btn = document.getElementById('cropPreset-'+idx);
        if (btn) btn.classList.toggle('active', idx === activeIdx);
    });
    // 🆕 1:1 berdiri sendiri di luar daftar rasio — begitu salah satu preset
    // rasio (yang ikut Potrait/Lanskap) dipilih, tombol 1:1 ikut nonaktif,
    // dan sebaliknya (lihat applySquarePreset()).
    var sq = document.getElementById('cropPresetSquare');
    if (sq) sq.classList.toggle('active', activeIdx === 'square');
}
// 🆕 Preset 1:1 sengaja dipisah dari CROP_PRESETS supaya TIDAK ikut
// terpengaruh toggle Potrait/Lanskap (bujur sangkar tidak punya orientasi).
function applySquarePreset() {
    cropModal._activePresetIdx = 'square';
    var side = Math.min(PRESET_DEFAULT_LONG_CM, MANUAL_MAX_CM);
    cropModal._presetRatio = 1;
    fitCropBoxToFullImage(); // selalu mulai dari full image dulu sebelum diperkecil ke 1:1
    setLockedSize(side, side);
    highlightPreset('square');
    // 🆕🆕 (revisi ke-3) 1:1 tidak punya orientasi — lepas status aktif tombol
    // Potrait/Lanskap begitu 1:1 dipencet, supaya tidak kelihatan dua-duanya
    // aktif bersamaan. Ini juga akar penyebab bug "box mengecil tiba-tiba"
    // saat pindah dari 1:1 balik ke Potrait/Lanskap — karena sebelumnya
    // tombol orientasi yang "nyangkut aktif" dari state sebelum 1:1 ikut
    // ke-baca statusnya, bukan benar-benar netral.
    var pB = document.getElementById('cropOrientPotrait'), lB = document.getElementById('cropOrientLandscape');
    if (pB) pB.classList.remove('active');
    if (lB) lB.classList.remove('active');
}
function getMaxForField(field) {
    if (cropModal._mode === 'preset') {
        var longMax=MANUAL_MAX_CM, shortMax=MANUAL_MAX_CM; // 🆕 dulu hardcode 7/5, sekarang ikut MANUAL_MAX_CM (20/20)
        if (cropModal._orientation === 'landscape') return field==='w' ? longMax : shortMax;
        return field==='w' ? shortMax : longMax;
    }
    if (cropModal._mode === 'manual') return MANUAL_MAX_CM;
    return 99;
}
function clampCmValue(v, maxV) {
    v = parseFloat(v);
    if (!isFinite(v) || v<=0) v=0.5;
    if (v>maxV) v=maxV;
    if (v<0.5) v=0.5;
    return Math.round(v*10)/10;
}
// 🆕 Bikin kotak crop menutupi SELURUH gambar (posisi & ukuran = gambar apa
// adanya di dalam #cropWrap). Dipanggil di awal setCropMode() (tiap pindah
// tab), di applyDefaultSize(), applySquarePreset(), dan setCropOrientation()
// (tiap toggle Potrait/Lanskap) — supaya box SELALU mulai dari "penuh" dulu
// sebelum di-reshape ke ukuran/rasio mode yang baru dipilih.
function fitCropBoxToFullImage() {
    var box = document.getElementById('cropBox');
    var img = document.getElementById('cropImg');
    if (!box || !img) return;
    var iL = parseInt(img.style.left) || 0, iT = parseInt(img.style.top) || 0;
    var iW = img.offsetWidth, iH = img.offsetHeight;
    if (!iW || !iH) return;
    box.style.left = iL + 'px'; box.style.top = iT + 'px';
    box.style.width = iW + 'px'; box.style.height = iH + 'px';
}
function setCropMode(mode) {
    cropModal._mode = mode;
    ['Default','Preset','Manual'].forEach(function(m){
        var b = document.getElementById('cropMode'+m);
        if (b) b.classList.toggle('active', mode === m.toLowerCase());
    });
    var presetControls = document.getElementById('cropPresetControls');
    var cmRow = document.getElementById('cropCmRow');
    var defaultLabel = document.getElementById('cropDefaultLabel');
    // 🆕 Selalu mulai dari kotak crop yang menutupi SELURUH gambar dulu setiap
    // pindah tab (Default/Preset/Manual), supaya user tidak perlu geser2
    // manual kalau kotak sebelumnya kekecilan/nyangkut di posisi lama.
    fitCropBoxToFullImage();
    if (mode === 'default') {
        presetControls.style.display='none'; cmRow.style.display='none'; defaultLabel.style.display='block';
        highlightPreset(-1); applyDefaultSize();
    } else if (mode === 'preset') {
        presetControls.style.display='block'; cmRow.style.display='flex'; defaultLabel.style.display='none';
        // 🆕 dispatch ke applySquarePreset() kalau preset terakhir aktif adalah 1:1
        if (cropModal._activePresetIdx === 'square') applySquarePreset();
        else applyPreset((cropModal._activePresetIdx === -1 || cropModal._activePresetIdx == null) ? 0 : cropModal._activePresetIdx);
    } else {
        presetControls.style.display='none'; cmRow.style.display='flex'; defaultLabel.style.display='none';
        highlightPreset(-1);
        setFreeSize(cropModal._cropWcm||5, cropModal._cropHcm||5);
    }
}
function applyDefaultSize() {
    // 🆕 Default = gambar penuh, TIDAK dipotong — makanya pakai
    // fitCropBoxToFullImage() (kotak = seluruh gambar), bukan
    // reshapeCropBoxToRatio() (yang dulu dipakai dan salah, karena
    // reshapeCropBoxToRatio mengasumsikan ada rasio yang mau dikunci).
    // ratioLocked di-set FALSE karena ukuran cetak 7.2×5.18cm ini fixed,
    // independen dari bentuk/rasio kotak yang ditampilkan (gambar penuh).
    cropModal._ratioLocked = false;
    cropModal._cropWcm = DEFAULT_CROP_W_CM; cropModal._cropHcm = DEFAULT_CROP_H_CM;
    updateSizeLabel(); fitCropBoxToFullImage();
}
function applyPreset(i) {
    var p = CROP_PRESETS[i];
    var ratioValue = Math.max(p.w,p.h) / Math.min(p.w,p.h);
    cropModal._activePresetIdx = i;
    cropModal._lastRatioPresetIdx = i; // 🆕 dicatat supaya bisa dipakai lagi kalau balik dari 1:1
    var longSide = PRESET_DEFAULT_LONG_CM;
    var shortSide = Math.round((longSide/ratioValue)*10)/10;
    var w,h;
    if (cropModal._orientation === 'landscape') { w=longSide; h=shortSide; } else { h=longSide; w=shortSide; }
    cropModal._presetRatio = w/h;
    setLockedSize(w,h); highlightPreset(i);
}
function setCropOrientation(orientation) {
    cropModal._orientation = orientation;
    document.getElementById('cropOrientPotrait').classList.toggle('active', orientation==='portrait');
    document.getElementById('cropOrientLandscape').classList.toggle('active', orientation==='landscape');
    // 🆕🆕 (revisi ke-2) Potrait/Lanskap adalah milik preset RASIO, bukan
    // 1:1. Kalau sebelumnya lagi di preset 1:1, klik Potrait/Lanskap TIDAK
    // langsung memaksakan salah satu rasio (3:2/4:3/16:9/dst) — itu
    // percobaan revisi PERTAMA (auto-`applyPreset(lastRatioPresetIdx)`) dan
    // ternyata SALAH: box malah kelihatan "mengecil tiba-tiba" alih-alih
    // benar-benar kembali full dulu, karena rasio tertentu (apalagi yang
    // jauh dari bentuk gambar aslinya, mis. 16:9 potrait di foto 4:3) PASTI
    // menghasilkan box yang lebih kecil dari full image — itu sudah benar
    // secara matematis, tapi bukan yang diinginkan user. Fix yang benar:
    // box CUKUP dikembalikan ke ukuran PENUH gambar dan status 1:1 dilepas
    // (`_activePresetIdx=-1`, tidak ada preset yang aktif) — biar user
    // sendiri yang pilih rasio mana yang mau dipakai berikutnya dari kondisi
    // full image itu.
    if (cropModal._activePresetIdx === 'square') {
        fitCropBoxToFullImage();
        cropModal._activePresetIdx = -1;
        cropModal._ratioLocked = false;
        cropModal._cropWcm = null;
        cropModal._cropHcm = null;
        highlightPreset(-1);
        var wEl=document.getElementById('cropWcm'), hEl=document.getElementById('cropHcm'), lblEl=document.getElementById('cropSizeLabel');
        if (wEl) wEl.value = ''; if (hEl) hEl.value = '';
        if (lblEl) lblEl.textContent = 'Pilih salah satu rasio di bawah';
        return;
    }
    // Selalu mulai dari kotak crop full image dulu sebelum di-reshape ke
    // rasio baru sesuai orientasi — bug lama: box dihitung dari ukuran/posisi
    // box SEBELUMNYA (stale), jadi box "nyangkut" pas pindah Lanskap↔Potrait.
    fitCropBoxToFullImage();
    var w = cropModal._cropWcm||1, h = cropModal._cropHcm||1;
    var longVal=Math.max(w,h), shortVal=Math.min(w,h), neww, newh;
    if (orientation==='landscape') { neww=longVal; newh=shortVal; } else { newh=longVal; neww=shortVal; }
    cropModal._presetRatio = neww/newh;
    setLockedSize(neww, newh);
}
function onCustomCmChange(field) {
    if (cropModal._mode === 'preset') { onPresetFieldChange(field); return; }
    if (cropModal._mode === 'manual') {
        var w = clampCmValue(document.getElementById('cropWcm').value, getMaxForField('w'));
        var h = clampCmValue(document.getElementById('cropHcm').value, getMaxForField('h'));
        document.getElementById('cropWcm').value = w; document.getElementById('cropHcm').value = h;
        setFreeSize(w, h, true);
    }
}
function onPresetFieldChange(field) {
    var ratio = cropModal._presetRatio || 1;
    var wEl=document.getElementById('cropWcm'), hEl=document.getElementById('cropHcm');
    var w,h;
    if (field==='w') { w=parseFloat(wEl.value)||0.5; h=w/ratio; } else { h=parseFloat(hEl.value)||0.5; w=h*ratio; }
    var maxW=getMaxForField('w'), maxH=getMaxForField('h');
    var scale = Math.min(1, maxW/w, maxH/h); w*=scale; h*=scale;
    if (w<0.5) { w=0.5; h=w/ratio; }
    if (h<0.5) { h=0.5; w=h*ratio; }
    w=Math.round(w*10)/10; h=Math.round(h*10)/10;
    wEl.value=w; hEl.value=h;
    cropModal._ratioLocked=true; cropModal._cropWcm=w; cropModal._cropHcm=h;
    updateSizeLabel(); reshapeCropBoxToRatio();
}
function setLockedSize(w,h,skipInputSync) {
    w=clampCmValue(w,getMaxForField('w')); h=clampCmValue(h,getMaxForField('h'));
    cropModal._ratioLocked=true; cropModal._cropWcm=w; cropModal._cropHcm=h;
    if (!skipInputSync) { document.getElementById('cropWcm').value=w; document.getElementById('cropHcm').value=h; }
    updateSizeLabel(); reshapeCropBoxToRatio();
}
function setFreeSize(w,h,skipInputSync) {
    w=clampCmValue(w,getMaxForField('w')); h=clampCmValue(h,getMaxForField('h'));
    cropModal._ratioLocked=false; cropModal._cropWcm=w; cropModal._cropHcm=h;
    if (!skipInputSync) { document.getElementById('cropWcm').value=w; document.getElementById('cropHcm').value=h; }
    updateSizeLabel();
}
function updateSizeLabel() {
    var lbl = document.getElementById('cropSizeLabel'); if (!lbl) return;
    var w=cropModal._cropWcm, h=cropModal._cropHcm;
    lbl.textContent = cropModal._mode==='preset'
        ? 'Ukuran cetak: '+w+' cm × '+h+' cm (rasio terkunci)'
        : 'Ukuran cetak: '+w+' cm × '+h+' cm (bebas, maks '+MANUAL_MAX_CM+'×'+MANUAL_MAX_CM+'cm)';
}

// openCropModal, cropReset, closeCropModal, cropAndSave, reshapeCropBoxToRatio → kode LENGKAP
// dan terbaru (termasuk kompresi adaptif total-cap 1MB) sudah ada utuh di dump Fitur J
// di bawah (sumber: fegt.html / form_o2_report.html) — salin dari situ, bukan dari sini.

// INIT (panggil di DOMContentLoaded):
// renderPresetButtons();
// initCropDrag(); // lihat fitur E
```

**Butuh dari user saat integrasi:**
- Apakah file tujuan MASIH pakai crop engine lama shared.js (`imgOpenCropper`)? Kalau iya, semua pemanggilnya perlu diarahkan ulang ke `openCropModal()`.
- Apakah ukuran default 7.2×5.18cm masih relevan untuk jenis dokumen file itu, atau beda?
- **Cek dulu file tujuan sudah versi lama atau baru** — kalau masih ketemu `1:1` di dalam `CROP_PRESETS`, atau `PRESET_DEFAULT_LONG_CM = 4`, atau `MANUAL_MAX_CM = 7`, atau `max="7"` di input `cropWcm`/`cropHcm`, atau `setCropMode()`/`setCropOrientation()` belum manggil `fitCropBoxToFullImage()` di awal fungsinya, atau `setCropOrientation()` masih `return` polos ATAU masih `applyPreset(...)` otomatis begitu `_activePresetIdx === 'square'` (harusnya cuma reset full image + lepas status 1:1, TANPA auto-pilih rasio — lihat poin 5), atau tidak ada `cropModal._lastRatioPresetIdx` sama sekali, atau `applySquarePreset()` belum melepas `classList.remove('active')` pada `cropOrientPotrait`/`cropOrientLandscape` (lihat poin 6) — berarti file itu masih versi lama, **terapkan semua 6 poin update di atas sekaligus** (jangan cuma sebagian), karena semuanya saling terkait dalam satu alur yang sama.

**🐛 BUG PENTING yang sudah di-fix — ukuran cm crop tidak dipakai di PDF:**
`cropAndSave()` menyimpan `entry.widthCm`/`entry.heightCm` per foto (sesuai cm yang dipilih user saat crop, termasuk "Default" 7.2×5.18cm) — **tapi di kode generate PDF (bagian yang nge-loop foto before/after ke `doc.addImage`), nilai ini SERING DIABAIKAN begitu saja**, diganti kotak grid seragam yang dihitung dari lebar kolom halaman (mis. `fw = (colW-gap/2)/perRow-2`). Akibatnya foto "Default 7.2×5.18cm" bisa muncul jauh lebih kecil di PDF daripada label ukurannya (pernah ketemu: label bilang 7.2×5.18cm, tapi yang ke-render cuma ~3.7×2.8cm) — user bisa mengira foto tidak ke-crop dengan benar padahal sebenarnya box PDF-nya yang tidak mengikuti cm.

**Fix wajib dipakai di setiap file yang generate PDF dari foto hasil crop modal ini:** hitung ukuran gambar di PDF dari `entry.widthCm`/`heightCm` (fallback ke `DEFAULT_CROP_W_CM`/`H` kalau foto lama belum punya properti ini), di-cap ke lebar kolom yang tersedia (jaga aspect ratio):
```js
function iePhotoDrawSize(entry, maxW, maxH) {
    var wCm = entry.widthCm || DEFAULT_CROP_W_CM;
    var hCm = entry.heightCm || DEFAULT_CROP_H_CM;
    var w = wCm * 10, h = hCm * 10; // cm -> mm
    if (w > maxW) { h = h * (maxW / w); w = maxW; }
    if (maxH && h > maxH) { w = w * (maxH / h); h = maxH; }
    return { w: w, h: h };
}
```
Lalu di loop `doc.addImage(...)`: panggil `iePhotoDrawSize(imgEntry, colW, maxPhotoH)` per foto (bukan pakai `fw`/`fh` konstan), dan pakai hasil `.w`/`.h` itu utk parameter width/height `addImage` — **karena tiap foto sekarang bisa punya ukuran berbeda, konsekuensinya:**
- Loop grid "2 foto per baris dalam 1 kolom" (before/after masing² bisa 2 foto sejajar) **harus diganti jadi 1 foto per baris** (before & after tetap sejajar kiri-kanan, tapi kalau ada >1 foto per sisi, ditumpuk ke bawah) — supaya lebar-tinggi variabel antar foto tidak bikin foto lain overlap.
- Tinggi baris (`rowH`) dipakai `Math.max(before.h, after.h, minH)` supaya before & after tetap align meski ukurannya beda, dan page-break check (`if (y+rowH+10>ph-marginBottom)`) pakai `rowH` ini per baris (bukan `fh` konstan).
- Estimasi tinggi "blok pertama" (buat cek page-break biar header+subheader+foto pertama gak kepisah halaman) juga harus dihitung dari `iePhotoDrawSize` foto pertama, bukan angka konstan.
- Fitur D (Geser Posisi Gambar / `offsetX`) tetap jalan normal — cuma clamp batasnya (`pw - marginX - fw`) ganti pakai `pw - marginX - dim.w` (lebar foto yg sebenarnya, bukan `fw` konstan lagi).

---

## C. Crop Ulang
**Tujuan:** ikon ✂️ di pojok kiri-atas tiap thumbnail — buka lagi crop modal pakai foto yang SUDAH tersimpan (bukan upload baru), lengkap dengan mode/ukuran terakhir.

```html
<button class="reedit" onclick="reEditCrop('{{type}}',{{idx}},{{imgIdx}})" title="Crop ulang">✂️</button>
```
```css
.img-thumb .reedit{position:absolute;top:-7px;left:-7px;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;border:none;cursor:pointer;font-size:11px;line-height:20px;text-align:center;padding:0}
```
```js
function reEditCrop(type, idx, imgIdx) {
    var img = sections[type] && sections[type][idx] && sections[type][idx].images[imgIdx]; // {{sesuaikan struktur data}}
    if (!img || !img.dataUrl) return;
    cropModal._pending = {type:type, idx:idx, replaceIdx:imgIdx};
    var preferredSize = (img.widthCm && img.heightCm) ? {w: img.widthCm, h: img.heightCm} : null;
    openCropModal(img.dataUrl, preferredSize);
}
// openCropModal butuh parameter ke-2 opsional `preferredSize` — pastikan fungsi
// openCropModal di file tujuan sudah menerima ini (lihat Fitur B).
```
**Butuh dari user:** nama variabel/struktur data gambar di file itu (kalau bukan `sections[type][idx].images[]`).

**⚠️ WAJIB DIPERHATIKAN saat implementasi `cropAndSave()` (bukan cuma `reEditCrop`):** ketika `p.replaceIdx >= 0` (artinya user sedang re-crop foto lama, bukan upload baru), entry hasil crop yang baru **HARUS mengganti entry lama tepat di index yang sama** — pakai `imgArr.splice(p.replaceIdx, 1, entry)` — **JANGAN** pola lama `imgArr.splice(p.replaceIdx,1)` (hapus) lalu `imgArr.push(entry)` (tambah di akhir). Pola lama itu bikin foto pindah ke posisi PALING KANAN/AKHIR galeri setiap kali di-crop ulang, sementara keterangan (`caption`) yang di-sync ulang dari input DOM berdasarkan index (lihat `cf4kSyncCaptions`/`cfSyncCaptions` sebelum render) jadi tertukar dengan foto lain karena urutan array sudah berubah duluan sebelum DOM-nya. Bug ini pernah ditemukan di 14 file HTML + `shared.js` (Agustus 2026) — lihat Riwayat Revisi v1.1 di atas.
Efek samping lain yang perlu ikut disesuaikan: kalau ada penghitungan budget ukuran total foto (mis. loop kompresi `for (var q=0.9; ...)` yang menjumlahkan `imgArr.reduce(...)` untuk cek batas 1MB), pastikan entry yang SEDANG diganti (`i === p.replaceIdx`) dikecualikan dari total tersebut — supaya tidak dihitung dobel (ukuran lama + ukuran baru sekaligus).

---

## D. Geser Posisi Gambar
**Tujuan:** kontrol ◀▶ di bawah tiap thumbnail untuk menggeser posisi horizontal gambar itu di HASIL PDF (bukan di form), dengan reflow otomatis supaya gambar sesudahnya di baris yang sama ikut ke-push (tidak tumpang tindih).

**⚠️ DITEMUKAN (Agustus 2026, `pm-hg-analyzer.html`) — fitur ini bisa "mati" tanpa kelihatan:** waktu dicek, file itu sudah punya CSS `.img-nudge` LENGKAP dan fungsi generik `nudgeImageInArray(imgArr, imgIdx, delta, rerenderFn)` sudah ada di dalam file — bahkan generator PDF-nya sudah baca `img.offsetX` dengan benar — tapi **tombol ◀▶-nya sendiri tidak pernah ditempel di markup thumbnail manapun**. Efeknya: user tidak pernah bisa geser posisi gambar sama sekali walau semua "mesin" di baliknya sudah siap — dan ini gampang kelewat karena tidak error, tidak ada di console, cuma "fiturnya nggak ada" secara visual. **Saat cek Fitur D di file manapun: jangan cuma `grep nudgeImageInArray` (function declaration) — pastikan juga ada PEMANGGILAN-nya (`nudgeImageInArray(...)`) di kode yang generate HTML thumbnail.** Grep 2 tahap: `function nudgeImageInArray` (harus ada 1×, biasanya definisi generik dipakai bareng banyak modul) DAN `nudgeImageInArray(` dengan argumen aktual (harus ada ≥1× per galeri foto yang butuh fitur ini, di dalam fungsi render thumbnail-nya).

```html
<div class="img-nudge">
    <div class="img-nudge-label">Geser posisi di hasil PDF</div>
    <div class="img-nudge-controls">
        <button type="button" onclick="nudgeImage('{{type}}',{{idx}},{{imgIdx}},-0.5)" title="Geser posisi gambar ini ke kiri di hasil PDF">◀</button>
        <span>{{img.offsetX||0}}cm</span>
        <button type="button" onclick="nudgeImage('{{type}}',{{idx}},{{imgIdx}},0.5)" title="Geser posisi gambar ini ke kanan di hasil PDF">▶</button>
    </div>
</div>
```
```css
.img-nudge{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:4px}
.img-nudge-label{font-size:8px;color:#8a8a8a;text-align:center;line-height:1.2;max-width:78px}
.img-nudge-controls{display:flex;align-items:center;justify-content:center;gap:3px}
.img-nudge button{width:18px;height:18px;border-radius:4px;border:1px solid #ddd;background:#f2f2f2;color:#333;font-size:9px;cursor:pointer;padding:0;line-height:1}
.img-nudge span{font-size:9px;color:#666;min-width:28px;text-align:center}
```
```js
function nudgeImage(type, idx, imgIdx, delta) {
    var img = sections[type] && sections[type][idx] && sections[type][idx].images[imgIdx]; // {{sesuaikan struktur data}}
    if (!img) return;
    var next = Math.round(((img.offsetX||0)+delta)*10)/10;
    var LIMIT = 5;
    if (next>LIMIT) next=LIMIT; if (next<-LIMIT) next=-LIMIT;
    img.offsetX = next;
    renderSection(type, type+'Box'); // {{ganti ke fungsi render ulang thumbnail file itu}}
}
```

**⚠️ WAJIB juga diubah di sisi generate PDF** (kode gambar di dalam loop `doc.addImage(...)`):
```js
// Sebelumnya: doc.addImage(im.dataUrl, 'JPEG', rowX, y, imgW, imgH);
// Ganti jadi:
var drawX = rowX + ((im.offsetX || 0) * 10);
drawX = Math.max(marginX, Math.min(drawX, pw - marginX - imgW));
doc.addImage(im.dataUrl, 'JPEG', drawX, y, imgW, imgH);
// ...caption pakai drawX juga (bukan rowX)...

// PENTING — baris increment posisi gambar SELANJUTNYA harus pakai drawX, bukan rowX lama,
// supaya reflow-nya jalan (ini yang kemarin jadi bug "gambar ketumpuk"):
rowX = drawX + imgW + gap;   // BUKAN: rowX += imgW + gap;
```
**Butuh dari user:** lokasi persis loop `doc.addImage` gambar di fungsi export PDF file tujuan (tiap file kemungkinan beda nama variabel `rowX`/`gap`/`marginX`).

---

## E. Drag/Resize Kotak Crop
**Tujuan:** geser kotak crop dengan drag tengah, resize dari 8 handle (4 sudut + 4 sisi), rasio terkunci kalau mode Default/Preset aktif.

**Catatan gaya kode:** implementasi ini pakai `mousedown`+`touchstart` manual (bukan Pointer Events `setPointerCapture` seperti pola `opacity.html`). Fungsinya sudah teruji jalan baik touch maupun mouse. **Kalau user minta diseragamkan ke pola Pointer Events, tanyakan dulu** sebelum ganti — jangan otomatis diubah karena risiko bug drag/resize kalau tidak dites ulang.

```js
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function initCropDrag() {
    var box = document.getElementById('cropBox');
    var wrap = document.getElementById('cropWrap');
    box.addEventListener('mousedown', onStart, false);
    box.addEventListener('touchstart', onStart, {passive: false});
    function onStart(e) {
        e.preventDefault(); e.stopPropagation();
        var t = e.touches ? e.touches[0] : e;
        var startX=t.clientX, startY=t.clientY;
        var startL=parseInt(box.style.left)||0, startT=parseInt(box.style.top)||0;
        var startW=box.offsetWidth, startH=box.offsetHeight;
        var rect=box.getBoundingClientRect();
        var rx=t.clientX-rect.left, ry=t.clientY-rect.top, edge=22;
        var edgeX = rx<edge?'l':rx>startW-edge?'r':'';
        var edgeY = ry<edge?'t':ry>startH-edge?'b':'';
        var mode = (edgeX||edgeY) ? edgeX+edgeY : 'move';
        function onMove(ev) {
            ev.preventDefault();
            var mv = ev.touches?ev.touches[0]:ev;
            var dx=mv.clientX-startX, dy=mv.clientY-startY;
            var img=document.getElementById('cropImg');
            var iL=parseInt(img.style.left)||0, iT=parseInt(img.style.top)||0;
            var iW=img.offsetWidth, iH=img.offsetHeight;
            if (mode==='move') {
                box.style.left = clamp(startL+dx, iL, iL+iW-startW)+'px';
                box.style.top = clamp(startT+dy, iT, iT+iH-startH)+'px';
            } else if (cropModal._ratioLocked && cropModal._cropWcm && cropModal._cropHcm) {
                var ratio = cropModal._cropWcm / cropModal._cropHcm;
                var growRight=mode.includes('r'), growLeftEdge=mode.includes('l');
                var growBottom=mode.includes('b'), growTopEdge=mode.includes('t');
                var isCorner = mode.length===2;
                var anchorX = growLeftEdge ? (startL+startW) : startL;
                var anchorY = growTopEdge ? (startT+startH) : startT;
                var dxSigned = growRight?dx:(growLeftEdge?-dx:0);
                var dySigned = growBottom?dy:(growTopEdge?-dy:0);
                var newW,newH;
                if (isCorner) {
                    if (Math.abs(dxSigned)>=Math.abs(dySigned)) { newW=startW+dxSigned; newH=newW/ratio; }
                    else { newH=startH+dySigned; newW=newH*ratio; }
                } else if (growLeftEdge||growRight) { newW=startW+dxSigned; newH=newW/ratio; }
                else { newH=startH+dySigned; newW=newH*ratio; }
                if (newW<40) { newW=40; newH=newW/ratio; }
                if (newH<40) { newH=40; newW=newH*ratio; }
                var maxW = growLeftEdge?(anchorX-iL):(iL+iW-anchorX);
                var maxH = growTopEdge?(anchorY-iT):(iT+iH-anchorY);
                var scaleDown = Math.min(1, maxW>0?maxW/newW:1, maxH>0?maxH/newH:1);
                newW*=scaleDown; newH*=scaleDown;
                var nl,nt;
                if (isCorner||growLeftEdge||growRight) nl = growLeftEdge?(anchorX-newW):anchorX;
                else nl = startL+(startW-newW)/2;
                if (isCorner||growTopEdge||growBottom) nt = growTopEdge?(anchorY-newH):anchorY;
                else nt = startT+(startH-newH)/2;
                box.style.left=nl+'px'; box.style.top=nt+'px'; box.style.width=newW+'px'; box.style.height=newH+'px';
            }
            // kalau TIDAK ratio-locked (mode Manual): resize bebas — lihat file asli baris ~1010-1046
            // untuk cabang else lengkapnya (belum termasuk di ringkasan ini, salin dari sana).
        }
        function onUp() {
            document.removeEventListener('mousemove',onMove); document.removeEventListener('touchmove',onMove);
            document.removeEventListener('mouseup',onUp); document.removeEventListener('touchend',onUp);
        }
        document.addEventListener('mousemove',onMove);
        document.addEventListener('touchmove',onMove,{passive:false});
        document.addEventListener('mouseup',onUp);
        document.addEventListener('touchend',onUp);
    }
}
```
> ⚠️ Cabang resize bebas (mode Manual, tidak ratio-locked) sengaja tidak diringkas di sini karena cukup panjang — kode lengkapnya (fungsi `onCropDragStart`) sudah tersalin utuh di dump Fitur J di bawah (sumber: `fegt.html`), **salin dari situ** saat implementasi supaya tidak ada logika yang kelewat/salah ketik.

---

## F. Autosave Draft
**Tujuan:** form otomatis tersimpan (IndexedDB via `shared.js`) tiap kali ada perubahan input, supaya tidak hilang kalau tab/halaman tertutup tidak sengaja. Saat dibuka lagi, ada prompt "lanjutkan draft?".

Mekanismenya **sudah otomatis jalan dari `shared.js`** (event delegation input/change global + `autosaveCheckAndPrompt` di `window.load`). File tujuan HANYA perlu 2 hal:

```js
window.CURRENT_MODUL = '{{Nama Modul Persis Sama Dengan Yang Dipakai di dbSave()}}';

function restoreDraftData(rec, editingId) {
    if (!rec) return;
    applyRecordToForm(rec); // {{buat fungsi ini: isi ulang semua field dari `rec`, mirror logic dari fungsi load-by-id yang sudah ada di file itu}}
    if (editingId) window._editingId = editingId;
    if (typeof dbShowToast === 'function') dbShowToast('Draft sebelumnya berhasil dipulihkan ✓');
}
```
Draft otomatis kehapus sendiri lewat `autosaveClear()` di dalam `dbSave()` bawaan `shared.js` — **tidak perlu bikin wrapper tombol Simpan sendiri**, biarkan `onclick="dbSave('{{Nama Modul}}')"` langsung seperti biasa.

**Butuh dari user (WAJIB ditanya, jangan menebak):**
- Nama modul persis (harus sama dengan yang dipakai di pemanggilan `dbSave(modul)`/`dbCollectData(modul)` yang sudah ada di file itu, supaya `normalizeModul()` di shared.js mengenalinya).
- Bentuk objek `rec` yang dikembalikan `dbCollectData(modul)` di file itu (field-field apa saja) — dipakai untuk menulis `applyRecordToForm`.

---

## G. Loading Overlay
**Tujuan:** kasih tahu user progres saat proses yang bisa lama (banyak gambar).

- **Ambil dari riwayat & Simpan ke database** → **otomatis** dari `shared.js` (`dbLoad`/`dbSave` sudah include `dbShowSavingOverlay(...)` dengan pesan "Data/Mengupload banyak gambar membutuhkan waktu yang lama"). Tidak perlu kode tambahan — asal file tujuan memang manggil `dbLoad()`/`dbSave()` langsung dari shared.js.
- **Export PDF** → PERLU ditambah manual (shared.js tidak tahu kapan proses PDF mulai/selesai):
```js
function exportPdf() {
    // ...
    var totalImgs = {{hitung total semua gambar di semua section}};
    var loadingMsg = totalImgs>0 ? '⏳ Membuat PDF... memproses '+totalImgs+' gambar, mohon tunggu' : '⏳ Membuat PDF, mohon tunggu';
    if (typeof showImgLoading === 'function') showImgLoading(loadingMsg);
    // ...generate PDF...
    if (typeof hideImgLoading === 'function') hideImgLoading(); // panggil SEBELUM showPdfPreview(...) dan juga di blok catch(err)
}
```
**Butuh dari user:** tidak ada, tapi cek dulu apakah file tujuan sudah manggil `dbLoad`/`dbSave` langsung (bukan versi custom sendiri) — kalau custom, overlay otomatis ini tidak akan jalan.

---

## H. Background Template PDF
**Tujuan:** PDF hasil export pakai gambar background/kop-surat template, di-preload sekali supaya tidak lambat/kedip tiap halaman baru.

```js
var reportBgImg = null, reportBgReady = false, reportBgCallbacks = [];
function initReportBackground() {
    if (reportBgImg) return;
    reportBgImg = new Image();
    reportBgImg.onload = function() { reportBgReady = true; reportBgCallbacks.splice(0).forEach(function(cb){cb();}); };
    reportBgImg.onerror = function() { reportBgReady = false; reportBgCallbacks.splice(0).forEach(function(cb){cb();}); };
    reportBgImg.src = '{{PATH_FILE_BACKGROUND.jpg}}';
}
function ensureReportBackground(callback) {
    initReportBackground();
    if (reportBgReady || (reportBgImg && reportBgImg.complete && reportBgImg.naturalWidth)) { reportBgReady = true; callback(); return; }
    reportBgCallbacks.push(callback);
}
function drawPdfBackground(doc, pw, ph) {
    if (!reportBgImg || !reportBgReady) return;
    try { doc.addImage(reportBgImg, 'JPEG', 0, 0, pw, ph); } catch(e) {}
}
// Panggil initReportBackground() di DOMContentLoaded.
// Bungkus isi exportPdf() di dalam ensureReportBackground(function(){ ...generate PDF... });
// Panggil drawPdfBackground(doc,pw,ph) tiap kali habis doc.addPage().
```
**Butuh dari user:** path/nama file gambar template untuk file itu (kalau beda dari `DRAFT PM KOSONG.jpg`), dan apakah `marginTop` perlu disesuaikan supaya tidak menabrak area kop background (pola b12: `marginTop=20`).

---

## I. Preview PDF
**Tujuan:** sebelum benar-benar download, PDF hasil generate ditampilkan dulu ke user buat dicek. **Dirender manual via PDF.js ke `<canvas>`, BUKAN `<iframe>`** — karena Chrome Android tidak bisa render PDF inline di iframe (cuma nongol kartu "Buka" bawaan Chrome).

```html
<div id="pdfPreviewModal" class="pdf-preview-modal">
    <div class="pdf-preview-dialog">
        <div class="pdf-preview-header">
            <div class="pdf-preview-title">📄 Preview Hasil PDF</div>
            <div class="pdf-preview-hint">Ini tampilan asli file PDF-nya, cek dulu sebelum download</div>
        </div>
        <div class="pdf-preview-body"><div id="pdfPreviewFrame" class="pdf-canvas-container"></div></div>
        <div class="pdf-preview-footer">
            <button class="crop-btn crop-btn-outline" onclick="closePdfPreview()">✏️ Tutup, Edit Lagi</button>
            <button class="crop-btn crop-btn-save" onclick="confirmDownloadPdf()">⬇ Download PDF</button>
        </div>
    </div>
</div>
```
```css
.pdf-preview-modal{display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;background:rgba(0,0,0,0.85);flex-direction:column;align-items:center;justify-content:center;padding:12px}
.pdf-preview-modal.show{display:flex}
.pdf-preview-dialog{background:#1a221e;border:1px solid #2a3a30;border-radius:10px;width:min(96vw,900px);height:min(92vh,1100px);overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);display:flex;flex-direction:column}
.pdf-preview-header{background:#243228;padding:10px 16px;flex:0 0 auto}
.pdf-preview-title{font-weight:700;font-size:14px;color:#e0f0e8}
.pdf-preview-hint{font-size:11px;color:#8aab96;margin-top:2px}
.pdf-preview-body{flex:1 1 auto;background:#333;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch}
.pdf-canvas-container{display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px}
.pdf-canvas-container canvas{max-width:100%;height:auto;box-shadow:0 2px 10px rgba(0,0,0,0.5);background:#fff}
.pdf-canvas-loading{color:#8aab96;font-size:13px;padding:40px 0;text-align:center}
.pdf-preview-footer{padding:10px 14px;background:#1a221e;border-top:1px solid #2a3a30;display:flex;gap:8px;justify-content:flex-end;flex:0 0 auto}
```
```js
var pdfPreviewState = { doc: null, filename: '', blobUrl: '' };
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
function showPdfPreview(doc, filename) {
    if (pdfPreviewState.blobUrl) { URL.revokeObjectURL(pdfPreviewState.blobUrl); pdfPreviewState.blobUrl=''; }
    pdfPreviewState.doc = doc; pdfPreviewState.filename = filename;
    var modal = document.getElementById('pdfPreviewModal');
    var container = document.getElementById('pdfPreviewFrame');
    container.innerHTML = '<div class="pdf-canvas-loading">⏳ Menyiapkan preview...</div>';
    modal.classList.add('show');
    if (typeof pdfjsLib === 'undefined') {
        container.innerHTML = '<div class="pdf-canvas-loading">Preview tidak tersedia di browser ini.<br>Silakan langsung download untuk melihat hasilnya.</div>';
        return;
    }
    var arrayBuffer = doc.output('arraybuffer');
    pdfjsLib.getDocument({data: arrayBuffer}).promise.then(function(pdf) {
        container.innerHTML = '';
        function renderPage(pageNum) {
            pdf.getPage(pageNum).then(function(page) {
                var viewport = page.getViewport({scale: 1.8});
                var canvas = document.createElement('canvas');
                canvas.width = viewport.width; canvas.height = viewport.height;
                container.appendChild(canvas);
                page.render({canvasContext: canvas.getContext('2d'), viewport: viewport}).promise.then(function() {
                    if (pageNum < pdf.numPages) renderPage(pageNum+1);
                });
            });
        }
        renderPage(1);
    }).catch(function(err) {
        console.error(err);
        container.innerHTML = '<div class="pdf-canvas-loading">Gagal menampilkan preview.<br>Silakan langsung download untuk melihat hasilnya.</div>';
    });
}
function confirmDownloadPdf() { if (pdfPreviewState.doc) pdfPreviewState.doc.save(pdfPreviewState.filename); }
function closePdfPreview() {
    document.getElementById('pdfPreviewModal').classList.remove('show');
    document.getElementById('pdfPreviewFrame').innerHTML = '';
    if (pdfPreviewState.blobUrl) { URL.revokeObjectURL(pdfPreviewState.blobUrl); pdfPreviewState.blobUrl=''; }
    pdfPreviewState.doc = null;
}
```
**Integrasi ke `exportPdf()` yang sudah ada:** ganti baris terakhir `doc.save(fn)` menjadi `showPdfPreview(doc, fn);` — **ini yang termasuk kategori "fitur print sangat berbeda" kalau file tujuan SELAMA INI langsung download tanpa preview sama sekali. Tanyakan dulu ke user apakah mau diubah jadi alur preview**, karena ini mengubah behavior existing (bukan cuma nambah).

**Butuh dari user:** konfirmasi mau diubah ke alur preview-dulu atau tidak (lihat poin 4 aturan di atas dokumen ini).

---

## J. Edit Gambar (Insert Shape: Teks/Panah/Garis/Kotak/Oval)
**Sumber terkini:** `form_o2_report.html` (menggantikan `fegt.html` sebagai acuan utama fitur ini — `fegt.html` masih punya versi lebih lama tanpa fix-fix di bawah). Kalau minta diterapkan ke file baru dan tidak disebutkan sumbernya, **pakai kode dari dokumen ini** (sudah versi `form_o2_report.html`), bukan salin manual dari `fegt.html`.

**Tujuan:** dari dalam Crop Modal, user bisa tap "🖍️ Edit Gambar" untuk membuka editor anotasi ala Insert Shape Word — tambah teks, panah, garis, kotak, oval di atas foto ASLI (sebelum crop), termasuk **rotasi** untuk kotak & oval (lihat detail di bagian bawah dump kode — sudah menyatu, bukan terpisah lagi). Semua anotasi bisa digeser, di-resize, warna & ketebalan garis bisa dipilih. Editor tampil hampir full-screen dengan zoom (➖/➕) dan tool geser tampilan (✋ pan). Saat selesai, anotasi di-flatten (digabung jadi satu bitmap) ke `#cropImg` lewat `<canvas>`, supaya alur crop selanjutnya tetap normal.

**Trigger dari Crop Modal** (taruh di `.crop-btns` footer crop modal yang sudah ada):
```html
<button class="crop-btn crop-btn-outline" onclick="openImageEditor()">🖍️ Edit Gambar</button>
```

**⚠️ Potensi Konflik:** butuh elemen `#cropImg` & `#cropWrap` dari Fitur B (Crop Modal 3-Mode) sudah ada duluan — `openImageEditor()` membaca `cropImg.src` sebagai sumber, dan `applyImageEdits()` menulis balik hasil flatten ke `cropImg.src` lalu refit ke `cropWrap`. **Kalau file tujuan crop modal-nya beda struktur/id, sesuaikan dulu bagian itu di `openImageEditor()`/`applyImageEdits()`.**

**Catatan gaya kode — SENGAJA beda dari Fitur E:** modul ini pakai **Pointer Events** (`pointerdown`/`pointermove`/`pointerup`/`pointercancel`), bukan `mousedown`+`touchstart` manual. Ini bukan sekadar gaya — sebelumnya pakai pola touch+mouse terpisah dan user melaporkan drag shape (terutama teks & garis) kadang "putus"/tidak jalan di HP Android; setelah diseragamkan ke Pointer Events, masalahnya hilang. **Jangan diganti balik ke pola `mousedown`+`touchstart` untuk fitur ini.**

**Bug penting yang sudah di-fix — soft keyboard nyangkut:** teks dibuat/diedit lewat `window.prompt()` (dialog native). Di Android Chrome, setelah `prompt()` ditutup, soft keyboard sering **tidak ikut turun** karena tidak ada `<input>` asli di halaman yang kehilangan fokus (fokus sebelumnya ada di kotak dialog native, bukan elemen DOM) — dialognya sendiri berfungsi normal (teks berhasil masuk), cuma keyboard-nya nyangkut secara visual dan kadang tap di tempat lain pun tidak menutupnya. **Fix:** panggil `ieForceHideKeyboard()` tepat setelah setiap `prompt()` selesai — fungsi ini fokus-lalu-blur sebuah `<input readonly>` tersembunyi supaya Android mendapat sinyal blur yang nyata dan menutup IME (dibuat readonly saat fokus supaya tidak malah memunculkan keyboard baru). **Pola ini wajib dipakai di mana pun fitur ini pakai `prompt()`** — kalau nanti prompt() diganti custom input di halaman, fix ini tidak diperlukan lagi karena sudah ada `<input>` asli untuk di-blur.

**Bug penting yang sudah di-fix — titik resize (handle) & titik ujung garis/panah susah dipencet di HP:** `ieHandleR()` sengaja dibuat kecil (~9px) supaya titik hijau terlihat presisi dan tidak menutupi gambar, tapi ini bikin titiknya susah kena jari di layar HP — berlaku untuk **semua** jenis handle yang lewat `ieMakeHandle()`: resize kotak/oval/teks, DAN titik ujung garis/panah (`x1,y1`/`x2,y2`, dipakai buat mengubah arah garis). **Fix:** `ieMakeHandle()` sekarang menggambar 2 lingkaran SVG bertumpuk di titik yang sama — lingkaran visual kecil (`pointer-events:none`, cuma buat tampilan) dan lingkaran hit-area transparan yang lebih besar di atasnya (`pointer-events:all`, `touch-action:none` biar gesture browser tidak ikut campur, radius minimal ~22px layar via `ieHandleHitR()`, dikonversi ke koordinat natural gambar sesuai `baseScale × zoom` biar konsisten walau lagi di-zoom). Listener `pointerdown` dipasang di lingkaran hit-area, bukan lingkaran visual. **Jangan pasang listener langsung di lingkaran visual `c`** — itu yang bikin bug ini muncul lagi.

**Bug lain yang sudah di-fix (revisi `form_o2_report.html`):**
- **Shape baru tidak otomatis terpilih** — sebelumnya setelah bikin teks/garis/kotak/oval baru, usernya harus tap lagi buat pilih shape itu (misal buat langsung geser/resize). Sekarang `addShape(...)` yang mengembalikan objek shape-nya, langsung dipanggil `setSelectedShape(shape.id)` sesudahnya di semua jalur pembuatan shape (teks lewat prompt, drag-selesai untuk garis/panah/kotak/oval).
- **Closure salah nangkep `shape.id` pas drag** — pemanggil `startDragShape(shape.id, ev)` di dalam `forEach` shape dibungkus IIFE `(function(shapeId){ return function(ev){...}; })(shape.id)` supaya id-nya "dibekukan" per-shape dengan aman, menghindari kemungkinan drag salah shape kalau ada re-render di tengah interaksi.
- **Edit teks kosong ke-cancel padahal harusnya boleh dikosongkan jadi spasi** — `editSelectedText()` sekarang treat `val === null` (user tekan Cancel) beda dari string kosong (`s.text = val || ' '`, supaya shape teks tidak hilang total kalau dikosongkan).
- **Ukuran font naik/turun tanpa fallback** — `fontSize` pakai `(s.fontSize || ieFontDefault()) + dir*step` supaya tidak `NaN` kalau shape lama belum punya `fontSize`.
- **Kompresi hasil flatten sedikit dinaikkan** — loop kualitas kompresi mulai dari `q=0.9` (sebelumnya `0.85`) sebagai upaya awal sebelum turun bertahap, supaya hasil rata-rata sedikit lebih tajam sebelum kena penurunan kualitas.
- **`ieBuildShapeVisual()` dirapikan** — sekarang satu variabel `el` dipakai untuk semua tipe shape (if/else-if), bukan banyak `return` di tengah — mempermudah rotasi (Fitur K) ditempel di satu titik keluar fungsi tanpa duplikasi.
- **Render callback modul saat crop selesai (`cropAndSave`) dibuat generik** — dipanggil dinamis lewat `window[modulePrefix + 'RenderPreviews'](side)`, bukan daftar `if/else` per modul (`cl`/`ld`/`op`/dst) yang harus ditambah manual tiap ada modul baru. **Ini penyesuaian di luar `form_o2_report.html` asli** (di sana masih `if/else` manual) — dipakai supaya kode di dokumen ini langsung kompatibel untuk modul apa pun tanpa diedit tiap kali; kalau nge-diff langsung ke `form_o2_report.html`, bagian ini akan terlihat beda.


```css
/* ── EDIT GAMBAR (Insert Shape) ── */
.editimg-dialog{width:98vw;height:96vh;max-width:1600px;max-height:1600px;display:flex;flex-direction:column}
#editImgOuter{position:relative;flex:1 1 auto;min-height:0;background:#0c100d;overflow:auto;touch-action:none;display:flex;align-items:center;justify-content:center}
#editImgWrap{position:relative;flex:none;touch-action:none}
#editImg{position:absolute;left:0;top:0;user-select:none;-webkit-user-select:none;pointer-events:none;display:block}
#editSvgOverlay{position:absolute;left:0;top:0;cursor:crosshair;touch-action:none}
.edit-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 14px;background:#1a221e;border-top:1px solid #2a3a30;flex:none}
.edit-tool-btn{width:36px;height:36px;border-radius:7px;border:1px solid #3a4f42;background:#222e26;color:#aac8b5;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.edit-tool-btn.active{background:#2ecc71;color:#0e150f;border-color:#2ecc71}
.edit-tool-btn.zoom-label{width:auto;padding:0 8px;font-size:12px;font-weight:700}
.edit-toolbar-sep{width:1px;align-self:stretch;background:#2a3a30;margin:2px 2px}
.edit-color-swatch{width:24px;height:24px;border-radius:50%;border:2px solid #3a4f42;cursor:pointer;padding:0}
.edit-color-swatch.active{border-color:#fff;box-shadow:0 0 0 2px #2ecc71}
.edit-thick-swatch{width:32px;height:36px;border-radius:7px;border:1px solid #3a4f42;background:#222e26;color:#aac8b5;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.edit-thick-swatch.active{background:#2ecc71;color:#0e150f;border-color:#2ecc71}
```

```html
<!-- ═══ EDIT GAMBAR (Insert Shape: Teks/Panah/Garis/Kotak/Oval) ═══ -->
<div id="editImgModal" class="pdf-preview-modal">
    <div class="crop-dialog editimg-dialog">
        <div class="pdf-preview-header">
            <button type="button" class="pdf-preview-close-x" onclick="closeImageEditor(true)" aria-label="Tutup">✕</button>
            <div class="pdf-preview-title">🖍️ Edit Gambar</div>
            <div class="pdf-preview-hint">Tambah teks/panah/garis/kotak/oval • ✋ geser tampilan • 🔍 zoom</div>
        </div>
        <div id="editImgOuter">
            <div id="editImgWrap">
                <img id="editImg" src="" alt="">
                <svg id="editSvgOverlay" xmlns="http://www.w3.org/2000/svg"></svg>
            </div>
        </div>
        <div class="edit-toolbar" id="editToolbar">
            <button type="button" class="edit-tool-btn active" data-tool="select" onclick="setEditTool('select')" title="Pilih / Pindah">↖</button>
            <button type="button" class="edit-tool-btn" data-tool="text" onclick="setEditTool('text')" title="Tambah Teks">🅰</button>
            <button type="button" class="edit-tool-btn" data-tool="arrow" onclick="setEditTool('arrow')" title="Panah">↗</button>
            <button type="button" class="edit-tool-btn" data-tool="line" onclick="setEditTool('line')" title="Garis">╱</button>
            <button type="button" class="edit-tool-btn" data-tool="rect" onclick="setEditTool('rect')" title="Kotak">▭</button>
            <button type="button" class="edit-tool-btn" data-tool="oval" onclick="setEditTool('oval')" title="Oval">◯</button>
            <button type="button" class="edit-tool-btn" data-tool="pan" onclick="setEditTool('pan')" title="Geser Tampilan">✋</button>
            <span class="edit-toolbar-sep"></span>
            <button type="button" class="edit-color-swatch active" data-color="#e53935" style="background:#e53935" onclick="setEditColor('#e53935',this)" title="Merah"></button>
            <button type="button" class="edit-color-swatch" data-color="#1a1a1a" style="background:#1a1a1a" onclick="setEditColor('#1a1a1a',this)" title="Hitam"></button>
            <button type="button" class="edit-color-swatch" data-color="#1e88e5" style="background:#1e88e5" onclick="setEditColor('#1e88e5',this)" title="Biru"></button>
            <button type="button" class="edit-color-swatch" data-color="#fdd835" style="background:#fdd835" onclick="setEditColor('#fdd835',this)" title="Kuning"></button>
            <span class="edit-toolbar-sep"></span>
            <button type="button" class="edit-thick-swatch" data-thick="S" onclick="setEditThickness('S',this)" title="Garis Tipis">▁</button>
            <button type="button" class="edit-thick-swatch active" data-thick="M" onclick="setEditThickness('M',this)" title="Garis Sedang">▃</button>
            <button type="button" class="edit-thick-swatch" data-thick="L" onclick="setEditThickness('L',this)" title="Garis Tebal">▅</button>
            <button type="button" class="edit-thick-swatch" data-thick="XL" onclick="setEditThickness('XL',this)" title="Garis Sangat Tebal">▇</button>
            <span class="edit-toolbar-sep"></span>
            <button type="button" class="edit-tool-btn" onclick="ieZoomOut()" title="Perkecil Tampilan">➖</button>
            <button type="button" class="edit-tool-btn zoom-label" id="editZoomLabel" onclick="ieZoomReset()" title="Reset Zoom">100%</button>
            <button type="button" class="edit-tool-btn" onclick="ieZoomIn()" title="Perbesar Tampilan">➕</button>
            <span class="edit-toolbar-sep"></span>
            <button type="button" class="edit-tool-btn" id="editTextSmallerBtn" onclick="ieResizeSelectedText(-1)" title="Perkecil Teks" style="display:none">A−</button>
            <button type="button" class="edit-tool-btn" id="editTextBiggerBtn" onclick="ieResizeSelectedText(1)" title="Perbesar Teks" style="display:none">A+</button>
            <button type="button" class="edit-tool-btn" id="editTextEditBtn" onclick="editSelectedText()" title="Edit Teks" style="display:none">✏️</button>
            <button type="button" class="edit-tool-btn" id="editDeleteBtn" onclick="deleteSelectedShape()" title="Hapus" style="display:none">🗑️</button>
        </div>
        <div class="pdf-preview-footer">
            <button class="crop-btn crop-btn-outline" onclick="closeImageEditor(true)">Batal</button>
            <button class="crop-btn crop-btn-save" onclick="applyImageEdits()">✓ Selesai</button>
        </div>
    </div>
        </div>
    </div>
</div>
```

```js
var NS_SVG = 'http://www.w3.org/2000/svg';
var imgEditState = {
    tool: 'select', color: '#e53935', thickness: 'M', zoom: 1, baseScale: 1, shapes: [], selectedId: null,
    naturalW: 0, naturalH: 0, nextId: 1, drawing: null, sourceUrl: null
};
var IE_THICKNESS_FACTORS = { S: 0.0022, M: 0.0045, L: 0.0075, XL: 0.012 };
var IE_ZOOM_MIN = 1, IE_ZOOM_MAX = 4, IE_ZOOM_STEP = 0.5;

function ieMinSize(){ return Math.max(20, imgEditState.naturalW * 0.02); }
function ieHandleR(){ return Math.max(9, imgEditState.naturalW * 0.009); }
function ieHandleHitR(){
    var scale = (imgEditState.baseScale || 1) * (imgEditState.zoom || 1);
    var minTouchPx = 22;
    return Math.max(ieHandleR(), minTouchPx / scale);
}
function ieStrokeWFor(shape){
    var key = (shape && shape.strokeSize) || imgEditState.thickness || 'M';
    var f = IE_THICKNESS_FACTORS[key] || IE_THICKNESS_FACTORS.M;
    return Math.max(2, imgEditState.naturalW * f);
}
function ieFontDefault(){ return Math.max(18, imgEditState.naturalW * 0.035); }
function ieColorId(c){ return 'ie_' + c.replace('#',''); }
function ieTextBoxSize(shape){
    return { w: Math.max(20, (shape.text.length||1) * shape.fontSize * 0.55), h: shape.fontSize*1.2 };
}

function openImageEditor(){
    var cropImg = document.getElementById('cropImg');
    if (!cropImg || !cropImg.src) { alert('Gambar belum siap untuk diedit.'); return; }
    imgEditState.shapes = []; imgEditState.selectedId = null; imgEditState.nextId = 1;
    imgEditState.tool = 'select'; imgEditState.color = '#e53935'; imgEditState.thickness = 'M'; imgEditState.zoom = 1;
    setEditTool('select');
    var swatches = document.querySelectorAll('.edit-color-swatch');
    swatches.forEach(function(s){ s.classList.toggle('active', s.getAttribute('data-color') === imgEditState.color); });
    var tswatches = document.querySelectorAll('.edit-thick-swatch');
    tswatches.forEach(function(s){ s.classList.toggle('active', s.getAttribute('data-thick') === imgEditState.thickness); });
    ieUpdateZoomLabel();
    var editImg = document.getElementById('editImg');
    editImg.onload = function(){
        imgEditState.naturalW = editImg.naturalWidth;
        imgEditState.naturalH = editImg.naturalHeight;
        fitEditImageToWrap();
        renderAllShapes();
    };
    imgEditState.sourceUrl = cropImg.src;
    editImg.src = cropImg.src;
    document.getElementById('editImgModal').classList.add('show');
}

function fitEditImageToWrap(){
    var outer = document.getElementById('editImgOuter');
    var wrap = document.getElementById('editImgWrap');
    var img = document.getElementById('editImg');
    var svg = document.getElementById('editSvgOverlay');
    var ow = outer.clientWidth, oh = outer.clientHeight;
    var nw = imgEditState.naturalW, nh = imgEditState.naturalH;
    if (!nw || !nh || !ow || !oh) return;
    var baseScale = Math.min(ow/nw, oh/nh);
    imgEditState.baseScale = baseScale;
    var scale = baseScale * (imgEditState.zoom || 1);
    var dw = nw*scale, dh = nh*scale;
    wrap.style.width = dw+'px'; wrap.style.height = dh+'px';
    img.style.width = dw+'px'; img.style.height = dh+'px';
    svg.style.width = dw+'px'; svg.style.height = dh+'px';
    svg.setAttribute('viewBox', '0 0 '+nw+' '+nh);
    outer.style.justifyContent = (dw <= ow + 1) ? 'center' : 'flex-start';
    outer.style.alignItems = (dh <= oh + 1) ? 'center' : 'flex-start';
    if (dw > ow) outer.scrollLeft = Math.max(0, (dw-ow)/2);
    if (dh > oh) outer.scrollTop = Math.max(0, (dh-oh)/2);
}
function ieUpdateZoomLabel(){
    var lbl = document.getElementById('editZoomLabel');
    if (lbl) lbl.textContent = Math.round((imgEditState.zoom||1)*100) + '%';
}
function ieSetZoom(z){
    imgEditState.zoom = Math.max(IE_ZOOM_MIN, Math.min(IE_ZOOM_MAX, z));
    ieUpdateZoomLabel();
    fitEditImageToWrap();
}
function ieZoomIn(){ ieSetZoom((imgEditState.zoom||1) + IE_ZOOM_STEP); }
function ieZoomOut(){ ieSetZoom((imgEditState.zoom||1) - IE_ZOOM_STEP); }
function ieZoomReset(){ ieSetZoom(1); }
window.addEventListener('resize', function(){
    if (document.getElementById('editImgModal').classList.contains('show')) fitEditImageToWrap();
});

function closeImageEditor(discard){
    document.getElementById('editImgModal').classList.remove('show');
    if (discard) { imgEditState.shapes = []; imgEditState.selectedId = null; }
}

function setEditTool(tool){
    imgEditState.tool = tool;
    deselectShape();
    document.querySelectorAll('.edit-tool-btn[data-tool]').forEach(function(b){
        b.classList.toggle('active', b.getAttribute('data-tool') === tool);
    });
    var svg = document.getElementById('editSvgOverlay');
    svg.style.cursor = (tool === 'select') ? 'default' : (tool === 'pan' ? 'grab' : 'crosshair');
}

/* Kembali ke tool 'select' setelah shape baru dibuat, TANPA menghapus seleksi
   shape yang baru saja dibuat (supaya langsung bisa digeser/resize). */
function ieBackToSelectKeepSelection(){
    imgEditState.tool = 'select';
    document.querySelectorAll('.edit-tool-btn[data-tool]').forEach(function(b){
        b.classList.toggle('active', b.getAttribute('data-tool') === 'select');
    });
    var svg = document.getElementById('editSvgOverlay');
    svg.style.cursor = 'default';
}

function setEditColor(color, btnEl){
    imgEditState.color = color;
    document.querySelectorAll('.edit-color-swatch').forEach(function(s){ s.classList.remove('active'); });
    if (btnEl) btnEl.classList.add('active');
    var sel = getShapeById(imgEditState.selectedId);
    if (sel) { sel.color = color; renderAllShapes(); }
}

function setEditThickness(key, btnEl){
    imgEditState.thickness = key;
    document.querySelectorAll('.edit-thick-swatch').forEach(function(s){ s.classList.remove('active'); });
    if (btnEl) btnEl.classList.add('active');
    var sel = getShapeById(imgEditState.selectedId);
    if (sel && sel.type !== 'text') { sel.strokeSize = key; renderAllShapes(); }
}

function getShapeById(id){
    for (var i=0;i<imgEditState.shapes.length;i++) if (imgEditState.shapes[i].id === id) return imgEditState.shapes[i];
    return null;
}
function addShape(shape){
    shape.id = imgEditState.nextId++;
    imgEditState.shapes.push(shape);
    return shape;
}
function ieSetSelButtonsDisplay(shape){
    var isText = !!(shape && shape.type === 'text');
    var db = document.getElementById('editDeleteBtn'); if (db) db.style.display = shape ? 'flex' : 'none';
    var tb = document.getElementById('editTextEditBtn'); if (tb) tb.style.display = isText ? 'flex' : 'none';
    var sb = document.getElementById('editTextSmallerBtn'); if (sb) sb.style.display = isText ? 'flex' : 'none';
    var bb = document.getElementById('editTextBiggerBtn'); if (bb) bb.style.display = isText ? 'flex' : 'none';
}
function deselectShape(){
    imgEditState.selectedId = null;
    ieSetSelButtonsDisplay(null);
    renderAllShapes();
}
function setSelectedShape(id){
    imgEditState.selectedId = id;
    var shape = getShapeById(id);
    ieSetSelButtonsDisplay(shape);
    if (shape) {
        document.querySelectorAll('.edit-color-swatch').forEach(function(s){ s.classList.toggle('active', s.getAttribute('data-color')===shape.color); });
        if (shape.strokeSize) document.querySelectorAll('.edit-thick-swatch').forEach(function(s){ s.classList.toggle('active', s.getAttribute('data-thick')===shape.strokeSize); });
    }
    renderAllShapes();
}
function deleteSelectedShape(){
    if (!imgEditState.selectedId) return;
    imgEditState.shapes = imgEditState.shapes.filter(function(s){ return s.id !== imgEditState.selectedId; });
    deselectShape();
}
function editSelectedText(){
    var s = getShapeById(imgEditState.selectedId);
    if (!s || s.type !== 'text') return;
    var val = prompt('Edit teks:', s.text);
    ieForceHideKeyboard();
    if (val === null) return;
    s.text = val || ' ';
    renderAllShapes();
}
/* Fix: setelah window.prompt() ditutup di Android Chrome, soft keyboard kadang
   "menempel" (tidak ikut turun) karena tidak ada <input> asli di halaman yang
   kehilangan fokus. Trik: fokuskan sebentar lalu blur input tersembunyi supaya
   Android benar-benar mendeteksi ada elemen form yang di-blur dan menutup IME. */
function ieForceHideKeyboard(){
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) {
        document.activeElement.blur();
    }
    var dummy = document.getElementById('ieKeyboardDismiss');
    if (!dummy) {
        dummy = document.createElement('input');
        dummy.id = 'ieKeyboardDismiss';
        dummy.setAttribute('type', 'text');
        dummy.style.position = 'fixed';
        dummy.style.top = '-1000px';
        dummy.style.left = '0';
        dummy.style.width = '1px';
        dummy.style.height = '1px';
        dummy.style.opacity = '0';
        document.body.appendChild(dummy);
    }
    // readonly saat focus supaya Android TIDAK memunculkan keyboard baru di
    // input dummy ini — cuma dipakai untuk memicu event blur yang sungguhan.
    dummy.setAttribute('readonly', 'readonly');
    dummy.focus();
    setTimeout(function(){ dummy.blur(); dummy.removeAttribute('readonly'); }, 0);
}
function ieResizeSelectedText(dir){
    var s = getShapeById(imgEditState.selectedId);
    if (!s || s.type !== 'text') return;
    var step = Math.max(2, imgEditState.naturalW*0.006);
    s.fontSize = Math.max(10, (s.fontSize||ieFontDefault()) + dir*step);
    renderAllShapes();
}

function getSvgPoint(evt){
    var svg = document.getElementById('editSvgOverlay');
    var rect = svg.getBoundingClientRect();
    var t = evt.touches ? (evt.touches[0] || evt.changedTouches[0]) : evt;
    var x = (t.clientX - rect.left) * (imgEditState.naturalW / rect.width);
    var y = (t.clientY - rect.top) * (imgEditState.naturalH / rect.height);
    return { x: x, y: y };
}

/* Pakai Pointer Events (bukan touchstart/mousedown terpisah) supaya drag di HP
   (Chrome/Safari Android & iOS) lebih andal — menghindari konflik event
   sentuh vs mouse sintetis yang kadang bikin drag "putus" di tengah jalan. */
function ieAddDocListeners(onMove, onUp){
    document.addEventListener('pointermove', onMove, {passive:false});
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}
function ieRemoveDocListeners(onMove, onUp){
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
}

/* ── Mulai gambar shape baru (drag dari kosong) ── */
function onEditSvgPointerDown(e){
    var tool = imgEditState.tool;
    if (tool === 'pan') {
        if (e.cancelable) e.preventDefault();
        var outer = document.getElementById('editImgOuter');
        var t0 = e.touches ? e.touches[0] : e;
        var startX = t0.clientX, startY = t0.clientY;
        var startL = outer.scrollLeft, startT = outer.scrollTop;
        var svgEl = document.getElementById('editSvgOverlay'); svgEl.style.cursor = 'grabbing';
        function onMove(mv){
            if (mv.cancelable) mv.preventDefault();
            var t = mv.touches ? mv.touches[0] : mv;
            outer.scrollLeft = startL - (t.clientX - startX);
            outer.scrollTop = startT - (t.clientY - startY);
        }
        function onUp(){ ieRemoveDocListeners(onMove, onUp); svgEl.style.cursor = 'grab'; }
        ieAddDocListeners(onMove, onUp);
        return;
    }
    if (tool === 'select') { if (e.target.id === 'editSvgOverlay') deselectShape(); return; }
    if (e.cancelable) e.preventDefault();
    var pt = getSvgPoint(e);
    if (tool === 'text') {
        var txt = prompt('Masukkan teks:');
        ieForceHideKeyboard();
        if (txt && txt.trim()) {
            var shapeT = addShape({type:'text', x:pt.x, y:pt.y, text:txt.trim(), color:imgEditState.color, fontSize: ieFontDefault()});
            setSelectedShape(shapeT.id);
        }
        ieBackToSelectKeepSelection();
        return;
    }
    imgEditState.drawing = {type:tool, x1:pt.x, y1:pt.y, x2:pt.x, y2:pt.y, color:imgEditState.color, strokeSize:imgEditState.thickness};
    renderAllShapes();
    function onMove(mv){
        if (mv.cancelable) mv.preventDefault();
        var p = getSvgPoint(mv);
        imgEditState.drawing.x2 = p.x; imgEditState.drawing.y2 = p.y;
        renderAllShapes();
    }
    function onUp(){
        ieRemoveDocListeners(onMove, onUp);
        var d = imgEditState.drawing; imgEditState.drawing = null;
        if (d && (Math.abs(d.x2-d.x1) > 4 || Math.abs(d.y2-d.y1) > 4)) {
            var shape;
            if (d.type === 'rect' || d.type === 'oval') {
                shape = addShape({type:d.type, x:Math.min(d.x1,d.x2), y:Math.min(d.y1,d.y2), w:Math.abs(d.x2-d.x1), h:Math.abs(d.y2-d.y1), color:d.color, strokeSize:d.strokeSize, rotation:0});
            } else {
                shape = addShape({type:d.type, x1:d.x1, y1:d.y1, x2:d.x2, y2:d.y2, color:d.color, strokeSize:d.strokeSize});
            }
            setSelectedShape(shape.id);
            ieBackToSelectKeepSelection();
        } else { renderAllShapes(); }
    }
    ieAddDocListeners(onMove, onUp);
}

/* ── Pindahkan shape yang ada (drag body) ── */
function startDragShape(id, ev){
    setSelectedShape(id);
    var shape = getShapeById(id);
    if (!shape) return;
    var startPt = getSvgPoint(ev);
    var orig = JSON.parse(JSON.stringify(shape));
    function onMove(mv){
        if (mv.cancelable) mv.preventDefault();
        var p = getSvgPoint(mv);
        var dx = p.x - startPt.x, dy = p.y - startPt.y;
        if (shape.type === 'line' || shape.type === 'arrow') {
            shape.x1 = orig.x1+dx; shape.y1 = orig.y1+dy; shape.x2 = orig.x2+dx; shape.y2 = orig.y2+dy;
        } else {
            shape.x = orig.x+dx; shape.y = orig.y+dy;
        }
        renderAllShapes();
    }
    function onUp(){ ieRemoveDocListeners(onMove, onUp); }
    ieAddDocListeners(onMove, onUp);
}

/* ── Handle resize/endpoint drag ── */
function startHandleDrag(onDragMove){
    function onMove(mv){ if (mv.cancelable) mv.preventDefault(); onDragMove(getSvgPoint(mv)); renderAllShapes(); }
    function onUp(){ ieRemoveDocListeners(onMove, onUp); }
    ieAddDocListeners(onMove, onUp);
}

function ieMakeHandle(svg, cx, cy, cursor, onDragMove){
    var c = document.createElementNS(NS_SVG, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', ieHandleR());
    c.setAttribute('fill', '#2ecc71'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', Math.max(1,ieHandleR()*0.2));
    c.style.cursor = cursor; c.style.touchAction = 'none'; c.style.pointerEvents = 'none';
    svg.appendChild(c);
    // Hit-area transparan yang lebih besar, ditumpuk di atas titik visual,
    // supaya gampang dipencet di HP tanpa mengubah ukuran titik yang terlihat.
    var hit = document.createElementNS(NS_SVG, 'circle');
    hit.setAttribute('cx', cx); hit.setAttribute('cy', cy); hit.setAttribute('r', ieHandleHitR());
    hit.setAttribute('fill', 'transparent');
    hit.style.cursor = cursor; hit.style.touchAction = 'none'; hit.style.pointerEvents = 'all';
    hit.addEventListener('pointerdown', function(e){ e.stopPropagation(); if (e.cancelable) e.preventDefault(); startHandleDrag(onDragMove); });
    svg.appendChild(hit);
}

/* ── Bangun 1 elemen visual shape (dipakai utk overlay interaktif & flatten) ── */
function ieBuildShapeVisual(shape){
    var el;
    if (shape.type === 'rect') {
        el = document.createElementNS(NS_SVG, 'rect');
        el.setAttribute('x', shape.x); el.setAttribute('y', shape.y);
        el.setAttribute('width', shape.w); el.setAttribute('height', shape.h);
        el.setAttribute('fill', 'none'); el.setAttribute('stroke', shape.color); el.setAttribute('stroke-width', ieStrokeWFor(shape));
    } else if (shape.type === 'oval') {
        el = document.createElementNS(NS_SVG, 'ellipse');
        el.setAttribute('cx', shape.x+shape.w/2); el.setAttribute('cy', shape.y+shape.h/2);
        el.setAttribute('rx', shape.w/2); el.setAttribute('ry', shape.h/2);
        el.setAttribute('fill', 'none'); el.setAttribute('stroke', shape.color); el.setAttribute('stroke-width', ieStrokeWFor(shape));
    } else if (shape.type === 'line' || shape.type === 'arrow') {
        el = document.createElementNS(NS_SVG, 'line');
        el.setAttribute('x1', shape.x1); el.setAttribute('y1', shape.y1);
        el.setAttribute('x2', shape.x2); el.setAttribute('y2', shape.y2);
        el.setAttribute('stroke', shape.color); el.setAttribute('stroke-width', ieStrokeWFor(shape)); el.setAttribute('stroke-linecap', 'round');
        if (shape.type === 'arrow') el.setAttribute('marker-end', 'url(#'+ieColorId(shape.color)+')');
    } else if (shape.type === 'text') {
        el = document.createElementNS(NS_SVG, 'text');
        el.setAttribute('x', shape.x); el.setAttribute('y', shape.y + shape.fontSize);
        el.setAttribute('fill', shape.color); el.setAttribute('font-size', shape.fontSize);
        el.setAttribute('font-family', 'Arial, sans-serif'); el.setAttribute('font-weight', '700');
        el.textContent = shape.text;
    }
    return el;
}

function ieBuildDefs(svg){
    var defs = document.createElementNS(NS_SVG, 'defs');
    ['#e53935','#1a1a1a','#1e88e5','#fdd835'].forEach(function(c){
        var marker = document.createElementNS(NS_SVG, 'marker');
        marker.setAttribute('id', ieColorId(c)); marker.setAttribute('markerWidth', '10'); marker.setAttribute('markerHeight', '10');
        marker.setAttribute('refX', '8'); marker.setAttribute('refY', '5'); marker.setAttribute('orient', 'auto');
        var path = document.createElementNS(NS_SVG, 'path');
        path.setAttribute('d', 'M0,0 L10,5 L0,10 Z'); path.setAttribute('fill', c);
        marker.appendChild(path); defs.appendChild(marker);
    });
    svg.appendChild(defs);
}

/* ── Rotasi titik (px,py) mengelilingi pusat (cx,cy) sejauh `deg` derajat ── */
function ieRotatePoint(px, py, cx, cy, deg){
    var rad = deg * Math.PI/180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var dx = px-cx, dy = py-cy;
    return { x: cx + dx*cos - dy*sin, y: cy + dx*sin + dy*cos };
}

/* ── Render ulang seluruh overlay interaktif (shapes + preview + handle seleksi) ── */
function renderAllShapes(){
    var svg = document.getElementById('editSvgOverlay');
    if (!svg) return;
    svg.innerHTML = '';
    ieBuildDefs(svg);
    imgEditState.shapes.forEach(function(shape){
        var g = document.createElementNS(NS_SVG, 'g');
        var visual = ieBuildShapeVisual(shape);
        if (!visual) return;
        g.appendChild(visual);
        // Hit-area lebih lebar supaya mudah disentuh (untuk garis/panah tipis,
        // dan bagian dalam kotak/oval yang defaultnya fill:none tidak bisa disentuh)
        if (shape.type === 'line' || shape.type === 'arrow') {
            var hit = document.createElementNS(NS_SVG, 'line');
            hit.setAttribute('x1', shape.x1); hit.setAttribute('y1', shape.y1);
            hit.setAttribute('x2', shape.x2); hit.setAttribute('y2', shape.y2);
            hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', Math.max(24, imgEditState.naturalW*0.02));
            g.insertBefore(hit, visual);
        } else if (shape.type === 'rect' || shape.type === 'oval') {
            var fhit = document.createElementNS(NS_SVG, shape.type === 'rect' ? 'rect' : 'ellipse');
            if (shape.type === 'rect') {
                fhit.setAttribute('x', shape.x); fhit.setAttribute('y', shape.y);
                fhit.setAttribute('width', shape.w); fhit.setAttribute('height', shape.h);
            } else {
                fhit.setAttribute('cx', shape.x+shape.w/2); fhit.setAttribute('cy', shape.y+shape.h/2);
                fhit.setAttribute('rx', shape.w/2); fhit.setAttribute('ry', shape.h/2);
            }
            fhit.setAttribute('fill', 'transparent');
            g.insertBefore(fhit, visual);
        } else if (shape.type === 'text') {
            // <text> secara default cuma bisa "diklik" tepat di garis huruf. Tambahkan
            // hit-area kotak penuh (transparan) supaya teks mudah digeser/dipilih di HP.
            var tb = ieTextBoxSize(shape);
            var padX = tb.w*0.08, padY = tb.h*0.15;
            var thit = document.createElementNS(NS_SVG, 'rect');
            thit.setAttribute('x', shape.x - padX); thit.setAttribute('y', shape.y - padY);
            thit.setAttribute('width', tb.w + padX*2); thit.setAttribute('height', tb.h + padY*2);
            thit.setAttribute('fill', 'transparent');
            g.insertBefore(thit, visual);
        }
        g.style.cursor = 'move';
        if ((shape.type === 'rect' || shape.type === 'oval') && shape.rotation) {
            var rcx = shape.x + shape.w/2, rcy = shape.y + shape.h/2;
            g.setAttribute('transform', 'rotate(' + shape.rotation + ' ' + rcx + ' ' + rcy + ')');
        }
        var start = (function(shapeId){ return function(ev){
            if (imgEditState.tool !== 'select') return;
            ev.stopPropagation(); if (ev.cancelable) ev.preventDefault();
            startDragShape(shapeId, ev);
        }; })(shape.id);
        g.addEventListener('pointerdown', start);
        svg.appendChild(g);

        if (shape.id === imgEditState.selectedId) {
            if (shape.type === 'rect' || shape.type === 'oval') {
                var rot = shape.rotation || 0;
                var cx = shape.x + shape.w/2, cy = shape.y + shape.h/2;
                var box = document.createElementNS(NS_SVG, 'rect');
                box.setAttribute('x', shape.x); box.setAttribute('y', shape.y);
                box.setAttribute('width', shape.w); box.setAttribute('height', shape.h);
                box.setAttribute('fill', 'none'); box.setAttribute('stroke', '#2ecc71');
                box.setAttribute('stroke-width', Math.max(1, imgEditState.naturalW*0.0015));
                box.setAttribute('stroke-dasharray', '6,4'); box.setAttribute('pointer-events', 'none');
                if (rot) box.setAttribute('transform', 'rotate(' + rot + ' ' + cx + ' ' + cy + ')');
                svg.appendChild(box);
                // Handle resize di pojok kanan-bawah — posisinya dihitung ulang sesuai
                // rotasi saat ini, dan resize dihitung di ruang LOKAL (belum dirotasi)
                // supaya tetap membesar/mengecil mengikuti arah kotaknya sendiri.
                var cornerLocal = {x: shape.x+shape.w, y: shape.y+shape.h};
                var cornerWorld = rot ? ieRotatePoint(cornerLocal.x, cornerLocal.y, cx, cy, rot) : cornerLocal;
                ieMakeHandle(svg, cornerWorld.x, cornerWorld.y, 'nwse-resize', function(p){
                    var local = rot ? ieRotatePoint(p.x, p.y, cx, cy, -rot) : p;
                    shape.w = Math.max(ieMinSize(), local.x-shape.x); shape.h = Math.max(ieMinSize(), local.y-shape.y);
                });
                // Handle rotasi — bulatan di atas tengah kotak, tarik memutar sekeliling pusat.
                var rotDist = Math.max(24, imgEditState.naturalW*0.03);
                var rotHandleLocal = {x: cx, y: shape.y - rotDist};
                var rotHandleWorld = rot ? ieRotatePoint(rotHandleLocal.x, rotHandleLocal.y, cx, cy, rot) : rotHandleLocal;
                var rotLine = document.createElementNS(NS_SVG, 'line');
                rotLine.setAttribute('x1', cx); rotLine.setAttribute('y1', shape.y);
                rotLine.setAttribute('x2', rotHandleLocal.x); rotLine.setAttribute('y2', rotHandleLocal.y);
                rotLine.setAttribute('stroke', '#2ecc71'); rotLine.setAttribute('stroke-width', Math.max(1, imgEditState.naturalW*0.0015));
                rotLine.setAttribute('pointer-events', 'none');
                if (rot) rotLine.setAttribute('transform', 'rotate(' + rot + ' ' + cx + ' ' + cy + ')');
                svg.appendChild(rotLine);
                ieMakeHandle(svg, rotHandleWorld.x, rotHandleWorld.y, 'grab', function(p){
                    var deg = Math.atan2(p.x-cx, -(p.y-cy)) * 180/Math.PI;
                    shape.rotation = Math.round(deg);
                });
            } else if (shape.type === 'line' || shape.type === 'arrow') {
                ieMakeHandle(svg, shape.x1, shape.y1, 'move', function(p){ shape.x1=p.x; shape.y1=p.y; });
                ieMakeHandle(svg, shape.x2, shape.y2, 'move', function(p){ shape.x2=p.x; shape.y2=p.y; });
            } else if (shape.type === 'text') {
                var tbSel = ieTextBoxSize(shape);
                var box2 = document.createElementNS(NS_SVG, 'rect');
                box2.setAttribute('x', shape.x); box2.setAttribute('y', shape.y);
                box2.setAttribute('width', tbSel.w); box2.setAttribute('height', tbSel.h);
                box2.setAttribute('fill', 'none'); box2.setAttribute('stroke', '#2ecc71');
                box2.setAttribute('stroke-width', Math.max(1, imgEditState.naturalW*0.0015));
                box2.setAttribute('stroke-dasharray', '6,4'); box2.setAttribute('pointer-events', 'none');
                svg.appendChild(box2);
                ieMakeHandle(svg, shape.x+tbSel.w, shape.y+tbSel.h, 'nwse-resize', function(p){
                    var newH = Math.max(10, p.y-shape.y);
                    shape.fontSize = newH/1.2;
                });
            }
        }
    });
    if (imgEditState.drawing) {
        var dvisual = ieBuildShapeVisual(
            (imgEditState.drawing.type==='rect'||imgEditState.drawing.type==='oval')
            ? {type:imgEditState.drawing.type, x:Math.min(imgEditState.drawing.x1,imgEditState.drawing.x2), y:Math.min(imgEditState.drawing.y1,imgEditState.drawing.y2), w:Math.abs(imgEditState.drawing.x2-imgEditState.drawing.x1), h:Math.abs(imgEditState.drawing.y2-imgEditState.drawing.y1), color:imgEditState.drawing.color, strokeSize:imgEditState.drawing.strokeSize}
            : imgEditState.drawing
        );
        if (dvisual) { dvisual.setAttribute('opacity','0.75'); svg.appendChild(dvisual); }
    }
}

(function initEditSvgEvents(){
    var svg = document.getElementById('editSvgOverlay');
    if (!svg) return;
    svg.addEventListener('pointerdown', onEditSvgPointerDown);
})();

/* ── Terapkan semua anotasi: gabung ke gambar asli, kembalikan ke #cropImg ── */
function applyImageEdits(){
    if (!imgEditState.shapes.length) { closeImageEditor(false); return; }
    var nw = imgEditState.naturalW, nh = imgEditState.naturalH;
    var flatSvg = document.createElementNS(NS_SVG, 'svg');
    flatSvg.setAttribute('xmlns', NS_SVG);
    flatSvg.setAttribute('width', nw); flatSvg.setAttribute('height', nh);
    flatSvg.setAttribute('viewBox', '0 0 '+nw+' '+nh);
    ieBuildDefs(flatSvg);
    imgEditState.shapes.forEach(function(shape){
        var v = ieBuildShapeVisual(shape);
        if (!v) return;
        if ((shape.type === 'rect' || shape.type === 'oval') && shape.rotation) {
            var cx = shape.x + shape.w/2, cy = shape.y + shape.h/2;
            v.setAttribute('transform', 'rotate(' + shape.rotation + ' ' + cx + ' ' + cy + ')');
        }
        flatSvg.appendChild(v);
    });
    var svgStr = new XMLSerializer().serializeToString(flatSvg);
    var svgImg = new Image();
    svgImg.onload = function(){
        var canvas = document.createElement('canvas');
        canvas.width = nw; canvas.height = nh;
        var ctx = canvas.getContext('2d');
        var srcImg = new Image();
        srcImg.onload = function(){
            ctx.drawImage(srcImg, 0, 0, nw, nh);
            ctx.drawImage(svgImg, 0, 0, nw, nh);
            var outUrl = canvas.toDataURL('image/jpeg', 0.92);
            var cropImg = document.getElementById('cropImg');
            cropImg.onload = function(){
                var wrap = document.getElementById('cropWrap');
                var ww = wrap.clientWidth, wh = wrap.clientHeight;
                var scale = Math.min(ww/cropImg.naturalWidth, wh/cropImg.naturalHeight);
                var dw = cropImg.naturalWidth*scale, dh = cropImg.naturalHeight*scale;
                cropImg.style.width = dw+'px'; cropImg.style.height = dh+'px';
                cropImg.style.left = ((ww-dw)/2)+'px'; cropImg.style.top = ((wh-dh)/2)+'px';
                if (cropModalState._mode === 'default') fitCropBoxToFullImage();
                else if (cropModalState._ratioLocked) reshapeCropBoxToRatio();
            };
            cropImg.src = outUrl;
            closeImageEditor(false);
        };
        srcImg.src = imgEditState.sourceUrl;
    };
    svgImg.onerror = function(){ alert('Gagal menerapkan anotasi pada gambar. Coba lagi.'); };
    svgImg.src = 'data:image/svg+xml;charset=utf-8;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
}
```

**Integrasi ke alur crop:** tidak perlu ubah apa pun di `cropAndSave()`/`skipCrop()` yang sudah ada — `applyImageEdits()` sudah menulis hasil flatten balik ke `#cropImg` sebelum modal edit ditutup, jadi crop tetap jalan di atas gambar yang sudah dianotasi.

**Butuh dari user:** tidak ada konfigurasi tambahan — modul ini generic (tidak menyentuh struktur data form/tabel).

---

## K. Rotasi Kotak & Oval
**Status: ✅ SUDAH terintegrasi penuh** ke dalam dump kode Fitur J di atas, sejak sumber Fitur J diganti ke `form_o2_report.html`. **Tidak perlu ditempel terpisah** — kode rotasi (`ieRotatePoint`, transform di `renderAllShapes()`/`applyImageEdits()`, handle rotasi baru) sudah menyatu langsung di kode Fitur J. Bagian di bawah ini cuma penjelasan cara kerjanya buat referensi/debug, bukan kode tempel terpisah lagi. (Awalnya fitur ini datang dari `material-warehouse.html` sebelum ikut dibawa masuk ke `form_o2_report.html`.)

Garis/panah sudah bisa "diputar" tanpa fitur tambahan — cukup tarik salah satu titik ujungnya (sudah otomatis mengubah arah). Teks sengaja **tidak** dikasih rotasi (belum diminta, dan `<text>` SVG butuh penanganan bounding-box ekstra kalau mau diputar).

**Cara kerja:** setiap shape kotak/oval punya field `rotation` (derajat, default `0`). Rotasi diterapkan sebagai atribut `transform="rotate(deg cx cy)"` pada elemen `<g>` pembungkus shape (bukan pada elemen visual `<rect>`/`<ellipse>` itu sendiri) — ini otomatis ikut merotasi hit-area transparannya juga (Fitur J) tanpa perlu perubahan lain.

```js
function ieRotatePoint(px, py, cx, cy, deg){
    var rad = deg * Math.PI / 180;
    var dx = px - cx, dy = py - cy;
    return { x: cx + dx*Math.cos(rad) - dy*Math.sin(rad), y: cy + dx*Math.sin(rad) + dy*Math.cos(rad) };
}
```

**Di `renderAllShapes()`,** untuk shape kotak/oval:
1. `g.setAttribute('transform', 'rotate('+shape.rotation+' '+cx+' '+cy+')')` — `cx,cy` = titik tengah shape (`shape.x+shape.w/2`, `shape.y+shape.h/2`).
2. Kotak seleksi (dashed box) dapat `transform` yang sama supaya ikut berputar visual.
3. **Handle resize** (pojok kanan-bawah) posisinya dihitung ulang tiap render pakai `ieRotatePoint()` supaya mengikuti rotasi saat ini, dan callback resize-nya me-rotate balik posisi pointer (`ieRotatePoint(p.x,p.y,cx,cy,-rot)`) ke ruang lokal (belum dirotasi) sebelum dipakai hitung `shape.w`/`shape.h` — **wajib**, kalau tidak resize akan "salah arah" begitu shape sedang dalam keadaan berotasi.
4. **Handle rotasi baru** — bulatan hijau muncul di atas tengah kotak (jarak `Math.max(24, naturalW*0.03)` dari sisi atas), dihubungkan garis tipis ke pusat shape. Drag handle ini menghitung sudut lewat `Math.atan2(p.x-cx, -(p.y-cy)) * 180/Math.PI` lalu simpan ke `shape.rotation`.

**Di `applyImageEdits()` (flatten ke bitmap final),** transform rotasi yang sama harus ditempel manual ke elemen visual hasil `ieBuildShapeVisual(shape)` sebelum di-append ke `flatSvg` — kalau lupa, hasil PDF/gambar akhir shape kotak/oval-nya tidak akan ikut berputar meskipun tampilan di editor sudah benar.

**⚠️ Detail teknis yang perlu diingat:** field `rotation` di objek shape kotak/oval perlu default `0` saat dibuat (`addShape({..., rotation:0})`), jangan `undefined` — beberapa pengecekan pakai `if (shape.rotation)` yang akan salah treat `undefined` sama dengan `0` (aman) tapi lebih rapi eksplisit.

---

## L. Tabel Info Pekerjaan — Grid Full-Width (Label | Value)
**Sumber:** `form_o2_report.html` (Form O2 Report — PLTU Paiton Unit 7), hasil revisi bertahap.

**Tujuan:** ganti layout header info form (Work Order/Tanggal/PIC/Asset/dst) dari "2 kolom bersebelahan" jadi **1 tabel grid penuh selebar halaman**, gaya "Work Activity Report" — tiap field = 1 baris penuh, kolom label di kiri dan kolom value di kanan, dengan grid garis lengkap (bukan cuma border luar).

**Spesifikasi visual final (jangan dikurangi lagi tanpa diminta user):**
- Tiap field jadi satu baris penuh selebar `contentW`. Kolom label lebar tetap (`labelColW`, di O2 report = 40mm), kolom value mengisi sisanya.
- Grid: border luar + garis vertikal (pemisah label|value) + garis horizontal (antar baris) — semua **hitam** `RGB(0,0,0)`. Lebar garis luar `0.35`, garis dalam `0.25`.
- Background tabel: **kuning pucat** `RGB(255,251,214)` (fill pakai `doc.rect(...,'FD')` — fill+stroke sekaligus).
- Semua teks (label maupun value) **bold** (`helvetica`, `bold`, size `8.5`) — termasuk saat `splitTextToSize` dipanggil (font bold harus di-set SEBELUM hitung wrap, supaya lebar wrap-nya akurat).
- Label tetap dibedakan warna (biru `55,80,140`) dari value (`20,30,25`) meski sama-sama bold, supaya masih ada pembeda visual.
- Tinggi baris dikompres (row height ringkas, tidak terlalu tinggi): `h = Math.max(7.5, 4.6 + (lines.length-1)*3.8 + 2.5)`, baseline teks di `rowY + 4.6`.
- Baris pertama TIDAK digambar garis horizontal (border luar tabel sudah jadi batas atasnya); baris ke-2 dst baru digambar garis pemisah horizontal SEBELUM teks baris itu digambar.

**Kode inti (jsPDF, ditaruh setelah `secHeader(...)` judul form, sebelum bagian dokumentasi/channel/isi lain):**
```js
var padIn = 3;
var labelColW = 40; // sesuaikan lebar kolom label per form
var valueX = marginX + labelColW + padIn;
var valueW = contentW - labelColW - padIn*2;

var infoFields = [
  ['{{Label1}}', safe(value1)],
  ['{{Label2}}', safe(value2)]
  // ... field lain, urutkan sesuai form tujuan
];

doc.setFont('helvetica','bold'); doc.setFontSize(8.5); // font bold dulu SEBELUM wrap dihitung
var infoRows = infoFields.map(function(f){
  var lines = doc.splitTextToSize(String(f[1]||''), valueW);
  var h = Math.max(7.5, 4.6 + (lines.length-1)*3.8 + 2.5);
  return {label:f[0], lines:lines, h:h};
});
var totalH = infoRows.reduce(function(s,r){ return s + r.h; }, 0);
checkPage(totalH + 4);

// Background kuning pucat + border luar (FD = fill + stroke sekaligus)
doc.setFillColor(255, 251, 214);
doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.35);
doc.rect(marginX, y, contentW, totalH, 'FD');
// Garis vertikal pemisah kolom label | value, sepanjang tabel
doc.line(marginX+labelColW, y, marginX+labelColW, y+totalH);

var rowY = y;
doc.setLineWidth(0.25); doc.setDrawColor(0, 0, 0);
infoRows.forEach(function(r, idx){
  if (idx > 0) doc.line(marginX, rowY, marginX+contentW, rowY); // garis antar baris
  doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(55,80,140);
  doc.text(r.label, marginX+padIn, rowY+4.6);
  doc.setFont('helvetica','bold'); doc.setTextColor(20,30,25);
  doc.text(r.lines, valueX, rowY+4.6);
  rowY += r.h;
});

y += totalH + 6;
```

**⚠️ Potensi Konflik:** ini menggantikan pola lama "2 kolom bersebelahan + 1 garis vertikal tengah + garis section besar" yang sempat dipakai di revisi sebelumnya pada file yang sama — **JANGAN gabung/pakai bareng** pola lama itu di tabel yang sama, pilih salah satu (pola grid full-width ini yang terbaru/disetujui user).

**Butuh dari user:** daftar `infoFields` (nama label + urutan) persis sesuai form tujuan, dan lebar `labelColW` kalau label form itu jauh lebih panjang/pendek dari 40mm — **jangan menebak**, baca dari form yang diupload atau tanya user.

---

## M. Upload Otomatis Foto ke Google Drive
**Sumber:** ditambahkan pertama kali ke `ph-analyzer.html`, lalu dipusatkan ke `shared.js` supaya semua modul otomatis kebagian.

**Tujuan:** setiap kali foto PM selesai di-crop/disimpan ke array gambar, foto itu juga otomatis (silent, non-blocking) terkirim sebagai backup ke folder Google Drive tertentu lewat Apps Script Web App — terpisah dari penyimpanan utama di Supabase. Kalau upload gagal (mis. offline), proses simpan PDF/data utama TETAP jalan normal karena panggilannya non-blocking (tidak pakai `await`, tidak menghentikan alur kalau gagal).

**Backend (di luar HTML — Google Apps Script):**
- Kode `doPost(e)` di-deploy sebagai Web App (Execute as: Me, Who has access: Anyone) dari sebuah Google Sheets (`DATABASE EIC7`), fungsinya: terima `{token, imageBase64, fileName, modul, keterangan}` → validasi token → decode base64 → **hapus file lama dengan nama sama kalau ada (overwrite, bukan menumpuk duplikat)** → simpan file ke folder Drive (`FOLDER_ID`) → catat metadata ke sheet `UploadLog`.
- URL deployment (`.../exec`) dan folder tujuan **tidak akan berubah** kecuali di-redeploy ulang atau folder Drive-nya dipindah/dihapus.
- **Perilaku overwrite:** karena upload dipicu ulang setiap kali foto di-crop/di-edit ulang (termasuk saat buka record dari Riwayat lalu ganti foto), file lama dengan `fileName` yang sama di folder Drive otomatis dipindah ke Trash sebelum file baru dibuat — jadi 1 foto = 1 file terbaru di Drive, tidak menumpuk versi lama. Konsekuensinya: sheet `UploadLog` tetap akan bertambah baris tiap upload (riwayat log tidak ikut ke-overwrite, cuma file fisik di Drive-nya), jadi `UploadLog` masih bisa dipakai untuk lihat kapan-kapan aja suatu foto diubah.

**Konfigurasi + fungsi inti — SUDAH ADA di `shared.js`, jangan duplikat lagi ke HTML manapun:**
```js
var GDRIVE_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxyxAOQaIFkT9EZtTHfkjQeG3TlkLnEu2AKVyhUnguK7Td_zls1qL7IPB_hLsXTaLNBHA/exec';
var GDRIVE_SECRET_TOKEN = 'pmeicunit7-mahfud';

function uploadFotoKeGDrive(dataUrlBase64, fileName, modul, keterangan) {
  if (!GDRIVE_WEB_APP_URL || !dataUrlBase64 || !fileName) return;
  fetch(GDRIVE_WEB_APP_URL, {
    method: 'POST',
    body: JSON.stringify({
      token: GDRIVE_SECRET_TOKEN,
      imageBase64: dataUrlBase64,
      fileName: fileName,
      modul: modul || (window.CURRENT_MODUL || 'unknown'),
      keterangan: keterangan || ''
    })
  }).then(function(res){ return res.json(); })
    .then(function(result){ if (!result.success) console.error('Upload GDrive gagal:', result.error); })
    .catch(function(err){ console.error('Upload GDrive error:', err); });
}
```

**Titik integrasi berbeda tergantung pola crop yang dipakai file tujuan (cek dulu, lihat item #5 di Checklist Konfigurasi):**

1. **File yang masih pakai pola lama `imgOpenCropper` / `imgCompressAndStore` (shared.js)** — **TIDAK PERLU diubah sama sekali**. Panggilan `uploadFotoKeGDrive(dataUrl, name, modulePrefix, caption)` sudah ditempel otomatis di dalam `imgCompressAndStore()` di `shared.js` sendiri (tepat setelah entry disimpan ke `imgArr` — sejak v1.1, `imgCompressAndStore` menerima parameter `replaceIdx` dan mengganti entry di posisi yang sama kalau re-crop, bukan selalu `push` ke akhir), jadi semua modul yang lewat fungsi ini (op, bs, cf, dcs, cl, ld, fm, hg, dst) otomatis ke-backup ke Drive begitu `shared.js` di-update.

2. **File yang pakai pola baru `cropAndSave()` 3-mode (Fitur B, duplikat per file — mis. `ph-analyzer.html`)** — fungsi `cropAndSave()`-nya ada LOKAL di tiap file (bukan di `shared.js`), jadi perlu **beberapa baris tambahan manual** tepat di titik penyimpanan entry (lihat juga catatan wajib di Fitur C soal in-place replace):
   ```js
   // Foto yang di-edit ulang (replaceIdx>=0) ditaruh KEMBALI di posisi yang sama,
   // bukan dihapus lalu ditambahkan di akhir array.
   if (existing) imgArr.splice(p.replaceIdx, 1, entry);
   else imgArr.push(entry);
   uploadFotoKeGDrive(entry.dataUrl, entry.name, window.CURRENT_MODUL, p.side || '');
   closeCropModal();
   ```
   Fungsi `uploadFotoKeGDrive` sendiri **tidak perlu didefinisikan ulang** di file ini — otomatis kepakai dari `shared.js` karena sudah di-`<script src="shared.js">`.

**⚠️ Kasus khusus — file yang objek foto-nya TIDAK punya field `name`/`fileName` (mis. `so2.html`, entry cuma `{dataUrl, caption, offsetX, widthCm, heightCm}`):**
   nama file untuk Drive harus digenerate manual di titik panggil, dan **harus stabil per slot foto** (bukan `Date.now()`/timestamp) supaya fitur overwrite-otomatis di Apps Script (lihat bawah) tetap jalan saat foto itu di-crop ulang nanti:
   ```js
   var slotIdx = (p.replaceIdx >= 0) ? p.replaceIdx : imgArr.length;
   // ...push/replace imgArr seperti biasa...
   var gdriveFileName = '{{modulPrefix}}_' + p.groupKey + '_' + slotIdx + '.jpg';
   uploadFotoKeGDrive(entry.dataUrl, gdriveFileName, '{{modulPrefix}}', p.groupKey || '');
   ```
   Ganti `{{modulPrefix}}` sesuai modul (mis. `'so2'`). Kalau dipakai timestamp, tiap crop ulang dianggap foto baru dan numpuk file di Drive alih-alih overwrite.

**⚠️ Potensi Konflik:** kalau ternyata satu file sudah pernah ditempel versi lama (fungsi `uploadFotoKeGDrive` didefinisikan ulang secara lokal di dalam file HTML-nya sendiri, bukan cuma dipanggil) — itu HARUS dihapus, supaya tidak ada 2 definisi fungsi yang sama-sama global dan salah satu menimpa `shared.js` (kalau URL/token-nya beda, foto bisa nyasar upload ke 2 tempat beda tanpa disadari).

**Butuh dari user:** tidak ada — folder Drive tujuan dan token sudah fixed di `shared.js`. Kalau user minta ganti folder tujuan atau bikin token baru, update `GDRIVE_WEB_APP_URL`/`GDRIVE_SECRET_TOKEN` di `shared.js` SEKALI SAJA (bukan per file).

---

## N. Checkbox Vektor untuk PDF
**Tujuan:** menampilkan tanda centang/silang (Y/N, Pass/Fail, OK/NG, dsb) di tabel hasil PDF sebagai kotak+centang yang digambar vektor — bukan karakter unicode (`✓`, `✔`, `☑`, dst) yang ditulis langsung lewat `doc.text(...)`.

**⚠️ Kenapa ini penting:** font standar bawaan jsPDF (`helvetica`, `times`, `courier`) memakai encoding WinAnsi dan **tidak punya glyph untuk karakter centang unicode**. Kalau `doc.text('\u2713', ...)` atau `doc.text('✓', ...)` dipakai langsung, hasil cetak PDF-nya bukan tanda centang, melainkan **titik** (atau kotak kosong/`.notdef`, tergantung viewer PDF). Ini baru ketahuan setelah user cek preview PDF asli — tidak kelihatan dari kode-nya doang.

**Ditemukan pertama kali di:** `coal_feeder_calibration.html` (Agustus 2026), lalu direplikasi ke file lain yang punya pola serupa (checklist Y/N, Pass/Fail) — lihat Riwayat Revisi v1.1.

```js
// Kotak centang digambar sebagai checkbox visual (kotak + centang vektor),
// bukan karakter unicode ✓ — karena font standar jsPDF (helvetica) tidak
// punya glyph untuk \u2713 sehingga tercetak sebagai titik.
function drawCheckboxBs(doc, x, y, w, h, checked, tone){
  var size = Math.min(w, h) * 0.55;
  var bx = x + w/2 - size/2, by = y + h/2 - size/2;
  doc.setLineWidth(0.4);
  if (checked) {
    var fill = tone === 'red' ? [204,60,60] : [46,204,113];
    var strk = tone === 'red' ? [140,30,30] : [30,140,74];
    doc.setDrawColor(strk[0],strk[1],strk[2]); doc.setFillColor(fill[0],fill[1],fill[2]);
    doc.rect(bx, by, size, size, 'FD');
    doc.setDrawColor(255,255,255); doc.setLineWidth(0.6);
    doc.line(bx+size*0.18, by+size*0.52, bx+size*0.40, by+size*0.76);
    doc.line(bx+size*0.40, by+size*0.76, bx+size*0.84, by+size*0.22);
  } else {
    doc.setDrawColor(150,160,155); doc.setFillColor(255,255,255);
    doc.rect(bx, by, size, size, 'FD');
  }
}
```

**Cara pakai di dalam `autoTable`:** JANGAN taruh `'✓'`/`'\u2713'` sebagai isi cell di array `body`. Kosongkan cell itu (`''`), lalu gambar checkbox-nya lewat callback `didDrawCell` (dieksekusi setelah cell digambar, jadi posisi `d.cell.x/y/width/height` sudah pasti benar termasuk di halaman lanjutan):
```js
doc.autoTable({
  // ...
  body: rows.map(function(r){ return [r.no, r.deskripsi, '', '']; }), // kolom Y/N dikosongkan
  didDrawCell:function(d){
    if (d.section!=='body') return;
    var r = rows[d.row.index];
    if (!r) return;
    if (d.column.index===2 && r.yn==='Y') drawCheckboxBs(doc, d.cell.x, d.cell.y, d.cell.width, d.cell.height, true, 'green');
    if (d.column.index===3 && r.yn==='N') drawCheckboxBs(doc, d.cell.x, d.cell.y, d.cell.width, d.cell.height, true, 'red');
  }
});
```

**Butuh dari user:** tidak ada — ini pure PDF-rendering fix, tidak menyentuh struktur data/form. Cukup cek kolom mana di tabel PDF yang pakai centang unicode, lalu ganti dengan pola di atas.

**⚠️ Potensi Konflik:** kalau file tujuan sudah punya fungsi bernama `drawCheckboxBs` dengan tanda tangan (signature) beda — samakan dulu ke pola di atas, jangan biarkan 2 definisi beda saling menimpa.

---

## O. Urutkan Foto (Tukar Posisi Kiri/Kanan)
**Tujuan:** membetulkan urutan foto dalam satu galeri (mis. foto ke-3 dan ke-5 kebalik) tanpa drag & drop — cukup centang 1 foto lalu tekan panah kiri/kanan untuk menukar posisinya dengan tetangga.

**Ditemukan pertama kali di:** `form_o2_report.html` (Agustus 2026).

**Cara kerja:** tombol toggle "🔀 Urutkan Foto" ditaruh nempel di sebelah kanan foto terakhir galeri (bukan modal terpisah). Saat mode aktif: tombol crop & hapus tiap foto disembunyikan sementara, diganti checkbox single-select (centang 1 foto membatalkan pilihan sebelumnya). Setelah 1 foto dicentang, muncul tombol ◀ Kiri / ▶ Kanan yang menukar **seluruh object foto** (bukan cuma src-nya) dengan tetangganya — jadi caption, ukuran/preset crop, dan offset posisi PDF otomatis ikut pindah karena itu satu kesatuan object yang di-swap, bukan field-per-field. Foto yang sama tetap tercentang di posisi barunya supaya bisa digeser berkali-kali. Tombol "✓ Selesai" keluar dari mode, balikin tombol crop/hapus.

**⚠️ WAJIB dipasangkan dengan Fitur Q** — kalau file tujuan masih pakai pola render lama yang selalu re-sync caption dari DOM di awal fungsi render (tanpa `skipSync`), fitur tukar posisi ini akan **bikin caption ketuker** (lihat Fitur Q).

```js
// State per galeri (key: '{{chKey}}_{{phase}}' atau sejenisnya — sesuaikan skema key file tujuan)
var {{prefix}}ReorderState = {};

function {{prefix}}ToggleReorder(chKey, phase) {
  var stKey = chKey+'_'+phase;
  var st = {{prefix}}ReorderState[stKey] || ({{prefix}}ReorderState[stKey] = {active:false, selectedIdx:null});
  st.active = !st.active;
  st.selectedIdx = null;
  {{prefix}}RenderPreviews(chKey, phase);
}

function {{prefix}}SelectForReorder(chKey, phase, idx, checked) {
  var stKey = chKey+'_'+phase;
  var st = {{prefix}}ReorderState[stKey] || ({{prefix}}ReorderState[stKey] = {active:false, selectedIdx:null});
  st.selectedIdx = checked ? idx : null;
  {{prefix}}RenderPreviews(chKey, phase);
}

function {{prefix}}MoveImg(chKey, phase, dir) {
  var stKey = chKey+'_'+phase;
  var st = {{prefix}}ReorderState[stKey];
  if (!st || st.selectedIdx === null) return;
  var arr = {{imgArr}}; // mis. o2Images[chKey][phase]
  var i = st.selectedIdx, j = i + dir;
  if (j < 0 || j >= arr.length) return;
  {{prefix}}SyncCaptions(chKey, phase); // WAJIB — lihat Fitur Q, commit caption SEBELUM swap
  var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; // swap 1 object utuh — caption/crop/offset ikut
  st.selectedIdx = j;
  {{prefix}}RenderPreviews(chKey, phase, true); // skipSync=true — lihat Fitur Q
}
```
Di dalam fungsi render thumbnail (yang menggambar tiap foto), tambahkan pengecekan `st.active` untuk tukar tombol crop/hapus dengan checkbox, dan render tombol toggle+panah setelah loop foto:
```js
// Di dalam .forEach(function(img, idx){ ... }) — ganti tombol crop & hapus:
var cropBtn = (isImg && !st.active) ? '<button onclick="...">✂️ Crop</button>' : '';
var removeBtn = !st.active
  ? '<button onclick="{{prefix}}RemoveImg(...)">&#215;</button>'
  : '<label style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#fff;border:2px solid var(--accent,#2563eb);display:flex;align-items:center;justify-content:center;cursor:pointer">'
    + '<input type="checkbox" '+(st.selectedIdx===idx?'checked':'')+' onchange="{{prefix}}SelectForReorder(\'{{chKey}}\',\'{{phase}}\','+idx+',this.checked)" style="margin:0;width:14px;height:14px;cursor:pointer"></label>';

// Setelah container.appendChild(wrap) di dalam forEach selesai — tombol kontrol di ujung galeri:
if (arr.length > 1) {
  var toggleBtn = '<button type="button" onclick="{{prefix}}ToggleReorder(\'{{chKey}}\',\'{{phase}}\')" style="background:'+(st.active?'var(--ok,#16a34a)':'#eef2f7')+';color:'+(st.active?'#fff':'#333')+';border:1px solid var(--border);border-radius:4px;font-size:10px;padding:5px 8px;cursor:pointer;white-space:nowrap">'+(st.active?'&#10003; Selesai':'&#128256; Urutkan Foto')+'</button>';
  var arrowsHtml = '';
  if (st.active && st.selectedIdx !== null) {
    var atStart = st.selectedIdx <= 0, atEnd = st.selectedIdx >= arr.length - 1;
    arrowsHtml = '<div style="display:flex;gap:4px">'
      + '<button type="button" '+(atStart?'disabled':'')+' onclick="{{prefix}}MoveImg(\'{{chKey}}\',\'{{phase}}\',-1)" style="flex:1;opacity:'+(atStart?'0.4':'1')+'">&#9664; Kiri</button>'
      + '<button type="button" '+(atEnd?'disabled':'')+' onclick="{{prefix}}MoveImg(\'{{chKey}}\',\'{{phase}}\',1)" style="flex:1;opacity:'+(atEnd?'0.4':'1')+'">Kanan &#9654;</button>'
      + '</div>';
  }
  // ctrl div ditaruh SEBAGAI SIBLING TERAKHIR di dalam container yang sama, vertical-align:top,
  // supaya nempel di sebelah kanan foto terakhir (bukan overlay/modal terpisah)
}
```
**Butuh dari user:** tidak ada — cukup baca nama array gambar (`{{imgArr}}`), nama fungsi render (`{{prefix}}RenderPreviews`), dan skema key galeri (`{{chKey}}`/`{{phase}}`, atau bisa lebih sederhana kalau file tujuan cuma punya 1 galeri per section tanpa sub-key) langsung dari kode file tujuan.

**⚠️ Potensi Konflik:** kalau file tujuan render foto dari template string (bukan `container.innerHTML=''` lalu `appendChild` per foto seperti O2), pola checkbox-gantikan-tombol tetap sama, tinggal disuntik ke template string-nya. Kalau nama tombol hapus/crop beda, sesuaikan seleksinya.

---

## P. Header + Baris Foto Pertama Tidak Terpisah Halaman
**Tujuan:** mencegah judul section/channel (kotak hijau/label BEFORE-AFTER/EVIDENCE, dst) tercetak sendirian di ujung bawah halaman PDF sementara baris foto pertamanya "kelempar" ke halaman berikutnya — kesalahan umum kalau page-break cuma dicek per-baris-foto tanpa mempertimbangkan header di atasnya.

**⚠️ Sudah lama diterapkan** di `fegt.html` (BAGIAN 3 & 4 — Cleaning Hole) dan `pm-hg-analyzer.html` (Evidence per Step) — baru diformalkan jadi entri dokumen ini saat di-port ke `form_o2_report.html` (Agustus 2026). Cek dulu apakah file tujuan sudah punya pola ini sebelum menambahkan ulang.

**Prinsip:** hitung dulu (tanpa menggambar apa pun) perkiraan tinggi total **header + konten pertama yang menempel langsung di bawahnya** (label + 1 baris foto). Kalau ternyata tidak muat di sisa halaman SEKARANG tapi muat kalau pindah ke halaman baru → `addPage()` DULU sebelum header digambar. Kalau bahkan di halaman baru pun tidak muat (foto raksasa) → biarkan alur normal per-baris yang menangani, jangan sampai infinite-loop. Baris foto ke-2/3/dst (lanjutan) TETAP boleh pindah halaman sendiri tanpa menyeret header lagi — cuma header + baris PERTAMA yang dijaga.

**Kalau section punya 2 subsection foto berurutan (mis. BEFORE/AFTER lalu EVIDENCE, seperti di O2), lakukan pengecekan INI TERPISAH untuk masing-masing** — subsection kedua bisa saja mulai di tengah halaman (setelah subsection pertama menghabiskan tempat), jadi labelnya sendiri juga butuh dijaga agar tidak terpisah dari baris foto pertamanya, independen dari header section.

```js
// Sebelum menggambar header section/channel — estimasi dulu tanpa efek samping:
var firstImg = imgs[0] ? {{iePhotoDrawSize}}(imgs[0], colW, maxPhotoH) : null;
var firstImg2 = imgs[1] ? {{iePhotoDrawSize}}(imgs[1], colW, maxPhotoH) : null; // kalau layout 2-kolom
var firstRowH = Math.max(firstImg?firstImg.h:0, firstImg2?firstImg2.h:0, 20);
var firstBlockH = 10 /* tinggi kotak header */ + 5 /* tinggi label sub-header */ + (firstRowH + 9);

if (firstBlockH <= (ph - marginTop - marginBottom) && (y + firstBlockH > ph - marginBottom)) {
  doc.addPage(); drawBg(doc, pw, ph); y = marginTop;
} else {
  checkPage(14); // fallback normal kalau memang tidak muat sama sekali
}
// ...baru setelah ini gambar kotak header + label + loop foto seperti biasa...
```
Kalau ada blok teks dinamis di antara header dan foto (mis. catatan/notes yang panjangnya berubah-ubah), hitung dulu jumlah barisnya lewat `doc.splitTextToSize(...)` (ini tidak menggambar apa-apa, aman dipanggil duluan) dan masukkan tingginya ke `firstBlockH` juga — simpan hasil `splitTextToSize` di variabel supaya tidak perlu dihitung ulang saat benar-benar digambar.

**Butuh dari user:** tidak ada — murni perbaikan page-break PDF, tidak menyentuh struktur data/form. Cukup baca nama variabel `ph`/`marginTop`/`marginBottom`/`marginX`/`checkPage`/fungsi ukur foto (`iePhotoDrawSize` atau sejenis) yang sudah ada di file tujuan.

**⚠️ Potensi Konflik:** kalau file tujuan belum punya fungsi `checkPage(minH)` generik, pastikan definisinya (biasanya `if (y+minH > ph-marginBottom) { doc.addPage(); drawBg(doc,pw,ph); y=marginTop; }`) ada dulu sebelum menempel pola ini.

---

## Q. Sinkronisasi Caption SEBELUM Array Diubah
**Tujuan:** mencegah caption/keterangan foto "ketuker" (nempel ke foto yang salah) setiap kali urutan array foto berubah — baik karena **Fitur O (tukar posisi)** maupun **hapus foto** (tombol ×).

**Ditemukan pertama kali di:** `form_o2_report.html` (Agustus 2026), saat menambahkan Fitur O — ternyata bug yang sama juga sudah lama ada di tombol hapus foto yang sudah dipakai di banyak modul lain, jadi ikut dicek/diperbaiki di file mana pun fitur ini diterapkan.

**Akar masalahnya:** banyak fungsi render galeri (`{{prefix}}RenderPreviews`) selalu memanggil sync-caption-dari-DOM ("SyncCaptions") di baris pertamanya, sebelum menggambar ulang. Fungsi sync itu membaca `<input>` keterangan **berdasarkan posisi index** (`id="..._"+idx`) dan menulisnya ke `arr[idx].caption`. Ini aman kalau dipanggil SEBELUM array berubah urutan/isi. Tapi kalau dipanggil SESUDAH `splice()` (hapus) atau swap (tukar posisi) — DOM lama masih menampilkan urutan LAMA, sementara `arr[idx]` sekarang sudah jadi object yang BEDA di posisi itu. Akibatnya caption ketulis ke foto yang salah.

**Fix — 2 bagian:**
1. Tambahkan parameter `skipSync` (opsional, default `false`) di fungsi render galeri, supaya pemanggil yang SUDAH sync duluan bisa melewati sync kedua yang salah-waktu itu:
```js
function {{prefix}}RenderPreviews(chKey, phase, skipSync) {
  // ...normalisasi argumen kalau perlu...
  if (!skipSync) {{prefix}}SyncCaptions(chKey, phase); // cuma sync kalau BUKAN dipanggil sesudah array berubah
  // ...sisa fungsi render seperti biasa...
}
```
2. Di setiap fungsi yang mengubah URUTAN atau ISI array foto (swap/reorder, hapus, insert-di-tengah — bukan yang cuma `push` di akhir, itu aman), panggil sync DULU sebelum mutasi, lalu render dengan `skipSync=true`:
```js
function {{prefix}}RemoveImg(chKey, phase, idx) {
  {{prefix}}SyncCaptions(chKey, phase); // commit caption dari DOM SEBELUM index bergeser
  {{imgArr}}.splice(idx, 1);
  {{prefix}}RenderPreviews(chKey, phase, true); // skip sync — sudah dilakukan di atas
}
```
(Untuk kode swap/reorder-nya sendiri lihat Fitur O — pola `SyncCaptions` → mutasi array → `RenderPreviews(..., true)` itu persis sama.)

**Catatan:** bug ini CUMA menyerang caption. Data lain per foto (ukuran/preset crop `widthCm`/`heightCm`, offset posisi PDF `offsetX`, `dataUrl`, `type`) tidak kena karena itu semua ikut nempel ke object yang di-swap/displace — cuma caption yang di-assign ulang secara terpisah berdasarkan posisi DOM, makanya cuma dia yang butuh fix ini.

**Butuh dari user:** tidak ada. Tapi **WAJIB dicek di SEMUA fungsi** yang mengubah urutan/isi array foto di file tujuan (reorder, hapus, insert-ulang setelah crop-ulang jika itu memindah posisi) — bukan cuma yang baru ditambah dari Fitur O.

**⚠️ Potensi Konflik:** kalau file tujuan sudah punya pola sync-caption yang berbeda (mis. sync per-input `oninput` SAJA tanpa fungsi sync terpisah), fix ini mungkin tidak relevan — cek dulu apakah bug-nya benar-benar bisa terjadi di sana sebelum menempel pola ini secara membabi buta.

---

## R. Rotasi Gambar 90° di Crop Modal
**Tujuan:** 2 tombol bulat mengambang (⟲ kiri / ⟳ kanan) di pojok kanan-atas area gambar DI DALAM crop modal, buat memutar foto yang ke-upload miring/terbalik 90° (potret↔lanskap tertukar) tanpa perlu upload ulang dari HP.

**Ditemukan pertama kali di:** `pm-hg-analyzer.html` (Agustus 2026, dikerjakan sesi Claude lain, commit `56a8065`).

**Cara kerja:** klik tombol memutar gambar **SUMBER** (bukan cuma crop box-nya) lewat `<canvas>` (translate ke tengah, `ctx.rotate(dir*90*Math.PI/180)`, gambar ulang), hasilnya dipasang balik ke `#cropImg.src`. Ini otomatis memicu ulang event `onload` yang sudah ada di crop modal (dari `imgOpenCropper`), yang menyesuaikan ukuran/posisi gambar dan crop box — termasuk kalau lagi mode Preset/Manual dengan rasio terkunci — jadi TIDAK perlu logika reposisi terpisah. `cropAndSave()` menggambar dari elemen `#cropImg` langsung, jadi hasil akhir crop otomatis ikut orientasi gambar yang sudah diputar.

```css
.crop-rotate-toolbar{position:absolute;top:8px;right:8px;display:flex;gap:6px;z-index:6}
.crop-rotate-btn{width:34px;height:34px;border-radius:50%;border:none;background:rgba(0,0,0,0.6);color:#fff;font-size:17px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.35)}
.crop-rotate-btn:active{background:rgba(0,0,0,0.85)}
```
```html
<!-- Ditaruh di dalam #cropWrap, sebagai sibling dari #cropImg (sebelum #cropBox) -->
<div class="crop-rotate-toolbar">
    <button type="button" class="crop-rotate-btn" onclick="rotateCropImage(-1)" title="Putar gambar 90° ke kiri">&#8634;</button>
    <button type="button" class="crop-rotate-btn" onclick="rotateCropImage(1)" title="Putar gambar 90° ke kanan">&#8635;</button>
</div>
```
```js
/* dir: -1 = putar ke kiri (counter-clockwise), 1 = putar ke kanan (clockwise). */
function rotateCropImage(dir) {
    var img = document.getElementById('cropImg');
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
    var ctx = canvas.getContext('2d');
    ctx.translate(canvas.width/2, canvas.height/2);
    ctx.rotate(dir * 90 * Math.PI/180);
    ctx.drawImage(img, -img.naturalWidth/2, -img.naturalHeight/2);
    var rotatedUrl = canvas.toDataURL('image/jpeg', 0.95);
    img.src = rotatedUrl; // memicu ulang img.onload -> refit gambar & crop box
    if (cropModalState._pending) cropModalState._pending.dataUrl = rotatedUrl;
}
```
**Butuh dari user:** tidak ada — murni tambahan di crop modal, tidak menyentuh struktur data. Cukup pastikan file tujuan punya `#cropImg`/`#cropWrap`/`#cropBox`/`cropModalState._pending` (struktur crop modal kanonis yang sudah di-backport ke semua modul — lihat Fitur B) sebelum tempel.

**⚠️ Potensi Konflik:** kalau file tujuan punya `#cropWrap` dengan `position` bukan `relative` (dropdown/toolbar butuh ancestor `position:relative` biar `position:absolute` toolbar-nya nempel ke area gambar, bukan ke seluruh halaman) — cek dulu CSS `#cropWrap`-nya, sesuaikan kalau beda. Jangan disamakan dengan **Fitur K** (Rotasi Kotak & Oval) — itu rotasi SHAPE ANOTASI di editor "Edit Gambar" (Insert Shape), fitur yang beda total dari rotasi FOTO ASLI ini.

---


Sebelum menerapkan fitur-fitur di atas ke file baru, ini yang perlu dicek/ditanyakan:

| # | Yang perlu dipastikan | Kalau tidak ada di prompt user |
|---|---|---|
| 1 | Nama variabel/struktur data gambar (pengganti `sections[type][idx].images[]`) | Baca langsung dari kode file yang diupload |
| 2 | Nama fungsi render ulang thumbnail (pengganti `renderSection(type, boxId)`) | Baca langsung dari kode file yang diupload |
| 3 | `window.CURRENT_MODUL` — nama modul persis untuk autosave | **Tanya user**, jangan menebak |
| 4 | Path file gambar background PDF (kalau beda dari `DRAFT PM KOSONG.jpg`) | **Tanya user** |
| 5 | Apakah file itu masih pakai crop engine lama `shared.js` (`imgOpenCropper`) | Cek kode — kalau ya, perlu migrasi konsisten (lihat Fitur B) |
| 6 | Apakah file itu sudah punya alur download-langsung tanpa preview | Kalau ya dan mau diubah ke preview-dulu → **tanya user dulu** |
| 7 | Lokasi persis loop `doc.addImage(...)` di fungsi export PDF-nya | Baca langsung dari kode file yang diupload |
| 8 | Bentuk objek `rec`/`dbCollectData(modul)` file itu, untuk `applyRecordToForm` | Baca langsung dari kode file yang diupload |

## ⚠️ Potensi Konflik Global
Karena semua fitur di atas dan fungsi bawaan `shared.js` sama-sama pakai **global function declaration** (bukan modul/namespace), nama-nama berikut **rawan bentrok** kalau file tujuan sudah punya fungsi dengan nama sama tapi perilaku beda:
`cropReset`, `cropAndSave`, `skipCrop`, `imgOpenCropper`, `openCropModal`, `closeCropModal`, `setCropMode`, `setCropOrientation`, `applySquarePreset`, `fitCropBoxToFullImage`, `renderPresetButtons`, `highlightPreset`, `printReport`, `exportPdf`, `showPdfPreview`, `nudgeImage`, `nudgeImageInArray`, `reEditCrop`, `initCropDrag`, `openImageEditor`, `closeImageEditor`, `applyImageEdits`, `setEditTool`, `setEditColor`, `setEditThickness`, `addShape`, `deleteSelectedShape`, `editSelectedText`, `deselectShape`, `setSelectedShape`, `getShapeById`, `renderAllShapes`, `ieForceHideKeyboard`, `iePhotoDrawSize`, `ieRotatePoint`, `ieHandleR`, `ieHandleHitR`, `ieMakeHandle`, `uploadFotoKeGDrive`, `GDRIVE_WEB_APP_URL`, `GDRIVE_SECRET_TOKEN`, `drawCheckboxBs`.

**Sebelum menempel kode dari dokumen ini, selalu `grep` dulu nama-nama fungsi di atas pada file tujuan.** Kalau sudah ada dan isinya beda, diskusikan dulu ke user mana yang mau dipakai / digabung, jangan main timpa.
