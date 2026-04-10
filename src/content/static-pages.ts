/**
 * Statik sayfa içerikleri — tek yerden güncellenir.
 * Dil: Türkçe
 */

export type StaticSection = {
  heading: string;
  paragraphs: string[];
};

export type StaticPageDef = {
  path: string;
  kicker: string;
  title: string;
  heroDescription?: string;
  metaTitle: string;
  metaDescription: string;
  sections: StaticSection[];
  closingText?: string;
};

export const hakkimizdaPage: StaticPageDef = {
  path: "/hakkimizda",
  kicker: "Hakkımızda",
  title: "Hakkımızda",
  heroDescription:
    "Yatirim.io, yatırım fonlarını daha anlaşılır, daha karşılaştırılabilir ve daha takip edilebilir hale getirmek için geliştirildi.",
  metaTitle: "Hakkımızda — Yatirim.io",
  metaDescription:
    "Yatirim.io nedir, neden var ve kimler için tasarlandı? Platformun amacı ve sunduğu deneyim hakkında bilgi.",
  sections: [
    {
      heading: "Yatirim.io nedir?",
      paragraphs: [
        "Yatirim.io, Türkiye'deki yatırım fonlarını daha sade bir arayüzle sunan bir ürün deneyimidir. Amacımız kullanıcıları karmaşık tablolar, dağınık veri alanları ve gereksiz finans jargonuyla baş başa bırakmadan, fonları daha net inceleyebilecekleri bir yapı oluşturmaktır.",
      ],
    },
    {
      heading: "Neden var?",
      paragraphs: [
        "Fonları araştırmak çoğu zaman yorucu bir deneyime dönüşüyor. Veriye ulaşmak mümkün olsa bile, bu veriyi hızlı biçimde anlamlandırmak her zaman kolay olmuyor. Yatirim.io bu noktada devreye girer; fonları daha sade sayfalarda, daha anlaşılır karşılaştırmalarla ve daha düzenli bir ürün diliyle sunar.",
      ],
    },
    {
      heading: "Kimler için?",
      paragraphs: [
        "Yatirim.io; fonları yeni tanımaya başlayan kullanıcılar, mevcut fon tercihlerini daha net görmek isteyen yatırımcılar ve farklı fonları daha düzenli biçimde incelemek isteyen herkes için tasarlanmıştır. Hedefimiz yalnızca deneyimli kullanıcılar değil; karmaşık finans arayüzlerinden uzak durmak isteyen kullanıcılar için de daha erişilebilir bir yapı kurmaktır.",
      ],
    },
    {
      heading: "Ne sunar?",
      paragraphs: [
        "Yatirim.io, yatırım fonlarını keşfetmeyi, kategoriler içinde gezmeyi, fonları karşılaştırmayı ve detay sayfalarında daha temiz bir görünümle incelemeyi kolaylaştırır. Ürün yaklaşımımız, daha fazla gürültü üretmek değil; daha net bir karar hazırlık deneyimi sunmaktır.",
      ],
    },
  ],
  closingText:
    "Yatirim.io'nun amacı yatırım kararı vermek değil, yatırım araştırma sürecini daha anlaşılır hale getirmektir.",
};

export const vizyonumuzPage: StaticPageDef = {
  path: "/vizyonumuz",
  kicker: "Vizyonumuz",
  title: "Vizyonumuz",
  heroDescription:
    "Yatırım araştırmasının daha anlaşılır, daha erişilebilir ve daha sade bir dijital deneyime dönüşmesi gerektiğine inanıyoruz.",
  metaTitle: "Vizyonumuz — Yatirim.io",
  metaDescription:
    "Yatirim.io'nun vizyonu: daha anlaşılır finans deneyimi, daha erişilebilir ürün dili ve daha güçlü karar hazırlığı.",
  sections: [
    {
      heading: "Daha anlaşılır finans deneyimi",
      paragraphs: [
        "Finansal ürünler çoğu zaman gereğinden fazla karmaşık anlatılıyor. Biz, yatırım araştırmasının daha sakin, daha okunabilir ve daha insan odaklı bir deneyimle sunulması gerektiğini düşünüyoruz.",
      ],
    },
    {
      heading: "Daha erişilebilir ürün dili",
      paragraphs: [
        "Yatirim.io, yalnızca finansı çok iyi bilen kullanıcılar için değil; konuya yeni yaklaşan kullanıcılar için de anlaşılır olmalıdır. Bu yüzden ürün dilinde sadelik, netlik ve hiyerarşi önceliklidir.",
      ],
    },
    {
      heading: "Daha güçlü karar hazırlığı",
      paragraphs: [
        "Bizim için iyi bir finans ürünü; kullanıcıyı veri kalabalığıyla yormayan, dikkatini dağıtmayan ve karar öncesi araştırmayı daha net hale getiren üründür. Vizyonumuz, yatırım fonlarını takip etmeyi daha güven veren ve daha düzenli bir deneyime dönüştürmektir.",
      ],
    },
  ],
  closingText:
    "Yatirim.io, gösterişli olmak yerine faydalı olmayı; karmaşık olmak yerine anlaşılır olmayı hedefler.",
};

export const iletisimPage: StaticPageDef = {
  path: "/iletisim",
  kicker: "İletişim",
  title: "İletişim",
  heroDescription:
    "Geri bildirimler, ürün önerileri, hata bildirimleri ve iş birliği talepleri için bize ulaşabilirsiniz.",
  metaTitle: "İletişim — Yatirim.io",
  metaDescription:
    "Yatirim.io ile iletişime geçin. E-posta, X ve GitHub üzerinden bize ulaşabilirsiniz.",
  sections: [
    {
      heading: "Bize yazın",
      paragraphs: [
        "Yatirim.io ile ilgili görüşlerinizi, karşılaştığınız sorunları veya geliştirme önerilerinizi bizimle paylaşabilirsiniz. Kullanıcı deneyimini daha iyi hale getiren geri bildirimleri önemsiyoruz.",
      ],
    },
    {
      heading: "İletişim kanalları",
      paragraphs: [
        "E-posta: hello@yatirim.io",
        "X: x.com/getyatirim",
        "GitHub: github.com/yatirimio",
      ],
    },
    {
      heading: "Hangi konularda ulaşabilirsiniz?",
      paragraphs: [
        "Ürün geri bildirimleri, hata bildirimleri, iş birliği talepleri, marka ve basın iletişimleri veya genel sorular için bizimle iletişime geçebilirsiniz.",
      ],
    },
  ],
};

export const sorumlulukReddiPage: StaticPageDef = {
  path: "/sorumluluk-reddi",
  kicker: "Yasal",
  title: "Sorumluluk Reddi",
  heroDescription:
    "Bu platformda yer alan içerikler yalnızca bilgilendirme amaçlıdır.",
  metaTitle: "Sorumluluk Reddi — Yatirim.io",
  metaDescription:
    "Yatirim.io sorumluluk reddi: platformdaki içerikler bilgilendirme amaçlıdır, yatırım tavsiyesi değildir.",
  sections: [
    {
      heading: "Genel bilgilendirme",
      paragraphs: [
        "Yatirim.io üzerinde sunulan içerikler, veriler, sıralamalar, karşılaştırmalar ve açıklamalar yalnızca genel bilgilendirme amacı taşır. Bu içerikler hiçbir şekilde yatırım tavsiyesi, alım-satım önerisi, portföy yönetimi hizmeti veya kişiye özel finansal yönlendirme niteliğinde değildir.",
      ],
    },
    {
      heading: "Veri doğruluğu",
      paragraphs: [
        "Platformda yer alan bilgiler farklı veri akışları, teknik işleme süreçleri veya düzenli güncellemeler sonucunda sunulabilir. Buna rağmen zaman zaman gecikmeler, eksiklikler, teknik hatalar veya farklı yorumlamalar oluşabilir.",
      ],
    },
    {
      heading: "Kullanıcı sorumluluğu",
      paragraphs: [
        "Kullanıcılar yatırım kararlarını kendi risk profilleri, finansal durumları ve ihtiyaçları doğrultusunda değerlendirmelidir. Gerekli görülen durumlarda yetkili ve uzman kişi veya kurumlardan profesyonel destek alınmalıdır.",
      ],
    },
    {
      heading: "Garanti yokluğu",
      paragraphs: [
        "Yatirim.io üzerinde yer alan hiçbir içerik belirli bir getirinin, performansın veya sonucun garantisi olarak yorumlanamaz.",
      ],
    },
  ],
};

export const gizlilikPolitikasiPage: StaticPageDef = {
  path: "/gizlilik-politikasi",
  kicker: "Yasal",
  title: "Gizlilik Politikası",
  heroDescription:
    "Yatirim.io, kullanıcı gizliliğine önem verir. Bu sayfa, platformla etkileşiminiz sırasında hangi bilgilerin hangi amaçlarla işlenebileceğine dair genel bir çerçeve sunar.",
  metaTitle: "Gizlilik Politikası — Yatirim.io",
  metaDescription:
    "Yatirim.io gizlilik politikası: kullanıcı bilgilerinin nasıl işlendiği ve korunduğu hakkında bilgi.",
  sections: [
    {
      heading: "Paylaşmayı tercih ettiğiniz bilgiler",
      paragraphs: [
        "Bizimle e-posta veya benzeri iletişim kanalları üzerinden iletişime geçtiğinizde adınız, e-posta adresiniz ve ilettiğiniz mesaj içeriği gibi bilgileri yalnızca talebinizi değerlendirmek ve size dönüş yapmak amacıyla kullanabiliriz.",
      ],
    },
    {
      heading: "Teknik veriler",
      paragraphs: [
        "Platformun güvenli, stabil ve sağlıklı çalışabilmesi için bazı teknik kayıtlar oluşabilir. Bu kayıtlar; erişim zamanı, tarayıcı bilgisi, cihaz bilgisi veya benzeri temel sistem verilerini içerebilir.",
      ],
    },
    {
      heading: "Bilgilerin kullanımı",
      paragraphs: [
        "Toplanan veya işlenebilen bilgiler; hizmetin çalışmasını sağlamak, güvenliği korumak, teknik sorunları incelemek ve kullanıcı iletişimlerini yanıtlamak amacıyla kullanılabilir.",
      ],
    },
    {
      heading: "Üçüncü taraf hizmetler",
      paragraphs: [
        "Yatirim.io üzerinde üçüncü taraf hizmetler veya bağlantılar yer alabilir. Bu bağlantılar üzerinden erişilen dış servislerin kendi gizlilik politikaları ve kullanım koşulları geçerli olabilir.",
      ],
    },
    {
      heading: "Güncellemeler",
      paragraphs: [
        "Bu politika, ürün yapısı veya yasal gereklilikler doğrultusunda zaman zaman güncellenebilir. Güncel versiyon her zaman bu sayfa üzerinden yayımlanır.",
      ],
    },
  ],
};

export const kullanimKosullariPage: StaticPageDef = {
  path: "/kullanim-kosullari",
  kicker: "Yasal",
  title: "Kullanım Koşulları",
  heroDescription:
    "Yatirim.io'yu kullanarak aşağıdaki koşulları kabul etmiş sayılırsınız.",
  metaTitle: "Kullanım Koşulları — Yatirim.io",
  metaDescription:
    "Yatirim.io kullanım koşulları: platformu kullanırken geçerli olan kurallar ve sorumluluklar.",
  sections: [
    {
      heading: "Platform amacı",
      paragraphs: [
        "Yatirim.io, yatırım fonlarını inceleme, karşılaştırma ve takip etme amacıyla sunulan bilgilendirici bir dijital üründür. Platformda yer alan içerikler yatırım tavsiyesi niteliği taşımaz.",
      ],
    },
    {
      heading: "Kullanım kuralları",
      paragraphs: [
        "Kullanıcılar, platformu yasalara uygun şekilde ve hizmetin teknik bütünlüğüne zarar vermeyecek biçimde kullanmayı kabul eder.",
      ],
    },
    {
      heading: "Fikri mülkiyet",
      paragraphs: [
        "Platform üzerinde yer alan tasarım, metin, marka unsurları ve diğer içerikler aksi belirtilmedikçe Yatirim.io'ya aittir veya kullanım hakkı kapsamında sunulmaktadır.",
      ],
    },
    {
      heading: "Değişiklik hakkı",
      paragraphs: [
        "Yatirim.io, hizmet kapsamını, içerikleri veya ürün yapısını önceden bildirim yapmaksızın güncelleme, değiştirme veya kaldırma hakkını saklı tutar.",
      ],
    },
    {
      heading: "Dış bağlantılar",
      paragraphs: [
        "Platform üzerinde yer alan dış bağlantılar yalnızca kolaylık sağlamak amacıyla sunulabilir. Bu bağlantılar üzerinden erişilen üçüncü taraf içeriklerin sorumluluğu ilgili taraflara aittir.",
      ],
    },
  ],
  closingText:
    "Platformu kullanmaya devam etmeniz, güncel kullanım koşullarını kabul ettiğiniz anlamına gelir.",
};
