import type {Locale} from './catalog.js';

/** Image presentation is translated independently of the original source and licence credit. */
export const MEDIA_MESSAGE_KEYS=[
 'photoCreditLabel','photoDetailsLabel','photoContextLabel','photoEditorialLabel','photoSourceLabel',
 'photoArchiveLabel','photoCollageLabel','photoEditorialNote','photoContextNote',
] as const;
export const MEDIA_ROWS:Readonly<Record<Locale,string>>={
 en:'Photo|About this image|Context photo|Illustrative photo|Source photo|Archive photo · {year}|Source collage|Illustrative reading image. It does not show the reported event.|Context image. It does not show the reported event.',
 ro:'Foto|Despre această imagine|Fotografie de context|Fotografie ilustrativă|Fotografie din sursă|Fotografie de arhivă · {year}|Colaj din sursă|Imagine ilustrativă pentru lectură. Nu prezintă evenimentul relatat.|Imagine de context. Nu prezintă evenimentul relatat.',
 fr:'Photo|À propos de cette image|Photo de contexte|Photo illustrative|Photo de la source|Photo d’archive · {year}|Collage de la source|Image illustrative pour la lecture. Elle ne montre pas l’événement rapporté.|Image de contexte. Elle ne montre pas l’événement rapporté.',
 es:'Foto|Sobre esta imagen|Foto de contexto|Foto ilustrativa|Foto de la fuente|Foto de archivo · {year}|Collage de la fuente|Imagen ilustrativa para la lectura. No muestra el suceso relatado.|Imagen de contexto. No muestra el suceso relatado.',
 pt:'Foto|Sobre esta imagem|Foto de contexto|Foto ilustrativa|Foto da fonte|Foto de arquivo · {year}|Colagem da fonte|Imagem ilustrativa para a leitura. Não mostra o acontecimento relatado.|Imagem de contexto. Não mostra o acontecimento relatado.',
 de:'Foto|Über dieses Bild|Kontextfoto|Illustrationsfoto|Foto der Quelle|Archivfoto · {year}|Collage der Quelle|Illustratives Bild zur Lektüre. Es zeigt nicht das berichtete Ereignis.|Kontextbild. Es zeigt nicht das berichtete Ereignis.',
 it:'Foto|Informazioni sull’immagine|Foto di contesto|Foto illustrativa|Foto della fonte|Foto d’archivio · {year}|Collage della fonte|Immagine illustrativa per la lettura. Non mostra l’evento descritto.|Immagine di contesto. Non mostra l’evento descritto.',
 nl:'Foto|Over deze afbeelding|Contextfoto|Illustratieve foto|Foto van de bron|Archieffoto · {year}|Collage van de bron|Illustratieve afbeelding bij het lezen. Toont niet de beschreven gebeurtenis.|Contextafbeelding. Toont niet de beschreven gebeurtenis.',
 pl:'Zdjęcie|O tym obrazie|Zdjęcie kontekstowe|Zdjęcie ilustracyjne|Zdjęcie ze źródła|Zdjęcie archiwalne · {year}|Kolaż ze źródła|Ilustracja do lektury. Nie przedstawia opisywanego wydarzenia.|Obraz kontekstowy. Nie przedstawia opisywanego wydarzenia.',
 tr:'Fotoğraf|Bu görsel hakkında|Bağlam fotoğrafı|Temsili fotoğraf|Kaynak fotoğrafı|Arşiv fotoğrafı · {year}|Kaynak kolajı|Okumaya eşlik eden temsili görsel. Haber verilen olayı göstermez.|Bağlam görseli. Haber verilen olayı göstermez.',
 ru:'Фото|Об изображении|Контекстное фото|Иллюстративное фото|Фото источника|Архивное фото · {year}|Коллаж источника|Иллюстрация для чтения. Она не изображает описанное событие.|Контекстное изображение. Оно не изображает описанное событие.',
 uk:'Фото|Про зображення|Контекстне фото|Ілюстративне фото|Фото джерела|Архівне фото · {year}|Колаж джерела|Ілюстрація для читання. Вона не зображує описану подію.|Контекстне зображення. Воно не зображує описану подію.',
 ar:'الصورة|حول هذه الصورة|صورة سياقية|صورة توضيحية|صورة المصدر|صورة أرشيفية · {year}|مجموعة صور المصدر|صورة توضيحية للقراءة. لا تعرض الحدث الوارد في الخبر.|صورة سياقية. لا تعرض الحدث الوارد في الخبر.',
 he:'צילום|על התמונה|תמונת הקשר|תמונה להמחשה|תמונה מהמקור|תמונת ארכיון · {year}|קולאז׳ מהמקור|תמונה להמחשה לצד הקריאה. היא אינה מציגה את האירוע המדווח.|תמונת הקשר. היא אינה מציגה את האירוע המדווח.',
 fa:'عکس|درباره این تصویر|عکس زمینه‌ای|عکس تزئینی|عکس منبع|عکس آرشیوی · {year}|کلاژ منبع|تصویر توضیحی برای مطالعه. رویداد گزارش‌شده را نشان نمی‌دهد.|تصویر زمینه‌ای. رویداد گزارش‌شده را نشان نمی‌دهد.',
 ur:'تصویر|اس تصویر کے بارے میں|سیاق کی تصویر|وضاحتی تصویر|ماخذ کی تصویر|محفوظ شدہ تصویر · {year}|ماخذ کا تصویری مجموعہ|مطالعے کے لیے وضاحتی تصویر۔ یہ بیان کردہ واقعے کو نہیں دکھاتی۔|سیاق کی تصویر۔ یہ بیان کردہ واقعے کو نہیں دکھاتی۔',
 hi:'फोटो|इस तस्वीर के बारे में|संदर्भ तस्वीर|प्रतीकात्मक तस्वीर|स्रोत की तस्वीर|पुरानी तस्वीर · {year}|स्रोत का कोलाज|पढ़ने के लिए प्रतीकात्मक तस्वीर। यह बताई गई घटना नहीं दिखाती।|संदर्भ तस्वीर। यह बताई गई घटना नहीं दिखाती।',
 bn:'ছবি|এই ছবি সম্পর্কে|প্রাসঙ্গিক ছবি|প্রতীকী ছবি|উৎসের ছবি|সংরক্ষিত ছবি · {year}|উৎসের ছবির কোলাজ|পাঠের জন্য প্রতীকী ছবি। এতে বর্ণিত ঘটনাটি দেখানো হয়নি।|প্রাসঙ্গিক ছবি। এতে বর্ণিত ঘটনাটি দেখানো হয়নি।',
 'zh-Hans':'摄影|关于此图|背景照片|示意照片|来源照片|资料照片 · {year}|来源拼图|阅读配图，不是所报道事件的现场照片。|背景配图，不是所报道事件的现场照片。',
 'zh-Hant':'攝影|關於此圖|背景照片|示意照片|來源照片|資料照片 · {year}|來源拼圖|閱讀配圖，並非所報導事件的現場照片。|背景配圖，並非所報導事件的現場照片。',
 ja:'写真|この画像について|参考写真|イメージ写真|情報源の写真|資料写真 · {year}|情報源のコラージュ|閲覧用のイメージ写真です。報道された出来事を写したものではありません。|背景を示す参考写真です。報道された出来事を写したものではありません。',
 ko:'사진|이미지 정보|참고 사진|이해를 돕는 사진|출처 사진|자료 사진 · {year}|출처의 콜라주|읽기를 돕는 참고 이미지입니다. 보도된 사건을 촬영한 사진이 아닙니다.|배경을 설명하는 참고 이미지입니다. 보도된 사건을 촬영한 사진이 아닙니다.',
 id:'Foto|Tentang gambar ini|Foto konteks|Foto ilustrasi|Foto sumber|Foto arsip · {year}|Kolase sumber|Gambar ilustrasi untuk bacaan. Tidak menampilkan peristiwa yang diberitakan.|Gambar konteks. Tidak menampilkan peristiwa yang diberitakan.',
 ms:'Foto|Tentang imej ini|Foto konteks|Foto ilustrasi|Foto sumber|Foto arkib · {year}|Kolaj sumber|Imej ilustrasi untuk bacaan. Tidak menunjukkan peristiwa yang dilaporkan.|Imej konteks. Tidak menunjukkan peristiwa yang dilaporkan.',
 vi:'Ảnh|Về hình ảnh này|Ảnh bối cảnh|Ảnh minh họa|Ảnh từ nguồn|Ảnh tư liệu · {year}|Ảnh ghép từ nguồn|Hình minh họa cho bài đọc. Không chụp sự kiện được đưa tin.|Hình ảnh bối cảnh. Không chụp sự kiện được đưa tin.',
 th:'ภาพถ่าย|เกี่ยวกับภาพนี้|ภาพประกอบบริบท|ภาพประกอบ|ภาพจากแหล่งข่าว|ภาพจากคลัง · {year}|ภาพปะติดจากแหล่งข่าว|ภาพประกอบสำหรับการอ่าน ไม่ใช่ภาพเหตุการณ์ที่รายงาน|ภาพประกอบบริบท ไม่ใช่ภาพเหตุการณ์ที่รายงาน',
 sw:'Picha|Kuhusu picha hii|Picha ya muktadha|Picha ya kuonyesha|Picha ya chanzo|Picha ya kumbukumbu · {year}|Mkusanyiko wa picha wa chanzo|Picha ya kuambatana na usomaji. Haionyeshi tukio lililoripotiwa.|Picha ya muktadha. Haionyeshi tukio lililoripotiwa.',
 ta:'புகைப்படம்|இந்தப் படத்தைப் பற்றி|சூழல் புகைப்படம்|விளக்கப் புகைப்படம்|மூலத்தின் புகைப்படம்|காப்பகப் புகைப்படம் · {year}|மூலத்தின் படத்தொகுப்பு|வாசிப்புக்கான விளக்கப் படம். செய்தியில் கூறப்பட்ட நிகழ்வைக் காட்டவில்லை.|சூழலை விளக்கும் படம். செய்தியில் கூறப்பட்ட நிகழ்வைக் காட்டவில்லை.',
 te:'ఫోటో|ఈ చిత్రం గురించి|నేపథ్య ఫోటో|ప్రతీకాత్మక ఫోటో|మూలం ఫోటో|పాత ఫోటో · {year}|మూలం చిత్రాల సమాహారం|చదవడానికి ఉపయోగించే ప్రతీకాత్మక చిత్రం. నివేదించిన సంఘటనను చూపదు.|నేపథ్య చిత్రం. నివేదించిన సంఘటనను చూపదు.',
 fil:'Larawan|Tungkol sa larawang ito|Larawan ng konteksto|Larawang ilustrasyon|Larawan ng sanggunian|Larawan sa arkibo · {year}|Collage ng sanggunian|Larawang ilustrasyon para sa pagbasa. Hindi nito ipinapakita ang iniulat na pangyayari.|Larawan ng konteksto. Hindi nito ipinapakita ang iniulat na pangyayari.',
};
