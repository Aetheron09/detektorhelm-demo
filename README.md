# HelmWatch — demo detektor helm

Website demo lokal untuk mencoba model [Helmet Detection YOLO26](https://github.com/GPA-N/helmet-detection-yolo26) tanpa mengubah repository model tersebut. Aplikasi mengunduh `helmet-v2.pt` dari release v2.0 ke folder `models/` saat pertama kali dijalankan.

## Menjalankan

Gunakan Python 3.10 atau lebih baru. Dari folder project:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Buka <http://127.0.0.1:8000>. Proses pertama kali memerlukan internet untuk mengunduh bobot model. Izin kamera browser hanya tersedia di `localhost` atau koneksi HTTPS.

Bobot model disimpan terpisah dari kode. Jika bobot sudah diunduh, atau kamu ingin menunjuk ke file yang sudah tersedia, set variabel `HELMET_MODEL_PATH` sebelum menjalankan server. URL sumber dapat diganti melalui `HELMET_MODEL_URL`.

## Demo

- Upload satu gambar untuk menampilkan bounding box dan confidence.
- Upload video untuk menganalisis frame secara berkala saat video diputar.
- Gunakan kamera langsung untuk deteksi frame berkala.
- Label hijau berarti `helmet`; label merah berarti `no_helmet`. Ambang confidence menggunakan nilai 0.25 seperti contoh inference di README model.

Hasil model bisa keliru dan hanya untuk demonstrasi. Jangan jadikan hasil sebagai keputusan keselamatan atau penegakan tanpa pemeriksaan manusia. Periksa lisensi bobot dan model asal sebelum mendistribusikan atau menerapkan demo ini.
