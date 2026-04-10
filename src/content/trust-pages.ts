/**
 * Güven katmanı metinleri — tek yerden güncellenir.
 * Dil: mevcut site dili (Türkçe); i18n dosyası değildir.
 */

export type TrustSection = {
  heading: string;
  /** Kısa paragraflar; her biri ayrı <p> */
  paragraphs: string[];
};

export const methodologyPage = {
  path: "/metodoloji",
  kicker: "Metodoloji",
  title: "Veriyi nasıl düzenliyoruz?",
  metaTitle: "Metodoloji — Yatirim.io",
  metaDescription:
    "Yatirim.io’da fonların nasıl listelendiği, kategori ve türlerin kullanımı ve tarihsel veri pencereleri hakkında özet.",
  sections: [
    {
      heading: "Fonların düzeni",
      paragraphs: [
        "Fonlar resmi kayıtlar ve günlük anlık görüntü üzerinden bir araya getirilir. Ana liste ve skor görünümleri, birkaç ölçülebilir alanı aynı bakışta okunur kılmak için tasarlanmıştır — amaç tablo kalabalığı değil, yön bulmaktır.",
      ],
    },
    {
      heading: "Kategori ve fon türü",
      paragraphs: [
        "Kategori ve fon türü filtreleri, keşif menzilinizi daratmak içindir; resmi sınıflandırmayla uyumlu kalır. Bir etiket, yatırım tavsiyesi veya garanti anlamına gelmez.",
      ],
    },
    {
      heading: "Tarihsel veri ve grafikler",
      paragraphs: [
        "Performans grafikleri ve özet metrikler, seçilen zaman aralığına göre hesaplanır. Seri uzunluğu ve son veri tarihi fon bazında farklılık gösterebilir; arayüzde gördüğünüz pencere, o fon için elimizdeki geçmişle sınırlıdır.",
      ],
    },
    {
      heading: "Tasarım ilkesi",
      paragraphs: [
        "Platform, yatırımcının daha net araştırmasına yardım etmek için kuruldu; teknik detayı baştan tüm kullanıcıya yüklemek için değil. Derinlik, fon profili ve ilgili alanlarda isteğe bağlı olarak açılır.",
      ],
    },
  ] satisfies TrustSection[],
};

export const dataSourcesPage = {
  path: "/veri-kaynaklari",
  kicker: "Yöntem ve veri",
  title: "Veri nasıl güncellenir?",
  metaTitle: "Yöntem ve veri — Yatirim.io",
  metaDescription: "Yatirim.io’da veri yenileme sıklığı ve olası gecikmeler hakkında özet bilgi.",
  sections: [
    {
      heading: "Veri akışı",
      paragraphs: [
        "Türkiye yatırım fonları için kamuya açık fon verisi, resmi kanallardan planlı senkron işleriyle içeri aktarılır.",
      ],
    },
    {
      heading: "Yenileme",
      paragraphs: [
        "Güncellemeler anlık değildir; arka planda çalışan senkronlarla belirli aralıklarla yapılır. Piyasa günü içinde veya bakım dönemlerinde yansıma gecikmesi normal karşılanmalıdır.",
      ],
    },
    {
      heading: "Gecikme ve tutarsızlık",
      paragraphs: [
        "Kesim saatleri, düzeltme yayınları, ağ kesintileri veya yayıncı taraflı değişiklikler kısa süreli tutarsızlıklara yol açabilir. Kritik bir rakam için fonun resmi sayfasını veya aracı kurumunuzu doğrulama noktası olarak kullanın.",
      ],
    },
  ] satisfies TrustSection[],
};

export const disclaimerPage = {
  path: "/sorumluluk-reddi",
  kicker: "Sorumluluk reddi",
  title: "Yasal bilgilendirme",
  metaTitle: "Sorumluluk reddi — Yatirim.io",
  metaDescription:
    "Yatirim.io bilgilendirme amaçlıdır; yatırım tavsiyesi değildir. Geçmiş getiri geleceği garanti etmez.",
  sections: [
    {
      heading: "Kullanım amacı",
      paragraphs: [
        "Yatirim.io’da sunulan içerik yalnızca bilgilendirme amaçlıdır. Kişisel durumunuza uygun yatırım kararı vermeniz, alım-satım teşviki veya profesyonel danışmanlık yerine geçmez.",
      ],
    },
    {
      heading: "Yatırım tavsiyesi değildir",
      paragraphs: [
        "Sıralamalar, skorlar, grafikler ve metinler yatırım tavsiyesi, portföy önerisi veya getiri vaadi olarak yorumlanmamalıdır.",
      ],
    },
    {
      heading: "Geçmiş performans",
      paragraphs: [
        "Geçmişe dönük getiri, risk veya diğer göstergeler gelecekteki sonuçların göstergesi değildir; piyasa koşulları hızla değişebilir.",
      ],
    },
    {
      heading: "Sorumluluk",
      paragraphs: [
        "Yatırım kararlarınızı risk profiliniz, hukuki ve vergisel gereklilikler ile gerektiğinde lisanslı uzman görüşüne dayandırmanız esastır.",
      ],
    },
  ] satisfies TrustSection[],
};

export const trustCrossLinks = [
  { href: methodologyPage.path, label: "Metodoloji" },
  { href: dataSourcesPage.path, label: "Yöntem ve veri" },
  { href: disclaimerPage.path, label: "Sorumluluk reddi" },
] as const;
