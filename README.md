# Wistia M3U8 Finder (Chrome Extension)

Bu extension, aktif sekmede tespit ettiği Wistia ile ilişkili `.m3u8` URL'lerini popup içinde listeler.

## Özellikler

- Sayfa içeriğinde geçen Wistia + m3u8 URL'lerini yakalar.
- Sekme açıkken yapılan ağ isteklerinden Wistia + m3u8 URL'lerini yakalar.
- Aynı URL'yi tekilleştirir.
- Popup üzerinden listeyi yenileme ve temizleme sağlar.

## Kurulum (Local / Unpacked)

1. Bu klasörü bilgisayarına indir veya clone et.
2. Chrome'da `chrome://extensions` sayfasını aç.
3. Sağ üstten **Developer mode** seçeneğini aç.
4. **Load unpacked** butonuna tıkla.
5. Bu repo klasörünü (`wistia-downloader-chrome-extension`) seç.
6. Eklenti listesinde **Wistia M3U8 Finder** görünüyorsa kurulum tamamdır.

## Local Test Adımları

1. Wistia video bulunan bir sayfayı aç.
2. Sayfayı bir kez yenile (network isteklerini yakalamak için).
3. Tarayıcı araç çubuğundan eklenti ikonuna tıkla.
4. Popup'ta URL listesi görünmeli.
   - URL yoksa **Yenile** butonuna tıkla.
   - Listeyi sıfırlamak için **Temizle** butonunu kullan.

## Hızlı Doğrulama Checklist

- Eklenti yükleniyor mu? (`chrome://extensions` içinde hata yok)
- Popup açılıyor mu?
- Wistia içeren sayfada en az bir URL listeleniyor mu?
- Temizle sonrası liste boşalıyor mu?

## Geliştirme Sırasında Tekrar Yükleme

Kod değişikliği yaptıktan sonra:

1. `chrome://extensions` sayfasına dön.
2. Eklentinin kartındaki **Reload** butonuna tıkla.
3. Test sayfasını yenileyip popup'ı yeniden aç.
## Kurulum

1. Bu klasörü indir.
2. Chrome'da `chrome://extensions` sayfasını aç.
3. **Developer mode** aç.
4. **Load unpacked** ile bu klasörü seç.

## Kullanım

1. Wistia video içeren bir sayfaya git.
2. Extension ikonuna tıkla.
3. Bulunan URL'ler listede görünür.
