/** All user-facing strings live here (UI is Turkish; code is English). */

import type { SyncedTableName } from "../db/schema";

/** One entry per synced table, typed so a table added to SYNCED_TABLES
 *  without a label here is a compile error rather than a silent "kayıt". */
const syncQuarantineTypes: Record<SyncedTableName, string> = {
  persons: "kişi",
  transactions: "işlem",
  categories: "kalem",
  category_budgets: "kalem bütçesi",
  investment_profiles: "yatırım hesabı",
  investment_products: "yatırım ürünü",
  investment_operations: "yatırım hareketi",
  payment_sources: "ödeme kaynağı",
  computed_columns: "hesaplanan kolon",
  installment_plans: "taksit planı",
  credit_card_statements: "kart ekstresi",
  subscriptions: "abonelik",
  price_history: "fiyat geçmişi",
  recurring_incomes: "düzenli gelir",
  expected_payments: "beklenen ödeme",
  balance_adjustments: "bakiye düzeltmesi",
  cell_notes: "hücre notu",
  attachments: "ek dosya",
  matrix_colors: "hücre rengi",
  settings: "ayar",
  fx_rates: "döviz kuru",
};

export const productTerms = {
  appName: "Helix",
  financialTable: "Mali Tablo",
  rowFocused: "Satır odaklı",
  columnFocused: "Kolon odaklı",
  item: "Kalem",
  items: "Kalemler",
  column: "Kolon",
  columns: "Kolonlar",
  paymentMethod: "Ödeme Yöntemi",
  paymentMethods: "Ödeme Yöntemleri",
  recurringIncome: "Düzenli Gelir",
  recurringIncomes: "Düzenli Gelirler",
  balanceAdjustment: "Bakiye Düzeltme",
  balanceAdjustments: "Bakiye Düzeltmeleri",
} as const;

export const tr = {
  app: { name: productTerms.appName, tagline: "Nakit akışın, taksitlerin ve aboneliklerin tek yerde." },
  /**
   * The KVKK notice: the disclosure Article 10 of Law 6698 requires a data
   * controller to make before it processes anything.
   *
   * It lives here and is rendered by `src/app/privacy.tsx` rather than sitting
   * in `docs/`, for a reason that is easy to get backwards: `docs/` is
   * Git-ignored, so a notice written there is published nowhere and reachable
   * by nobody — which is the one thing a notice must not be. It is also
   * reachable BEFORE sign-up, because the screen that collects an e-mail
   * address is the screen that has to disclose what happens to it.
   *
   * Its sections are the ones Article 10 enumerates, in that order, so a
   * reader (or a regulator) can check the notice against the article item by
   * item: who the controller is, what is processed and how it is collected,
   * why, on what legal basis, to whom it is transferred, for how long it is
   * kept, and what the data subject may demand. Numbered, because a legal text
   * is cited by section.
   *
   * An article number belongs in the sentence that relies on it, never in a
   * heading. "Haklarınız (KVKK m. 11)" asks the reader to decode a citation
   * before they have been told anything, and the citation does no work there —
   * it does real work inside the paragraph that says which article grants
   * what.
   *
   * ADDRESSED FORMALLY, unlike every other screen in this app. The product
   * speaks to its owner as "sen"; this document speaks to an "ilgili kişi" as
   * "siz", because that is what a Turkish notice of rights reads like and the
   * register is part of what makes it legible as one. The plainness is kept in
   * the sentences rather than the pronouns: statutory terms are used exactly,
   * and everything else is written the way it would be explained out loud.
   *
   * `controllerName` and `contactEmail` are the single source for who is
   * answerable. `tests/legal-notice.test.ts` asserts the feedback function's
   * own recipient matches `contactEmail`, so the address a person is told to
   * write to is the address that is actually read.
   *
   * Every factual claim below was checked against the migrations and the code
   * that writes each store. It is not legal advice.
   */
  legal: {
    title: "Aydınlatma Metni",
    subtitle: "Kişisel verilerinizin nasıl işlendiğine ilişkin bilgilendirme",
    updated: "Son güncelleme: 5 Eylül 2026",
    controllerName: "Ömer Toprak Şavlı",
    contactEmail: "topraksavli@hotmail.com",
    intro: "Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun 10. maddesi uyarınca hazırlanmıştır. Helix'i kullandığınızda hangi kişisel verilerinizin işlendiğini, bunların hangi amaçla ve hangi hukuki sebebe dayanarak işlendiğini, kimlere aktarıldığını, ne kadar süreyle saklandığını ve Kanunun size tanıdığı hakları açıklar.",

    controllerTitle: "1. Veri sorumlusunun kimliği",
    controllerBody: (name: string, email: string) =>
      `Kanun anlamında veri sorumlusu, Helix'i geliştiren gerçek kişi ${name}'dir. Helix bir şirket tüzel kişiliği bünyesinde yürütülmemektedir; bu nedenle veri sorumlusu temsilcisi ve irtibat kişisi bulunmamaktadır. Her türlü talep ve başvurunuz için: ${email}`,

    collectedTitle: "2. İşlenen kişisel verileriniz",
    collectedIntro: "Aşağıdaki veriler dışında hiçbir kişisel veri işlenmemektedir. Uygulamada reklam, analitik, davranışsal takip veya profilleme amacıyla veri toplayan hiçbir bileşen bulunmamaktadır.",
    collected: [
      "**Kimlik ve iletişim verisi:** Yalnızca e-posta adresiniz ve şifrenizin doğrulama özeti (parolanın kendisi hiçbir yerde saklanmaz). Bunlar kimlik doğrulama hizmetinde tutulur. Helix bir hesap olmadan kullanılamadığı için bu iki veri her kullanıcı için oluşur.",
      "**Finansal veriler:** Kaydettiğiniz işlemler, kategoriler, bütçeler, taksitler, abonelikler, düzenli gelirler, yatırımlar, hücre notları ve döviz kuru anlık görüntüleri. Bunlar sizin girdiğiniz verilerdir; hiçbir banka, kart veya ödeme kuruluşuna bağlanılmaz ve hiçbir hesap hareketi otomatik olarak çekilmez.",
      "**Belge verisi:** İşlemlerinize eklediğiniz fiş, fatura ve garanti belgeleri.",
      "**İşlem güvenliği ve hata kaydı verisi:** Bir hata oluştuğunda; hatanın zamanı, uygulamanın hangi bölümünde oluştuğu, önem derecesi, altı sabit hata sınıfından biri, cihaz platformu, uygulama sürümü, hatanın teknik sınıf adı, hata mesajının yalnızca harflerden oluşan izi ve en çok sekiz satırlık kırpılmış yığın izi. Hata mesajının kendisi, tutar, tarih, isim, not veya herhangi bir tanımlayıcı bu kayda giremez; içinde adres, dosya yolu veya Türkçe karakter geçen bir mesaj kırpılmadan bütünüyle atılır.",
      "**Talep ve şikâyet verisi:** Uygulama içindeki geri bildirim formuyla ilettiğiniz mesaj, seçtiğiniz kategori ve varsa eklediğiniz ekran görüntüsü.",
    ],

    methodTitle: "3. Kişisel verilerin toplanma yöntemi",
    methodBody: "Kişisel verileriniz, tamamen otomatik olmayan yollarla ve doğrudan sizden toplanır: uygulamaya kendiniz girdiğiniz kayıtlar, kendiniz eklediğiniz belgeler ve kendiniz gönderdiğiniz geri bildirim mesajları. Yalnızca hata kayıtları, uygulamanın çalışması sırasında otomatik olarak oluşturulur. Üçüncü kişilerden veri temin edilmez, satın alınmaz ve herhangi bir veri tabanıyla eşleştirme yapılmaz.",

    purposeTitle: "4. İşleme amaçları ve hukuki sebepler",
    purposeIntro: "Her veri kategorisi yalnızca karşısında yazan amaçla ve yalnızca karşısında gösterilen hukuki sebebe dayanılarak işlenir.",
    purposes: [
      "**Hizmetin sunulması ve cihazlarınız arasında eşitlenmesi** — kimlik, iletişim, finansal ve belge verileri. Hukuki sebep: KVKK m. 5/2-c, bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması.",
      "**Hataların teşhis edilmesi ve bir güncellemenin uygulamayı bozup bozmadığının görülmesi** — işlem güvenliği ve hata kaydı verisi. Hukuki sebep: KVKK m. 5/2-f, veri sorumlusunun meşru menfaati. Bu veri, amaç için gereken en dar biçime indirgenmiş olup ilgili kişinin temel hak ve özgürlüklerine zarar vermeyecek şekilde işlenmektedir.",
      "**Talebinizin karşılanması ve size dönüş yapılması** — talep ve şikâyet verisi. Hukuki sebep: KVKK m. 5/1, açık rızanız. Formu göndermediğiniz sürece bu veri hiç oluşmaz; gönderdikten sonra rızanızı geri almak için aynı adrese yazmanız yeterlidir.",
    ],

    transferTitle: "5. Aktarım ve yurt dışına aktarım",
    transferIntro: "Helix bir hesapla kullanılır; kayıt olmadan kullanılabilen bir sürümü yoktur. Bu nedenle aşağıdaki aktarımların hepsi sizin için geçerlidir. Her satır alıcıyı, aktarılan veriyi ve aktarımın hangi anda yapıldığını söyler:",
    transfers: [
      "**Supabase** — barındırma altyapısı Amazon Web Services, **Frankfurt / Almanya**. Yalnızca hesap açtığınızda. Aktarılan veri: kimlik ve iletişim, finansal veriler, belgeler ve hata kayıtları. Verilerinizin bulunduğu asıl yer burasıdır.",
      "**Resend** — Amerika Birleşik Devletleri. Yalnızca geri bildirim gönderdiğinizde. Aktarılan veri: mesajınız, seçtiğiniz kategori, varsa ekran görüntüleriniz, size dönülebilmesi için hesabınızın e-posta adresi ve raporun geldiği cihazın platformu ile uygulama sürümü.",
      "**GitHub Pages** — Amerika Birleşik Devletleri. Web sürümünü açtığınız her seferde, giriş yapmadan önce de. Aktarılan veri: bağlantı bilgisi (IP adresi, tarayıcı bilgisi). Finansal veri aktarılmaz.",
      "**Expo (EAS)** — Amerika Birleşik Devletleri. Mobil uygulama güncelleme sorduğunda. Aktarılan veri: güncelleme sorgusu. Finansal veri aktarılmaz.",
      "**TCMB** — Türkiye. Mobil uygulamada günlük döviz kurları buradan okunur. Aktarılan veri: yalnızca bağlantı bilgisi. Yurt içinde kaldığı için yurt dışına aktarım değildir.",
      "**exchangerate-api (open.er-api.com)** — Amerika Birleşik Devletleri. Döviz kurunun ikinci kaynağı; web sürümünde tek kaynaktır. Aktarılan veri: yalnızca bağlantı bilgisi.",
      "**Binance halka açık piyasa verisi (data-api.binance.vision)** — yurt dışı. Altın, dolar ve euro kotasyonları buradan okunur. Aktarılan veri: yalnızca bağlantı bilgisi; hangi yatırımlarınız olduğu gönderilmez.",
      "**Google, DuckDuckGo ve icon.horse** — Amerika Birleşik Devletleri; icon.horse'un sunucu konumu hizmet sağlayıcı tarafından açıklanmamıştır. Bir aboneliğe ya da ödeme yöntemine tanınan bir kurum adı yazdığınızda, o kurumun logosunu getirmek için bu üçünden birine istek gider — siz daha kaydetmeden, yazarken. Aktarılan veri: bağlantı bilgisi ve yazdığınız adın karşılık geldiği alan adı; yani hangi bankayı ya da hangi aboneliği yazdığınız bu servis tarafından görülebilir. Tutar, tarih, not ve diğer kayıtlarınız gönderilmez.",
    ],
    transferNote: "Türkiye dışına yapılan bu aktarımlar KVKK m. 9 hükümlerine tabidir. Helix hesap açmadan kullanılamadığı için bu aktarımların dışında kalmanın bir yolu yoktur; kabul etmiyorsanız hesap oluşturmamanız gerekir. Aktarımın kapsamı ise sınırlıdır: kayıtlarınız ve belgeleriniz yalnızca Supabase'e, geri bildiriminiz yalnızca Resend'e gider. Kur, piyasa ve logo servislerine giden isteklerde kayıtlarınız yoktur — yalnızca bağlantı bilginiz ve, logo isteğinde, yazdığınız kurumun alan adı.",

    retentionTitle: "6. Saklama ve imha",
    retention: [
      "**Cihazınızdaki veriler**, uygulamayı kaldırana veya çalışma alanını sıfırlayana kadar saklanır.",
      "**Buluttaki finansal veriler ve belgeler**, hesabınızı silene kadar saklanır. Hesabınızı sildiğinizde kimliğiniz, kayıtlarınız ve belgeleriniz aynı işlemde silinir.",
      "**Hata kayıtları en fazla 180 gün saklanır.** Silmeyi uygulama başlatır: her eşitlemede, süresi geçmiş kayıtları silen veritabanı işlevi çağrılır ve o işlev 180 günden yenisine erişemez. Uygulamayı bir daha hiç açmazsanız bu çağrı da yapılmaz; hesabınızı sildiğinizde bu kayıtlar kimliğinizle birlikte aynı işlemde gider.",
      "**Geri bildirim e-postaları**, talebiniz sonuçlandıktan sonra e-posta kutusunda kalır; silinmesini talep etmeniz hâlinde silinir.",
    ],

    rightsTitle: "7. İlgili kişi olarak haklarınız",
    rightsIntro: "Kanunun 11. maddesi uyarınca, veri sorumlusuna başvurarak aşağıdaki taleplerde bulunma hakkına sahipsiniz:",
    rights: [
      "Kişisel verinizin işlenip işlenmediğini öğrenme; işlenmişse buna ilişkin bilgi talep etme.",
      "Kişisel verinizin işlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme.",
      "Yurt içinde veya yurt dışında kişisel verinizin aktarıldığı üçüncü kişileri bilme.",
      "Kişisel verinizin eksik veya yanlış işlenmiş olması hâlinde bunların düzeltilmesini isteme.",
      "Kanunun 7. maddesinde öngörülen şartlar çerçevesinde kişisel verinizin silinmesini veya yok edilmesini isteme.",
      "Düzeltme, silme ve yok etme işlemlerinin, kişisel verinizin aktarıldığı üçüncü kişilere bildirilmesini isteme.",
      "İşlenen verinizin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme.",
      "Kişisel verinizin kanuna aykırı olarak işlenmesi sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme.",
    ],

    selfServiceTitle: "8. Başvuru beklemeden kullanabileceğiniz araçlar",
    selfService: [
      "**Verilerinizi indirmek için:** Ayarlar → Dışa Aktar. Tüm kayıtlarınızı okunabilir bir dosya olarak verir.",
      "**Hesabınızı ve buluttaki verilerinizi silmek için:** Ayarlar → Hesap Güvenliği → Hesabı Sil. Kimliğiniz, kayıtlarınız ve belgeleriniz aynı işlemde silinir.",
      "**Yalnızca bu cihazı temizlemek için:** Ayarlar → Verileri Sıfırla.",
    ],

    contactTitle: "9. Başvuru usulü",
    contactBody: (email: string) =>
      `Kanunun 13. maddesi uyarınca, yukarıdaki haklarınıza ilişkin taleplerinizi kimliğinizi tespit edici bilgilerle birlikte ${email} adresine iletebilirsiniz. Başvurunuz, niteliğine göre en kısa sürede ve her hâlde en geç otuz gün içinde ücretsiz olarak sonuçlandırılır. Talebiniz reddedilirse gerekçesi bildirilir. Başvurunuzun reddedilmesi, verilen cevabı yetersiz bulmanız veya süresinde cevap verilmemesi hâlinde Kişisel Verileri Koruma Kurulu'na şikâyette bulunma hakkınız saklıdır. Helix'in tek bir geliştiricisi bulunmaktadır; bu nedenle sabit bir yanıt süresi taahhüt edilmemekte, ancak kanuni süreye uyulmaya çalışılmaktadır.`,

    disclaimer: "Bu metin, uygulamanın kaynak kodunda gerçekte ne yaptığını anlatır ve kodla birlikte güncellenir. Hukuki danışmanlık niteliği taşımaz.",

    /* The one-line version, shown where an account is about to be created. It
       has to carry the one fact a person cannot undo by reading the notice
       afterwards: creating an account is what starts the transfer abroad. */
    signUpNotice: "Hesap oluşturduğunda e-postan ve kayıtların cihazından çıkıp bulut sunucularında tutulmaya başlar. Nereye ve neden olduğu Aydınlatma Metni'nde yazıyor.",
    readNotice: "Aydınlatma Metnini Oku",
    /* The consent gate on sign-up. It says "read and accept", so the control
       beside it has to make reading possible without leaving the form — which
       is what the notice sheet is for. */
    consentLabel: "Okudum, anladım ve kişisel verilerimin burada anlatıldığı şekilde işlenmesini kabul ediyorum.",
    consentOpen: "Aydınlatma Metni'ni oku ve onayla",
    consentGiven: "Aydınlatma Metni onaylandı",
    consentHint: "Metni açar; onay metnin sonundadır.",
    consentView: "Görüntüle",
    consentViewHint: "Onayladığın metni yeniden açar.",
    consentRequired: "Devam etmek için Aydınlatma Metni'ni okuyup onaylaman gerekiyor.",
  },
  meta: {
    /* The document title, which is also the search result and the shared-link
       headline. It was "Helix" alone: a word that says nothing to anyone who
       has not already used the app, in the one line a stranger reads first. */
    title: "Helix: Bütçe, Abonelikler ve Yatırımlar",
    description: "Aylık nakit akışı, taksitler ve abonelikler için çevrimdışı çalışabilen kişisel finans uygulaması.",
    /* Longer than `description` has room for, because a link preview card is
       read on its own with none of the page around it. */
    social: "Paranın bu ay nerede olduğunu ve ay sonunda nerede olacağını tek ekranda gösterir. Taksitler, abonelikler, düzenli gelirler ve yatırımlar bir arada; çevrimdışı çalışır, cihazların arasında eşitlenir.",
  },
  // `tabs` is the accessible/screen name of each tab, `tabBar` its short footer
  // label. They stay in step: the footer says "Durum", so the tab announces
  // "Durum" too — a screen reader must not name a screen the UI never calls it.
  tabs: { dashboard: "Durum", cashflow: productTerms.financialTable, subscriptions: "Abonelikler", investments: "Yatırımlar", settings: "Ayarlar" },
  tabBar: { dashboard: "Durum", cashflow: productTerms.financialTable, subscriptions: "Abonelikler", investments: "Yatırımlar", settings: "Ayarlar" },
  common: {
    otherCurrencies: "Hangi para birimi?",
    save: "Kaydet", cancel: "Vazgeç", delete: "Sil", edit: "Düzenle", add: "Ekle",
    undo: "Geri Al", deleted: "Silindi", search: "Ara", close: "Kapat", done: "Tamam",
    total: "Toplam", note: "Not", none: "Kategorisiz", retry: "Tekrar dene",
    confirm: "Onayla", skip: "Atla", all: "Tümü", active: "Aktif", inactive: "Pasif",
    operationSummary: "Bu adımda ne olur", operationPlan: "İşlem planı",
    selectAll: "Tümünü seç", clearAll: "Tümünü bırak",
    amountLimit: "Bu tutar desteklenen sınırı aşıyor. En fazla ₺999.999.999.999,99 girebilirsin.",
    /** For input that is not a number at all — an unfinished expression, a
     *  lone comma. `amountLimit` used to answer for this too, naming a
     *  ceiling the input was nowhere near. */
    amountUnreadable: "Geçerli bir tutar yaz. Örnek: 1.234,56 ya da 300+400.",
    optionalHint: "Opsiyonel",
    other: "Diğer",
    paymentFallback: "Ödeme",
    previous: "Önceki",
    next: "Sonraki",
    back: "Geri",
    pickDate: "Tarih Seç",
    weekdays: ["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"],
  },
  dates: {
    monthEnd: "Ayın son günü",
    monthEndHint: "Hangi ay olursa olsun o ayın son gününe düşer: şubatta 28, kısa aylarda 30.",
    monthDayPlaceholder: "1–31",
    dayTakenByPair: "Bu gün eşleşen alanda seçili",
  },
  a11y: {
    showPassword: "Şifreyi göster",
    hidePassword: "Şifreyi gizle",
    openCalculator: "Hesap makinesini aç",
    // The Settings destination is called "Araçlar"; the popup inside an amount
    // field is still just the calculator and must say so.
    calculatorTitle: "Hesap Makinesi",
    datePicker: "Tarih seç",
    selectOption: "Seç",
    fieldError: (message: string) => `Alan hatası: ${message}`,
    tourStep: (step: number, total: number, title: string) => `${total} adımdan ${step}. ${title}`,
    calculatorKey: (key: string) => ({
      "⌫": "Son basamağı sil",
      "C": "Hesabı temizle",
      "÷": "Böl",
      "×": "Çarp",
      "-": "Çıkar",
      "+": "Topla",
      "=": "Sonucu hesapla",
      ",": "Ondalık ayırıcı",
    }[key] ?? key),
    donutChart: (total: string, values: string) => `Halka grafik. Toplam ${total}. ${values}`,
    lineChart: (values: string) => `Çizgi grafik. ${values}`,
    barChart: (values: string) => `Sütun grafik. ${values}`,
    pinColumn: (label: string) => `${label} kolonunu sabitle`,
    unpinColumn: (label: string) => `${label} kolonunun sabitlemesini kaldır`,
    matrixCell: (month: string, column: string, value: string, hasNote: boolean) =>
      `${month}, ${column}, ${value}${hasNote ? ", not var" : ""}`,
    emptyValue: "değer yok",
    tableLabel: (corner: string) => `${corner} mali tablo görünümü`,
    tableNavigation: "Kaydırarak gez. Web'de odaklandıktan sonra ok ve sayfa tuşlarını kullanabilirsin.",
    calculatorDisplay: (value: string, preview?: string) => `Hesap makinesi ekranı: ${value}${preview ? `. Önizleme: ${preview}` : ""}`,
    categorySummary: (title: string, value: string, hasNote: boolean) =>
      `${title}. ${value}${hasNote ? ". Not var" : ""}`,
  },
  forms: {
    discardTitle: "Kaydedilmemiş değişiklikler var",
    discardBody: "Bu ekrandan çıkarsan yaptığın değişiklikler kaybolacak.",
    discardAction: "Değişiklikleri sil",
  },
  privacy: {
    coverTitle: "Finansal bilgilerin gizlendi",
    coverBody: "Helix yeniden etkin olduğunda kaldığın yerden devam edebilirsin.",
    framedBody: "Güvenliğin için Helix başka bir sitenin içinde gösterilmez. Uygulamayı doğrudan açabilirsin.",
    openDirectly: "Helix'i Doğrudan Aç",
  },
  /** What each backup section is called in the file, for restore diagnostics. */
  backupTables: {
    persons: "Kişiler",
    categories: "Kalemler",
    category_budgets: "Harcama limitleri",
    investment_profiles: "Yatırım alanı",
    investment_products: "Yatırım ürünleri",
    payment_sources: "Ödeme yöntemleri",
    computed_columns: "Hesaplanan kolonlar",
    installment_plans: "Taksit ve kredi planları",
    credit_card_statements: "Kart ekstreleri",
    subscriptions: "Abonelikler",
    transactions: "İşlemler",
    attachments: "Ek dosyalar",
    matrix_colors: "Tablo renk işaretleri",
    investment_operations: "Yatırım hareketleri",
    price_history: "Fiyat geçmişi",
    recurring_incomes: "Düzenli gelirler",
    expected_payments: "Beklenen ödemeler",
    balance_adjustments: "Bakiye düzeltmeleri",
    cell_notes: "Hücre notları",
    settings: "Ayarlar",
    fx_rates: "Döviz kurları",
  } as Record<string, string>,
  errors: {
    title: "Hata",
    /* The boot screen, which is the one surface a person reaches when the app
       could not start at all. It used to say `database: "Veritabanı hatası"`,
       which named the layer that failed instead of what happened, and left the
       only two useful actions — close the other tab, or try again — for the
       reader to guess between. Both surfaces that showed it now say which of
       the two happened, so the key itself is gone rather than left orphaned. */
    bootBusyTitle: "Helix başka bir sekmede açık",
    bootBusyHint: "Verilerinde bir sorun yok. Helix aynı anda tek sekmede çalışabilir. Diğer sekmeyi kapat; bu sayfa kendiliğinden açılır.",
    /* Shown once another tab has actually ANSWERED, which is the state where
       reloading provably cannot help. "Burada Aç" was here and was a promise
       the button could not keep: pressing it reloaded into this same screen. */
    bootBusyHintHeld: "Helix şu anda başka bir sekmede açık ve veritabanını orası tutuyor. Bu sayfanın açılabilmesi için önce o sekmeyi kapatman gerekiyor — kapattığın anda burası kendiliğinden açılır, bir şeye basmana gerek yok.",
    bootBusyBlocked: "Diğer Sekmede Açık",
    bootBusyAction: "Yeniden Dene",
    bootFailedTitle: "Çalışma alanı açılamadı",
    bootFailedHint: "Kayıtların cihazında duruyor. Tekrar denemek çoğu zaman yeterli olur; sürerse uygulamayı kapatıp açmayı dene.",
    supabaseNotConfigured: "Supabase yapılandırılmadı",
    signUpFailed: "Kayıt oluşturulamadı",
    invalidBackupFile: "Geçersiz yedek dosyası",
    /**
     * WHERE the file was refused, in the file's own coordinates.
     *
     * A restore rejects the whole bundle when one row breaks one rule, and the
     * message used to be four words. Finding the real cause of a refused
     * backup took five rounds of bisecting the file WITH the source open; the
     * owner of a single backup has no such route. The refusal now names the
     * table, the row and the rule, which is enough to open the JSON and look.
     */
    invalidBackupWhere: (table: string, row: number, reason: string) =>
      `Geçersiz yedek dosyası. ${table} bölümündeki ${row}. kayıt alınamadı: ${reason}.`,
    invalidBackupReason: {
      shape: "alan biçimi beklenenden farklı",
      duplicate: "aynı kimlik dosyada iki kez geçiyor",
      link: "bağlı olduğu kayıt dosyada yok",
      definition: "kolon tanımı okunamıyor",
      envelope: "dosya başlığı okunamıyor",
      mixedAccounts: "dosya birden fazla hesabın kaydını taşıyor",
      unknownTable: "tanınmayan bir bölüm var",
      investments: "yatırım hareketleri kendi içinde tutarsız (nakit, miktar ya da maliyet)",
    },
    backupTooLarge: "Yedek dosyası güvenli içe aktarma sınırını aşıyor.",
    workspaceResetFailed: "Cihazdaki önceki hesabın verileri temizlenemedi; giriş yapılamadı. Lütfen tekrar dene.",
    fxUnavailable: "Döviz kuru henüz alınamadı. İnternete bağlanınca tekrar dene.",
    saveFailed: "Kaydedilemedi. Lütfen tekrar dene.",
    deleteFailed: "Silinemedi. Lütfen tekrar dene.",
    requestFailed: "İşlem tamamlanamadı. Lütfen tekrar dene.",
    undoFailed: "Geri alınamadı. Lütfen tekrar dene.",
    appCrashed: "Beklenmeyen bir sorun oluştu.",
    appCrashedHint: "Uygulama bu ekranı gösteremedi. Yeniden dene; sorun sürerse uygulamayı kapatıp aç.",
    /* NOT an error, and it was filed as one. `importBundle` counts a row as
       skipped when the LOCAL copy is newer than or the same age as the one in
       the file — the device already holds the better version. Calling those
       "geçersiz" told someone restoring their only backup that part of their
       data was corrupt. The Excel importer already said this correctly. */
    importSkippedRows: (n: number) => `${n} kayıt zaten güncel olduğu için atlandı.`,
  },
  databaseRecovery: {
    title: "Yerel veritabanı güvenli moda alındı",
    preserved: (fileName: string) =>
      `Bozuk veritabanı silinmedi; ${fileName} adıyla cihazında korundu. Helix kullanıma devam edebilmen için temiz bir çalışma alanı açtı.`,
    recreated: "Bozuk yerel veritabanı kullanımdan çıkarıldı ve temiz bir çalışma alanı açıldı.",
    next: "Yeni kayıt eklemeden önce verilerini kontrol et. Buluta bağlı hesabın yeniden eşitlenir; JSON yedeğin varsa başlangıç ekranındaki “Yedekten Geri Yükle” seçeneğini kullan.",
    continue: "Kurtarma Yoluna Devam Et",
  },
  placeholders: {
    computedColumnName: "Ör. Sabit Giderler Toplamı",
    email: "ornek@eposta.com",
    zeroAmount: "0,00",
    subscription: ["Netflix", "Spotify", "YouTube Premium", "iCloud", "Elektrik", "Doğalgaz", "Su", "İnternet", "Telefon", "Amazon Prime", "ChatGPT", "BluTV"],
    installment: ["Telefon", "Dizüstü bilgisayar", "Beyaz eşya", "Konut kredisi", "Mobilya", "Tatil", "Araç kasko taksidi"],
    category: ["Market", "Ulaşım", "Faturalar", "Eğlence", "Sağlık", "Eğitim", "Giyim", "Kira"],
    person: ["Eşim", "Annem", "Kardeşim", "Ev arkadaşım"],
    source: ["Banka kartım", "Kredi kartım", "Nakit", "Dijital cüzdan", "Ortak hesap"],
    note: ["Market alışverişi", "Doğum günü hediyesi", "Yıllık ödeme", "Arkadaşlarla yemek", "İade bekleniyor"],
    amount: ["400+500", "15.000", "1.250,50", "89,90", "300+150", "2.500", "12.400", "49,99", "1.000+250+90"],
    investmentProduct: ["SASA", "Türk Hava Yolları", "Bitcoin", "Altın Fonu", "BES Planım"],
    investmentQuantity: ["17,23", "456,12", "10", "125,5", "1,25"],
    investmentUnitPrice: ["5.800,00", "41,25", "250,00", "12.400,50"],
    investmentNote: ["Uzun vadeli birikim", "Aylık alım", "Portföy başlangıcı", "Kısmi satış"],
    // Written WITHOUT a prefix, like every other pool: `example()` adds the one
    // "Ör." this app uses. The old text said "Örn." inline, which
    // `examplePlaceholder` did not recognise as a prefix — so the field showed
    // "Ör. Örn. Mali Tablo'da…".
    feedback: [
      "Mali Tablo'da Nisan sütunu boş kalıyor",
      "Kaydet'e basınca hiçbir şey olmuyor",
      "Abonelik listesi açılırken donuyor",
      "Kredi kartı ekstresi bir ay ileri düşüyor",
      "Bakiye, işlemlerin toplamıyla uyuşmuyor",
      "Grafikteki renkler birbirine çok yakın",
    ],
    example: (sample: string) => `Ör. ${sample}`,
  },
  auth: {
    journeyEntry: "Kaydet",
    journeyLedger: "Anla",
    journeyTrack: "Takip et",
    /* The card's heading NAMES THE ACTION, like its two siblings ("Hesap
       oluştur", "Şifreni yenile"). It used to be a second "hoş geldin"
       directly under the page's own greeting. */
    signInHeading: "Hesabına giriş yap",
    /* Every mode's heading now has a subtitle under it. Sign-in was the one
       that did not, so its card was a line shorter than the other two and the
       layout resized on every switch. */
    signInSubtitle: "E-posta adresin ve şifrenle çalışma alanına gir.",
    /* The greeting above the form, and it is deliberately the SAME in all three
       modes. It used to be a sign-in-only panel reading "Çalışma alanına dön /
       Kaldığın yerden devam et", which addresses somebody who has been here
       before — on the screen most people meet Helix on for the first time. It
       also existed in one mode out of three, so the card changed height on
       every switch and the brand mark above it moved with it. One constant
       greeting fixes both: it welcomes whoever is reading, and it does not
       move. */
    /* Still used by `operation-flow.tsx`, which labels the sign-in operation
       with it. Only the auth screen's own greeting moved. */
    signInSignatureEyebrow: "Güvenli geri dönüş",
    welcomeTitle: "Helix'e hoş geldin",
    welcomeBody: "Gelirini, giderini ve yaklaşan ödemelerini tek yerde topla; paranın nereye gittiğini gör.",
    signUpTitle: "Hesap oluştur",
    signUpSubtitle: "Hesabını oluştur; e-posta adresini doğruladıktan sonra güvenle giriş yap.",
    signUpConfirmationSent: "Doğrulama bağlantısı e-posta adresine gönderildi. Gelen kutunu ve gereksiz klasörünü kontrol et.",
    email: "E-posta", password: "Şifre",
    signIn: "Giriş yap",
    signOut: "Çıkış yap",
    signOutSignatureEyebrow: "Oturum sınırı",
    localSignOutDialogEyebrow: "Cihazdan ayrıl",
    signOutSignatureDescription: "Bu cihazdaki oturum kapanır; hesabın ve buluttaki verilerin korunur.",
    signOutDialogSection: "Oturum kapanınca",
    signOutDialogAccountTitle: "Hesap ve bulut verileri korunur",
    signOutDialogAccountDetail: "Çıkış yalnızca bu cihazdaki oturumu kapatır.",
    signOutDialogReturnTitle: "Tekrar girişte kaldığın yerden devam edersin",
    signOutDialogReturnDetail: "Aynı hesapla yeniden bağlandığında çalışma alanın geri gelir.",
    signOutDialogStepSessionTitle: "Bu cihazdaki oturum kapanır",
    signOutDialogStepSessionDetail: "Hesap ve bulut verileri korunur.",
    signOutDialogStepReturnTitle: "Giriş ekranına dönersin",
    signOutDialogStepReturnDetail: "Aynı hesapla yeniden devam edebilirsin.",
    localSignOutSignatureDescription: "Bu cihazdaki çalışma alanı kapanır ve yerel veriler temizlenir.",
    localSignOutDialogSection: "Cihazdan ayrılmadan önce",
    localSignOutDialogDeviceTitle: "Bu cihazdaki veriler silinir",
    localSignOutDialogDeviceDetail: "Buluta gönderilmemiş kayıtlar geri getirilemez.",
    localSignOutDialogBackupTitle: "Önce yedek al",
    localSignOutDialogBackupDetail: "Yedek Oluştur ile verilerini dışa aktararak bu riski kaldırabilirsin.",
    localSignOutDialogStepDeviceTitle: "Yerel çalışma alanı temizlenir",
    localSignOutDialogStepDeviceDetail: "Buluta gönderilmemiş kayıtlar geri getirilemez.",
    localSignOutDialogStepBackupTitle: "İstersen önce yedek al",
    localSignOutDialogStepBackupDetail: "Yedek Oluştur ile verilerini dışa aktarabilirsin.",
    passwordMin: "En az 8 karakter",
    emailInvalid: "Geçerli bir e-posta adresi girin",
    createAccountAction: "Yeni hesap oluştur",
    backToSignInAction: "Zaten hesabım var, giriş yap",
    /** The reset screen's own button, where "giriş yap" IS the whole action. */
    signInAction: "Giriş yap",
    forgotPassword: "Şifremi unuttum",
    forgotTitle: "Şifreni yenile",
    forgotSubtitle: "E-posta adresini yaz; güvenli şifre yenileme bağlantısını gönderelim.",
    sendResetLink: "Yenileme Bağlantısı Gönder",
    resendResetLink: "Bağlantıyı Tekrar Gönder",
    resetSent: "Bu adresle bir hesap varsa şifre yenileme bağlantısı gönderildi. Gelen kutunu ve gereksiz klasörünü kontrol et.",
    /** Signed IN, where the account is not in question and the address is
     *  known. The hedge above protects a signed-out form from confirming which
     *  addresses are registered; here it would only be telling somebody their
     *  own account might not exist. */
    resetSentToOwnAddress: (email: string) =>
      `Şifre yenileme bağlantısı ${email} adresine gönderildi. Gelen kutunu ve gereksiz klasörünü kontrol et.`,
    backToSignIn: "Giriş ekranına dön",
    resetTitle: "Yeni şifreni belirle",
    resetSubtitle: "Hesabın için en az 8 karakterli yeni bir şifre oluştur.",
    newPassword: "Yeni şifre",
    confirmNewPassword: "Yeni şifreyi doğrula",
    passwordsMismatch: "Şifreler aynı değil",
    resetSave: "Şifreyi Yenile",
    resetSuccessTitle: "Şifren yenilendi",
    resetSuccessBody: "Yeni şifrenle güvenle giriş yapabilirsin.",
    resetExpiredTitle: "Bağlantının süresi dolmuş",
    resetExpiredBody: "Güvenliğin için yenileme bağlantıları sınırlı süre geçerlidir. Giriş ekranından yeni bir bağlantı iste.",
    resetInvalidTitle: "Bağlantı kullanılamıyor",
    resetInvalidBody: "Bu bağlantı geçersiz veya daha önce kullanılmış olabilir. Giriş ekranından yeni bir bağlantı iste.",
    requestNewLink: "Yeni Bağlantı İste",
    offlineNote: "Verilerin cihazında saklanır, internet yokken de çalışır.",
    errInvalidCredentials: "E-posta veya şifre hatalı.",
    errUserExists: "Bu e-posta ile zaten bir hesap var; giriş yapmayı dene.",
    errRateLimit: "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.",
    errNetwork: "İnternete bağlanılamadı. Bağlantını kontrol edip tekrar dene.",
    errWeakPassword: "Şifre çok zayıf; en az 8 karakter kullan.",
    errEmailNotConfirmed: "E-posta adresin henüz doğrulanmamış; gelen kutunu kontrol et.",
    errInvalidEmail: "Geçerli bir e-posta adresi gir.",
    errEmailDelivery: "Şifre yenileme e-postası şu anda gönderilemiyor. Uygulama yöneticisi posta servisini yapılandırmalı.",
    errSessionExpired: "Oturumun doğrulanamadı. Lütfen çıkış yapıp yeniden giriş yap.",
    errService: "Sunucu şu anda yanıt vermiyor. Birazdan tekrar dene.",
    errGeneric: "İşlem tamamlanamadı. Lütfen tekrar dene.",
    signOutPendingTitle: "Gönderilmemiş kayıtlar var",
    signOutPendingWarn: (n: number) =>
      `${n} kayıt henüz buluta eşitlenmedi. Şimdi çıkarsan bu kayıtlar kalıcı olarak silinir. Yine de çıkmak istiyor musun?`,
    signOutAnyway: "Yine de Çık",
    restoringData: "Hesabın eşitleniyor",
    restoringDataFresh: "Hesabın hazırlanıyor",
    signOutPendingBlocked: "Bazı değişikliklerin henüz eşitlenmedi. Verilerin cihazında korunuyor.",
    signOutLocalTitle: "Tüm veriler silinecek",
    signOutLocalWarn:
      "Bu cihaz buluta bağlı değil; verilerin yalnızca burada saklanıyor. Çıkarsan tüm verilerin kalıcı olarak silinir ve geri getirilemez. Önce 'Yedek Oluştur' ile dışa aktarmanı öneririz.",
  },
  account: {
    section: "Hesap ve Güvenlik",
    freeze: "Hesabı Dondur",
    freezeSignatureEyebrow: "Geçici koruma",
    freezeSignatureDescription: "Hesabın geçici olarak askıya alınır; verilerin korunur ve tekrar girişte yeniden açılır.",
    freezeConfirmTitle: "Hesabı dondur",
    freezeConfirmBody:
      "Çıkış yapılıp giriş ekranına döneceksin. Verilerin silinmez, bulutta korunur; tekrar giriş yapınca kaldığın yerden devam edersin (istersen başka bir hesapla da girebilirsin). Devam edilsin mi?",
    freezeConfirm: "Dondur ve Çık",
    freezeDialogSection: "Dondurma planı",
    freezeDialogProtectTitle: "Verilerin korunur",
    freezeDialogProtectDetail: "Buluttaki kayıtların ve ayarların silinmez.",
    freezeDialogCloseTitle: "Oturumun güvenle kapanır",
    freezeDialogCloseDetail: "Son değişiklikler korunmadan işlem tamamlanmaz.",
    freezeDialogReturnTitle: "Tekrar girişte devam edersin",
    freezeDialogReturnDetail: "Hesabını yeniden açmak için aynı hesapla giriş yapman yeterli.",
    freezeSyncFailed: "Gönderilmemiş kayıtlar güvenle buluta aktarılamadı. Hesap dondurulmadı; internet bağlantını kontrol edip tekrar dene.",
    freezeRollbackFailed:
      "Hesap dondurulamadı ve bu cihazdaki dondurma işareti geri alınamadı. Uygulamayı yeniden başlat; sorun sürerse çıkış yapıp tekrar giriş yap.",
    frozenTitle: "Hesabın donduruldu",
    frozenBody: "Devam etmek için kimliğini doğrula ya da çıkış yapıp yeniden giriş yap.",
    reactivate: "Kilidi Aç ve Devam Et",
    reactivatingTitle: "Hesap yeniden açılıyor",
    reactivatingBody: "Hesabın yeniden kullanıma açılıyor",
    frozenSignOut: "Çıkış Yap ve Giriş Ekranına Dön",
    delete: "Hesabı Sil",
    deleteSignatureEyebrow: "Kalıcı silme",
    deleteSignatureDescription: "Hesap, mali tablo, abonelikler ve ayarlar geri döndürülemeyecek şekilde silinir.",
    deleteConfirm1Title: "Hesabı sil",
    deleteConfirm1Body:
      "Tüm verilerin (işlemler, taksitler, abonelikler, ayarlar) buluttan ve bu cihazdan kalıcı olarak silinecek. Bu işlem geri alınamaz.",
    deleteConfirm: "Kalıcı Olarak Sil",
    deleteDialogSection: "Kalıcı silme kapsamı",
    deleteDialogListTitle: "Geri alınamayacaklar",
    deleteDialogItemAccount: "Hesap ve kimlik bilgileri",
    deleteDialogItemFinance: "Mali tablo, işlemler ve taksitler",
    deleteDialogItemSettings: "Abonelikler, ayarlar ve yerel kopya",
    deleteDialogIrreversible: "Bu işlem tamamlandıktan sonra geri alınamaz.",
    deleteDialogFinalCheckTitle: "Son kontrol",
    deleteDialogFinalCheckDetail: "Şifren son adımda yeniden doğrulanır.",
    deleteCloudFailed: "Buluttaki veriler silinemedi; internet bağlantını kontrol edip tekrar dene. Hiçbir şey silinmedi.",
    // Security: re-auth + credential change
    security: "Hesap Güvenliği",
    securityDesc: "E-posta ve şifreni değiştir.",
    confirmPasswordTitle: "Şifreni doğrula",
    freezePasswordBody: "Hesabı dondurmak için şifreni gir.",
    deletePasswordBody: "Hesabı kalıcı olarak silmek için şifreni gir. Bu işlem geri alınamaz.",
    wrongPassword: "Şifre hatalı. İşlem yapılmadı.",
    changeEmail: "E-postayı Değiştir",
    changeEmailSectionHint: "Yeni adresi mevcut şifrenle doğrula; onay bağlantısı yeni adresine gönderilir.",
    changePassword: "Şifreyi Değiştir",
    changePasswordSectionHint: "Mevcut şifreni doğrula ve bu hesap için yeni bir şifre belirle.",
    currentEmail: (e: string) => `Şu anki e-posta: ${e}`,
    newEmail: "Yeni e-posta",
    currentPassword: "Mevcut şifre",
    newPassword: "Yeni şifre",
    currentPasswordPlaceholder: "Mevcut şifren",
    newPasswordPlaceholder: "En az 8 karakter",
    emailChangeHint: "Değişikliğin geçerli olması için hem eski hem yeni e-postana gönderilen onay bağlantısına tıklaman gerekir.",
    emailChangeSent: "Onay bağlantısı e-postana gönderildi. Onayladıktan sonra yeni e-posta geçerli olur.",
    passwordChanged: "Şifren güncellendi.",
    resetLinkTitle: "Şifre yenileme",
    resetLinkHint: "Mevcut şifrene erişemiyorsan hesabındaki e-posta adresine güvenli bir yenileme bağlantısı gönder.",
  },
  dataReset: {
    title: "Veri Sıfırlama",
    entryDescription: "Hesabın açık kalır; seçtiğin kayıtları tarih aralığıyla temizlersin.",
    intro: `Kayıtları silersin, çalışma alanının kurgusunu değil. ${productTerms.items}, kolonlar, kişiler, ödeme yöntemleri ve yatırım ürünleri her durumda korunur.`,
    scopeSection: "Ne sıfırlansın?",
    rangeSection: "Hangi tarihler?",
    allDates: "Tüm tarihler",
    allDatesHint: "Aralık seçmezsen o kapsamdaki her kayıt silinir.",
    from: "Başlangıç",
    to: "Bitiş",
    clearRange: "Aralığı Temizle",
    rangeInvalid: "Başlangıç, bitişten sonra olamaz.",
    scope: {
      ledger: productTerms.financialTable,
      installments: "Taksitler ve Krediler",
      subscriptions: "Abonelikler",
      incomes: productTerms.recurringIncomes,
      budgets: "Bütçeler",
      investments: "Yatırımlar",
    },
    scopeHint: {
      ledger: `${productTerms.financialTable} girişlerin, ekleri, ${productTerms.balanceAdjustments.toLocaleLowerCase("tr")}, hücre notların ve o aylara ait hücre/kolon renklerin.`,
      installments: "Plan, tüm taksitleriyle birlikte gider. Aralık planın yalnızca bir kısmını kapsıyorsa o plana dokunulmaz.",
      subscriptions: "Abonelikler, fiyat geçmişleri ve bekleyen ödemeleri. Geçmişte ödediğin faturalar Mali Tablo'da kalır.",
      incomes: "Düzenli gelir kuralların ve bekleyen gelirleri. Hesabına geçmiş girişler Mali Tablo'da kalır.",
      budgets: "Seçilen aylara ait bütçe hedeflerin.",
      investments: "Yatırım işlemlerin. Ürünlerin ve cüzdan ayarların korunur.",
    },
    undatedNote: "Kural niteliğinde oldukları için tarih aralığı bu kapsama uygulanmaz; hepsi sıfırlanır.",
    investmentTailNote: "Yatırımlarda yalnızca başlangıç tarihi dikkate alınır: o tarihten sonraki tüm işlemler silinir. Ortadan dilim almak alım-satım zincirini bozardı.",
    anchorNote: "Tüm tarihleri seçtiğin için açılış bakiyen ve başlangıç ayın da sıfırlanır.",
    straddling: (count: number) =>
      count === 1
        ? "1 taksit planı seçilen aralığı aştığı için korunuyor."
        : `${count} taksit planı seçilen aralığı aştığı için korunuyor.`,
    summaryTitle: "Silinecek kayıtlar",
    summaryEmpty: "Bu seçimde silinecek kayıt yok.",
    summaryTotal: (count: number) => `Toplam ${count} kayıt`,
    calculating: "Hesaplanıyor",
    blockerTitle: "Bu seçim uygulanamaz",
    blockerCash:
      "Seçtiğin hareketler yatırım cüzdanına aktardığın parayı da kapsıyor; onları silmek cüzdanı karşılıksız bırakır. Yatırımlar kapsamını da seç ya da aralığı daralt.",
    blockerGeneric:
      "Seçim, yatırım geçmişini tutarsız bırakıyor. Yatırımlar kapsamını da seç ya da aralığı daralt.",
    confirmTitle: "Seçilen kayıtlar silinsin mi?",
    confirmBody: (count: number) =>
      `${count} kayıt bu cihazdan ve hesabının diğer cihazlarından kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
    confirmLabel: "Kalıcı Olarak Sil",
    passwordBody: "Seçilen kayıtları kalıcı olarak silmek için şifreni gir. Bu işlem geri alınamaz.",
    running: "Kayıtlar siliniyor",
    done: (count: number) => `${count} kayıt silindi.`,
    doneNothing: "Silinecek kayıt bulunamadı.",
    failed: "Kayıtlar silinemedi. Hiçbir şey silinmedi; tekrar dene.",
    action: "Seçilenleri Sıfırla",
  },
  lock: { title: "Helix kilitli", prompt: "Devam etmek için kimliğini doğrula", button: "Kilidi Aç" },
  onboarding: {
    welcome: "Hoş geldin",
    intro: "Birkaç adımda kurulumu tamamlayalım.",
    journeySetup: "Alanını kur",
    journeyImport: "Verini getir",
    journeyFollow: "Akışını izle",
    quickTitle: "Hızlı başlangıç",
    quickHint: "Helix'i hazır gelir-gider kalemleriyle hemen aç. Bakiye, kart, kişi ve geçmiş bilgilerini istediğin zaman tamamlayabilirsin.",
    quickBalance: "Bugünkü toplam bakiyen (opsiyonel)",
    quickDefaults: (count: number) => `${count} hazır kalem ve yalnızca “Ben” kişisi oluşturulur. Hiçbir ayarı şimdi vermek zorunda değilsin.`,
    quickStart: "Hemen Kullanmaya Başla",
    customizeSetup: "Kurulumu Özelleştir",
    quickMode: "Hızlı Başlangıca Dön",
    existingDataTitle: "Verilerin zaten var mı?",
    existingDataHint: "Yalnızca mevcut bir tabloyu veya Helix yedeğini taşıyacaksan kullan.",
    templateTitle: "Hazır kalemler",
    templateHint: "Başlangıç için önerilen kalemler. İstemediklerinin seçimini kaldır; hepsini sonradan düzenleyebilir, yenisini ekleyebilirsin.",
    templateBlankNote: "Hiçbirini seçmezsen boş başlarsın.",
    startTitle: "Başlangıç",
    startMonth: "Başlangıç Ayı",
    openingBalance: "Şu anki güncel bakiyen",
    openingHint: "Hesabındaki o anki toplam para. Başlangıç ayından bugüne kadar geçmiş de girersen, bu tutar başlangıç ayına geri hesaplanır.",
    personsTitle: "Kişiler",
    personsHint: "Harcamalarını izlemek istediğin, bakiyeni etkilemeyecek kişiler ekleyebilirsin.",
    me: "Ben",
    addPerson: "Kişi Ekle",
    sourcesTitle: productTerms.paymentMethods,
    sourcesHint: "Kartların, nakit ve hesapların. Birden fazla ekleyebilir, sonradan düzenleyebilirsin.",
    addSource: "Yöntem adı",
    updateSource: "Yöntemi Güncelle",
    historyPrompt: "Geçmiş verilerini gir",
    historyHint: "Geçmiş aylarını istersen şimdi girebilir, sonraya bırakabilirsin.",
    historyManual: "Elle geçmiş bilgi gir",
    historyManualDesc: "Ay ay gelir-giderlerini kendin gir.",
    historyExcel: "Excel'den içe aktar",
    historyExcelDesc: "Var olan bir tablodan aktar.",
    historyJson: "Yedek (JSON) içe aktar",
    historyJsonDesc: "Helix'ten dışa aktardığın yedeği geri yükle.",
    historySeeded: "Çalışma alanın hazırlandı. İçe aktardıktan sonra buraya dönüp kontrol edebilir, hazır olunca aşağıdan başlayabilirsin.",
    importedBanner: (years: string) => `✓ Excel verilerin içe aktarıldı (${years}). Kalemlerin ve açılış bakiyen dosyandan geldi; aşağıdan “Kaydet ve Kullanmaya Başla” diyebilirsin.`,
    importedTemplateNote: "Kalemlerin Excel'den geldiği için hazır kalemler otomatik kapatıldı. İstersen aşağıdan ek kalem seçebilirsin.",
    importedOpeningNote: "Açılış bakiyen Excel'deki en erken aydan alındı; bu alan kilitli. Güncel bakiyeni sonradan Ayarlar'dan düzeltebilirsin.",
    finishStart: "Kaydet ve Kullanmaya Başla",
  },
  dashboard: {
    greetingMorning: "Günaydın",
    greetingDay: "İyi günler",
    greetingEvening: "İyi akşamlar",
    greetingNight: "İyi geceler",
    actualBalance: "Güncel Bakiye",
    lastLogin: (d: string) => `Önceki giriş: ${d}`,
    pendingConfirm: (n: number) => (n === 1 ? "1 ödeme onay bekliyor" : `${n} ödeme onay bekliyor`),
    catchUp: "Onay bekleyen ödemeleri gözden geçir",
    forecastToggle: "Ay sonu tahmini",
    forecastRising: "yükseliyor",
    forecastFalling: "düşüyor",
    upcoming: "Yaklaşan Ödemeler",
    upcomingHint: "Otomatik ödeme olsun olmasın, önümüzdeki günlerde ödeyeceklerin: abonelikler, düzenli gelirler ve ileri tarihli işlemler.",
    allUpcoming: "Tüm Takvimi Gör",
    scheduledTx: "İleri tarihli işlem",
    cardStatement: "Kredi kartı ödemesi",
    late: "Geciken",
    expectedIncome: "Beklenen Gelir",
    markPaid: "Ödendi",
    received: "Alındı",
    investmentAside: "Yatırım",
    investmentRefundAside: "Yatırımdan çekim",
    refundAside: (name: string) => `${name} · Gider iadesi`,
    monthInsight: "Bu Ay",
    monthNet: (value: string) => `Net değişim ${value}`,
    netChange: "Net değişim",
    outflow: "Çıkış",
    monthFlowSummary: (income: string, outflow: string) => `Gelir ${income} · Çıkış ${outflow}. Ayrıntılı analiz için aç.`,
    forecastHint: "Bekleyen gelir ve giderler günü geldikçe işlendiğinde bakiyenin ay sonunda nereye varacağını gösterir; güncel bakiyen bugün için değişmez.",
    forecastCurrent: "Şu anki bakiye",
    forecastIncoming: "Bekleyen gelir",
    forecastOutgoing: "Kalan gider",
    forecastResult: "Ay sonu tahmini",
    forecastTypical: "Tipik harcamanla",
    forecastTypicalHint: (amount: string) =>
      `Yukarıdaki rakam yalnız bildiklerini toplar; markete, yakıta, dışarıda yemeğe ayın kalanında ne gideceğini bilemez. Son altı ayda abonelik ve taksit dışı harcaman ayda ne tuttuysa, bu ay şimdiye kadar harcadığın düşülerek ${amount} daha bekleniyor.`,
    noUpcoming: "Önümüzdeki 31 günde ödeme yok.",
    inDays: (n: number) => (n === 0 ? "bugün" : n === 1 ? "yarın" : `${n} gün sonra`),
  },
  sync: {
    errRls: "Eşitlemede geçici bir uyum sorunu oluştu; birazdan otomatik olarak yeniden denenecek.",
    errAuth: "Oturum yenileniyor; verilerin birazdan otomatik eşitlenecek.",
    errReauth: "Eşitleme için tekrar giriş yapman gerekiyor. Verilerin cihazında korunuyor.",
    errNetwork: "İnternet bağlantısı yok. Bağlanınca verilerin otomatik eşitlenecek.",
    errGeneric: "Şu an eşitleme yapılamadı; birazdan otomatik olarak tekrar denenecek.",
    errQuarantined: "Bazı eski kayıtlar yalnız bu cihazda kaldı. Verilerin korunuyor; yeniden denemeden önce JSON yedek al.",
    // Non-blocking: it reports something that already happened correctly, so it
    // names no record, no device, no version and no conflict.
    remoteChangeNotice: "Başka bir cihazdaki değişiklikler uygulandı.",
  },
  catchup: {
    /* "Onay Bekleyenler" sat one tap away from `attention.title`,
       "Bekleyenler", and the two screens could not be told apart by name. They
       do different jobs: this one asks whether payments that were DUE actually
       happened; the other collects what needs a decision next. The title now
       says which. */
    title: "Ödeme Onayı",
    subtitle: (d: string) => `${d} tarihinden beri`,
    nothing: "Onay bekleyen bir şey yok, güncelsin",
    skipped: (name: string) => `${name} atlandı`,
    fixAmount: "Tutarı Düzelt",
  },
  upcoming: {
    title: "Yaklaşan Takvimi",
    offline: "Son cihaz verilerin gösteriliyor. İnternet bağlantısı geldiğinde takvim otomatik olarak eşitlenecek.",
  },
  cell: {
    title: "Hücre Detayı",
    total: "Hücre toplamı",
    quickEntry: "Hızlı Giriş",
    quickEntryHint: "Tek bir tutar yazabilir ya da artı/eksi ile birden fazla tutarı toplayarak tek kayda dönüştürebilirsin (ör. 300+400+500 tek kayıt olur). Bu ay bu kaleme dair bir açıklaman varsa aşağıdaki Hücre Notu'na yazabilirsin.",
    noNote: "Bu hücrede not yok.",
    noteHint: "Bu ay bu kalemi açıklayan kısa bir not bırak; tutarı değiştirmez.",
    transactionsHint: "Bu hücrenin toplamını oluşturan hareketler.",
    addNote: "Not Ekle",
    notePlaceholder: "Bu ay bu kalemde neler oldu?",
  },
  attachments: {
    title: "Belgeler",
    hint: "Fiş, fatura veya garanti belgesini bu işlemin yanında sakla. Dosyalar hesabına eşitlenir; diğer cihazlarında da açabilirsin.",
    hintLocal: "Fiş, fatura veya garanti belgesini bu işlemin yanında sakla. Bulut eşitlemesi kapalı olduğu için dosyalar yalnızca bu cihazda kalır.",
    add: "Belge Ekle",
    empty: "Bu işleme bağlı belge yok.",
    open: "Aç",
    remove: "Sil",
    removed: "Belge silindi.",
    /* Two readings of the same tile, because the cause differs and so does
       what the owner can do about it. With a project, the file is on its way
       and waiting is the answer. Without one, nothing will ever bring it and
       saying "not downloaded yet" would be a promise the app cannot keep. */
    unavailable: "Bu belge henüz bu cihaza inmedi. İnternete bağlandığında kendiliğinden iner.",
    unavailableLocal: "Bu belge başka bir cihazda eklendi. Bulut eşitlemesi kapalı olduğu için dosya buraya gelmez.",
    otherDevice: "İnmedi",
    otherDeviceLocal: "Başka cihazda",
    /* Shown beside a ledger row, so it says what the row HAS rather than what
       the panel is called. Short: it sits in a wrapping badge cluster. */
    onTransaction: "Belge var",
    unsupported: "Bu tarayıcı yerel belge saklamayı desteklemiyor.",
    /* `attachments.kind` exists in the schema and syncs, but nothing writes
       anything except its "other" default — the picker asks for a file, not
       for what kind of file it is. The panel was therefore printing the same
       word, "Belge", on every document it had, under a heading that already
       said Belgeler. The labels come back when something chooses a kind. */
    rejected: {
      unsupported_type: "Yalnızca PDF ve fotoğraf ekleyebilirsin.",
      extension_mismatch: "Dosyanın uzantısı türüyle uyuşmuyor.",
      unsafe_name: "Dosya adı güvenli değil.",
      too_large: "Dosya 25 MB sınırını aşıyor.",
      empty: "Dosya boş görünüyor.",
    },
    sizeLabel: (kb: number) => `${kb} KB`,
    /* The same line the feedback screen shows under its pictures, so the two
       lists read as one pattern. No cap here: an unbounded count says how many
       there are rather than how many are left. */
    count: (files: number, kb: number) => `${files} belge · ${kb} KB`,

  },
  statement: {
    title: "Ekstreni İçeri Aktar",
    settingsDesc: "Kredi kartı ekstreni PDF'ten oku; her satırı onaylayarak aktar.",
    heroTitle: "Ekstreden Mali Tablo'ya",
    heroReady: (count: number) => `${count} satır okundu. Aşağıdan hangilerinin gireceğini seç.`,
    intro: "Kredi kartı ekstreni PDF olarak seç. Dosya cihazından çıkmaz, hiçbir yere yüklenmez; Helix PDF'i saklamaz.",
    pick: "PDF Seç",
    pickAgain: "Başka PDF Seç",
    guideTitle: "Ne okunur, ne okunmaz",
    guideLead: "Ekstre, uygulamanın doğrulayamayacağı bir belge. Bu yüzden tahmin etmez: emin olamadığı satırı almaz, aldığını da sen onaylamadan yazmaz.",
    guideReadsTitle: "Okunanlar",
    guideReads1: "Tarih, işyeri ve tutarı bir arada taşıyan satırlar",
    guideReads2: "Taksit konumu açıkça yazılmışsa (3/9) taksit olarak",
    guideReads3: "Eksi işaretli tutarlar iade olarak",
    guideRefusesTitle: "Alınmayanlar",
    guideRefuses1: "Karta yapılan ödeme — o parayı zaten harcamaların olarak biliyor",
    guideRefuses2: "Puan, faiz oranı, ara toplam ve sayfa başlıkları",
    guideRefuses3: "Taranmış PDF'ler; içinde okunabilir metin yoksa reddedilir",
    reviewTitle: "Okunanları Gözden Geçir",
    reviewHint: "Hiçbir satır sen onaylamadan kaydedilmez. Adı, tutarı ve kalemi düzeltebilir, istemediğin satırı silebilirsin.",
    readCount: (count: number) => `${count} satır okundu`,
    rejectedCount: (count: number) => `${count} satır okunamadı`,
    skippedCount: (count: number) => `${count} satır alınmadı`,
    checkTitle: "Okunanı ekstreyle karşılaştır",
    checkHint: "İsteğe bağlı. Ekstrende yazan dönem içi harcama toplamını yaz; Helix okuduklarının toplamıyla karşılaştırsın. Sayıyı sen giriyorsun çünkü hangi satırın o toplam olduğunu Helix tahmin etmez.",
    checkLabel: "Ekstredeki harcama toplamı",
    checkMatch: "Okunanlar ekstreyle birebir tutuyor.",
    checkShort: (amount: string) => `Ekstre ${amount} daha fazla gösteriyor. Okunamayan satırlar aşağıda; onları elle ekleyebilirsin.`,
    checkOver: (amount: string) => `Okunanlar ekstreden ${amount} fazla. Bir satır iki kez okunmuş ya da harcama olmayan bir satır harcama sayılmış olabilir.`,
    skippedTitle: "Bilerek alınmayanlar",
    skippedHint: "Bu satırlar okundu ama aktarılmıyor: karta yaptığın ödeme, harcamalarının kendisiyle aynı parayı ikinci kez sayardı.",
    descriptionLabel: "İşyeri adı",
    removeConfirm: "Bu satır listeden çıkarılacak ve aktarılmayacak. Dosyanda bir şey değişmez.",
    needsCategoryRow: "Bu satır için bir kalem seç.",
    rejectedTitle: "Okunamayan satırlar",
    rejectedHint: "Bu satırlar güvenle okunamadı, bu yüzden hiçbiri aktarılmadı. İstersen elle ekleyebilirsin.",
    reasons: {
      ambiguous_amount: "Satırda birden fazla tutar var",
      ambiguous_date: "Tarih geçersiz",
      no_description: "İşyeri adı okunamadı",
    },
    failures: {
      not_a_pdf: "Bu dosya bir PDF değil.",
      too_large: "Bu dosya bir ekstre için fazla büyük.",
      encrypted: "Bu PDF parola korumalı. Bankandan parolasız bir kopya al.",
      no_text_layer: "Bu PDF taranmış bir görüntü; içinde okunabilir metin yok. Bankandan metin içeren bir PDF indir.",
      unmapped_font: "Bu PDF'in yazı tipi Helix'in çözemediği bir biçimde gömülmüş. Metni tahmin etmemek için okunmadı.",
      unreadable: "Bu PDF okunamadı.",
    },
    empty: "Bu ekstrede tanınan bir işlem satırı bulunamadı.",
    emptyHint: "Helix yalnızca tarih, işyeri ve tutarı bir arada içeren satırları okur. Tanımadığı biçimleri tahmin etmez.",
    verdicts: {
      imported: "Bu satır zaten aktarılmış",
      plan: (title: string) => `${title} taksit planı bu ödemeyi zaten oluşturuyor`,
      similar: "Yakın tarihte aynı tutarda bir kayıt var",
    },
    installmentOf: (no: number, count: number) => `${no}/${count}. taksit`,
    refund: "İade",
    accept: "Aktar",
    acceptCount: (count: number) => `${count} satırı aktar`,
    selectAllNew: "Yeni Olanları Seç",
    clearSelection: "Seçimi Temizle",
    category: "Kalem",
    committed: (count: number) => `${count} işlem aktarıldı.`,
    skipped: (count: number) => `${count} satır zaten kayıtlıydı, atlandı.`,
    needsCategory: "Aktarmadan önce her satıra bir kalem seç.",
    a11yRow: (description: string, amount: string, date: string, state: string) =>
      `${description}, ${amount}, ${date}. ${state}`,
  },
  attention: {
    title: "Bekleyenler",
    subtitle: "Şu an karar bekleyen her şey burada. Bildirim yığını değil; işini bitirince satır kaybolur.",
    empty: "Bekleyen bir şey yok.",
    emptyHint: "Ödemelerin, denemelerin ve bakiye kontrolün güncel.",
    groups: {
      overdue: "Gecikmiş",
      today: "Bugün",
      soon: "Bu hafta",
      watch: "Takipte",
    },
    unread: "Yeni",
    unreadCount: (count: number) => `${count} yeni`,
    open: "Aç",
    done: "Bitti",
    snooze: "Sonra",
    snoozed: "Bir hafta sonra yeniden hatırlatılacak.",
    dismissed: "Satır kaldırıldı.",
    kinds: {
      late: "Gecikmiş ödeme",
      dueToday: "Bugün ödenecek",
      trialEnding: "Deneme bitiyor",
      driftedBalance: "Bakiye tutmuyor",
      finalInstallment: "Son taksit",
      upcoming: "Yaklaşan ödeme",
    },
    itemA11y: (kind: string, name: string, date: string, unread: string) =>
      `${kind}. ${name}. ${date}. ${unread}`,
  },
  provenance: {
    manual: "Elle girildi",
    spreadsheet: "Excel'den aktarıldı",
    statement: "Ekstreden okundu",
    expected: "Beklenen ödemeden işlendi",
    unknown: "Kaynağı kayıtlı değil",
    label: (source: string) => `Kaynak: ${source}`,
  },
  matrixColor: {
    title: (scope: string) => `${scope} rengi`,
    hint: (target: string) => `${target} için bir işaret seç.`,
    scope: { row: "Satır", column: "Kolon", cell: "Hücre" },
    // Four fixed hues, and what they are CALLED until the owner says otherwise.
    // These are defaults, not meanings: the names are stored once for the whole
    // account and every one of them can be rewritten from this sheet.
    token: {
      red: "Ödenmedi",
      orange: "Gecikti",
      yellow: "Kontrol edilmeli",
      green: "Ödendi",
    },
    option: (name: string) => `${name} olarak işaretle`,
    clear: "İşareti Kaldır",
    marked: (name: string) => `${name} olarak işaretli`,
    action: "Basılı tutarak renk ata",
    rename: (name: string) => `${name} adını değiştir`,
    renameTitle: "Rengin adı",
    renameHint: "Bu ad tabloda ve okuma rehberinde her yerde görünür; tek bir hücreye ait değildir.",
    renameSave: "Adı Kaydet",
    renameReset: "Varsayılana Dön",
    renamePlaceholder: "Örn. Bankaya sorulacak",
    renameEmpty: "Bir ad yaz ya da varsayılana dön.",
    renameFailed: "Ad kaydedilemedi.",
    legend: "Renkler",
  },
  cashflow: {
    title: productTerms.financialTable,
    monthDetail: "Ay Detayı",
    /* Back to "Güncel Bakiye" at the owner's call. The audit renamed it to
       "Ay Sonu" because the dashboard uses the same words for the one balance
       that is true right now — but the column is not a month boundary in the
       owner's model: it is the balance as it stands on that row's date, which
       is exactly what "güncel" means there. The defect behind the rename was
       never the word; it was that the two screens disagreed about the NUMBER,
       and that is fixed in `cash-flow-matrix.ts`. */
    opening: "Ay Başı", closing: "Güncel Bakiye",
    adjustedCell: (amount: string) => `Bu ay bakiye ${amount} düzeltildi`,
    income: "Gelir", expense: "Gider", transfer: "Yatırım", adjustment: "Bakiye Düzeltmesi",
    addTransaction: "İşlem Ekle",
    bulkEntry: "Geçmiş Ay Girişi",
    analysis: "Analiz",
    installments: "Taksitler",
    emptyMonth: "Bu ayda kayıt yok",
    emptyYearHint: "İşlem ekleyerek veya geçmiş ay girişiyle başlayabilirsin.",
    monthsAsRows: productTerms.rowFocused,
    monthsAsColumns: productTerms.columnFocused,
    editColumns: `${productTerms.columns}ı Düzenle`,
    editRows: "Satırları Düzenle",
    monthHeader: "Ay",
    itemHeader: productTerms.item,
    viewCards: "Ay odaklı",
    openMonth: "Ayın Detayını Aç",
    yearTotal: (y: number) => `${y} yıl toplamı`,
    openingLink: "Başlangıç Bakiyesi",
    /* One hint for both orientations. There were two and they disagreed: the
       row-focused one never mentioned that tapping a month opens it, although
       it does there too. A one-line version fit the width and lost the reader,
       so this says the whole thing in plain sentences and wraps if it must. */
    /* The pin used to be an emoji here while the table header drew the real
       lucide pin two centimetres below — one idea, two pictures, and the
       emoji took neither the palette nor the theme. The guide now names the
       control instead of trying to draw it. */
    tableHint: "Tabloyu yana kaydır. Kaleme dokun: aylık dökümü açılır. Aya dokun: o ay açılır. Başlıktaki iğneye dokun: kolon sabitlenir.",
    tableGuide: "Mali tabloyu okuma rehberi",
    /* The colours are the owner's to name, so the guide names the GESTURE and
       lets the legend beside it carry whatever they are called today. */
    tableColorHint: "Bir hücreyi, satırı ya da ayı basılı tut, renkle işaretle. Renklerin adlarını da buradan değiştirebilirsin:",
    cellTransactions: "Hareketler",
    cellNote: "Hücre notu",
    uncategorizedLegacy: "Kategorisiz eski kayıtlar",
    uncategorizedRepairHint: "Aylara göre açıp kayıtları düzenleyebilirsin.",
    // Phone toolbar mini captions (full names stay in accessibility labels).
    // The compact captions name the same object as the full labels above,
    // shortened rather than renamed: a phone said "Düzenle" and "Geçmiş"
    // where the desktop said "Kolonları Düzenle" and "Geçmiş Ay Girişi", so
    // the same five tools had to be learned twice.
    toolEdit: "Kolonlar",
    toolInstallments: "Taksitler",
    toolAnalysis: "Analiz",
    toolBulk: "Geçmiş Ay",
    toolOpening: "Başlangıç",
  },
  tx: {
    amountDetails: "Tutar ve işlem türü",
    amountDetailsHint: "İşlemin bakiyedeki yönünü ve kaydedilecek tutarı belirle.",
    assignment: "Sınıflandırma",
    timing: "Zamanlama",
    timingHint: "İşlemin hangi ayda veya günde bakiyeye yansıyacağını seç.",
    completion: "Not ve kayıt",
    new: "Yeni İşlem",
    edit: "İşlemi Düzenle",
    type: "Tür", expense: "Gider", income: "Gelir", transferInvest: "Yatırım",
    amount: "Tutar", currency: "Para Birimi",
    amountOptions: (kind: "expense" | "income" | "transfer", currency: string) =>
      kind === "expense"
        ? `Gider iadesi veya döviz · ${currency}`
        : kind === "income"
          ? `Gelir geri ödemesi veya döviz · ${currency}`
          : `Döviz seçeneği · ${currency}`,
    reversalLabel: (kind: "expense" | "income" | "transfer") =>
      kind === "expense" ? "Gider iadesi" : kind === "income" ? "Gelir geri ödemesi" : "Yatırımdan çekim",
    refundToggleHint: (kind: "expense" | "income" | "transfer") =>
      kind === "expense"
        ? "Ödediğin bir tutar geri geldiyse bu seçeneği aç."
        : kind === "income"
          ? "Aldığın bir geliri geri verdiysen bu seçeneği aç."
          : "Yatırımı bozup tutarı bakiyene aldıysan bu seçeneği aç.",
    reversalHint: (kind: "expense" | "income" | "transfer") =>
      kind === "expense"
        ? "Geri gelen tutar bakiyene eklenir; seçili kategorinin giderini azaltır."
        : kind === "income"
          ? "Geri verdiğin tutar bakiyenden düşer; seçili kategorinin gelirini azaltır."
          : "Çektiğin tutar bakiyene eklenir; yatırım toplamını azaltır.",
    tryEquivalent: (v: string) => `≈ ${v}`,
    staleRate: "Kur güncel değil, son bilinen kur kullanıldı",
    rateNotFound: "Kur bulunamadı. Önce internetle bir kez kur çek",
    singleCharge: "Tek Çekim",
    category: "Kategori", source: productTerms.paymentMethod, person: "Kimin İçin",
    categoryPlaceholder: "Kategori seç", sourcePlaceholder: "Ödeme yöntemi seç",
    addCategory: "Yeni kalem ekle", addSource: "Yeni ödeme yöntemi ekle",
    categoryRequiredEmpty: "İşlem için bir kategori gerekli. Önce bir kalem ekle.",
    effectiveDate: "Ödeme günü",
    effectiveDateHint: "Tutar bakiyene bu gün yansır.",
    cardPurchaseDate: "Harcama Günü",
    cardPurchaseHint: (statement: string, due: string) =>
      `Bu harcama ${statement} tarihli ekstreye girer; bakiyene ${due} son ödeme tarihinde yansır.`,
    cardPurchaseAndDue: (purchase: string, due: string) => `Harcama ${purchase} · Son ödeme ${due}`,
    cardCycleMissing: "Bu kartla işlem eklemek için Ayarlar'dan ekstre ve son ödeme günlerini tamamla.",
    futureHint: "İleri tarihli işlem: günü gelince bakiyenden düşer, tabloda şimdiden görünür. Ayarlar'dan kapatabilirsin.",
    whenLabel: "Ne zaman?",
    monthOnly: "Sadece ay",
    specificDay: "Belirli gün",
    monthOnlyHint: (m: string) => `Tarihsiz — ${m} ayına işlenir, günü belirtmen gerekmez.`,
    // The currency the form is actually on, not a hard-coded lira. It used to
    // read "₺ TRY · Değiştir" whatever had been chosen, so a form in dollars
    // said lira on the one line that names the currency. The caller supplies
    // the flag with the code — see `CURRENCY_INFO` — because a flag is how
    // this app names a currency everywhere else.
    changeCurrency: (currency: string) => `${currency} · Değiştir`,
    futureNote: "İleri tarihli",
    installmentToggle: "Taksitli",
    installmentCount: "Taksit sayısı",
    alreadyPaid: "Ödenen taksit",
    installmentInfo: (m: string, n: number) => `${n} taksit × ${m}`,
    /** When the total does not divide evenly the remainder rides on the LAST
     *  instalment, which is how TR cards bill it. Saying only the uniform
     *  figure made the preview add up to less than the purchase. */
    installmentInfoUneven: (n: number, first: string, last: string) =>
      `${n} taksit × ${first}, son taksit ${last}`,
    saveAndNew: "Kaydet ve Yeni Ekle",
    savedNotice: "İşlem kaydedildi.",
    updatedNotice: "İşlem güncellendi.",
    savedBalanceEffect: (amount: string) => `Güncel bakiyen ${amount} değişti.`,
    savedForecastEffect: (amount: string) => `Bugünkü bakiyen değişmedi; ay sonu öngörüne ${amount} işlendi.`,
    savedOtherMonth: (month: string) => `${month} ayına işlendi.`,
    deletedUndo: "İşlem silindi",
  },
  bulk: {
    title: "Geçmiş Ay Girişi",
    filledCount: (count: number) => `${count} tutar girildi`,
    month: "Ay",
    amountsTitle: "Ayın Tutarları",
    amountsHint: "Yalnız bildiğin toplamları doldur. Boş alanlar için sıfır tutarlı kayıt oluşturulmaz.",
    emptyCategoriesTitle: "Girilecek kalem bulunamadı",
    emptyCategoriesHint: "Geçmiş ay toplamlarını girebilmek için önce en az bir gelir veya gider kalemi ekle.",
    saved: (m: string) => `${m} kaydedildi`,
    aggregateBadge: "Tarihsiz",
    hint: "Boş bıraktığın kategoriler atlanır; kayıtlar toplu kayıt olarak işaretlenir ve sonradan detaylandırılabilir.",
  },
  installments: {
    title: "Taksitler & Krediler",
    thisMonthTotal: "Bu Ayki Toplam Yükümlülük",
    watchedMonthTotal: "İzlenen Kişilerin Bu Ayki Toplamı",
    watchedBalanceHint: "Takip amaçlıdır; senin bakiyene ve giderlerine dahil edilmez.",
    plan: "Taksitli Harcama", loan: "Kredi",
    planType: "Plan türü",
    newPlan: "Taksit veya Kredi Ekle",
    progress: (paid: number, total: number) => `${paid}/${total} ödendi`,
    planStateTitle: "Planın Durumu",
    planStateHint: "Şu ana kadar ne ödendi, sırada ne var.",
    currentInstallment: "Sıradaki taksit",
    nthOfTotal: (no: number, total: number) => `${no}. / ${total}`,
    allPaid: "Tamamlandı",
    remainingAmount: "Kalan tutar",
    currentMonthLine: (month: string, end: string) => `Bu taksit ${month} ayında; plan ${end} ayında bitiyor.`,
    finishedLine: (end: string) => `Son taksit ${end} ayında ödendi.`,
    othersSection: "Takip Edilenler (Bakiyeye Dahil Değil)",
    watchOnly: "İzleme",
    titleField: "Başlık",
    totalAmount: "Toplam Tutar",
    monthlyAmount: "Aylık Taksit",
    count: "Taksit sayısı",
    startMonth: "İlk Taksit Ayı",
    emptyTitle: "Henüz taksit ya da kredi yok",
    emptyHint: "Taksitli bir harcama veya krediyi ekle; aylara dağılımı otomatik hesaplanır.",
    newTitle: "Yeni Taksit / Kredi",
    editTitle: "Taksiti Düzenle",
    planDetails: "Plan Ayrıntıları",
    planDetailsHint: "Plan türünü, tutarı ve kaç aya yayılacağını belirle.",
    timelineA11y: (count: number, start: string) => `${start} döneminde başlayan ${count} taksitlik ödeme çizelgesi.`,
    timelineMore: (count: number) => `Çizelge ${count} dönem daha devam eder.`,
    scheduleAndAssignment: "Takvim ve Sınıflandırma",
    scheduleAndAssignmentHint: "Başlangıç dönemini, ödeme yöntemini, kişiyi ve Mali Tablo kalemini seç.",
    editHint: "Değişiklikler aylara dağılımı yeniden hesaplar; ödenmiş görünen aylar tarihe göre korunur.",
    historyConflict: "Taksit sayısını daha önce ödenmiş bir taksiti kaldıracak kadar düşüremezsin. Ödenmiş dönemler finansal geçmiş olarak korunur.",
    delete: "Bu planı sil",
    noSource: "Ödeme yöntemi yok",
    deleteBody: (count: number) => `Bu plan ve ona bağlı ${count} taksit kaydı kalıcı olarak silinecek. Geri alınamaz.`,
    nthInstallment: (n: number) => `${n}. taksit`,
    defaultTitle: (amount: string) => `${amount} taksitli harcama`,
    allCards: "Tüm kartlar",
    cardFilter: "Bu ayın kartları",
    addCard: "Yeni kart ekle",
    thisMonthInstallment: (n: number, total: number) => `Bu ay ${n}/${total}. taksit`,
    noneThisMonth: "Bu ay ödenecek taksit yok",
    noneThisMonthHint: "Bu ayda aktif taksit veya kredi taksiti bulunmuyor. Ay/kart seçimini değiştirebilirsin.",
  },
  subs: {
    title: "Abonelikler",
    formIdentity: "Aboneliğin kimliği",
    formSchedule: "Ödeme ritmi",
    formScheduleHint: "Ne zaman tekrar edeceğini ve hangi kaleme bağlanacağını seç.",
    formBehavior: "Takip ve otomasyon",
    formBehaviorHint: "Hatırlatma, otomatik ödeme ve görünürlük davranışını kontrol et.",
    monthlyEquivalent: "Aylık karşılığı",
    annualEquivalent: "Yıllık karşılığı",
    estimatedAmount: "Tahmini tutar",
    estimatedAmountFieldLabel: "Tahmini tutar · istersen boş bırak",
    variableAmount: "Tutar her ay değişir",
    variableAmountHint: "Elektrik, doğalgaz gibi faturalar için. Gerçek tutarı fatura geldiğinde ödeme sırasında girersin.",
    variesEachMonth: "Her ay değişir",
    noEstimateYet: "Henüz tahmin girmedin; ödeme sırasında sorulacak.",
    estimatePerMonth: (amount: string) => `Tahmini ${amount}/ay`,
    variableAmountBadge: "Değişken tutar",
    estimatedBadge: "Tahmini",
    unknownAmount: "Tutar belirtilmedi",
    /* A variable bill is not free, and printing ₺0,00 for one said it was.
       These three read out of `price_history`, which every entered invoice has
       been filling since the table existed and nothing ever read back. */
    expectedBand: (low: string, high: string) => `${low} – ${high} bekleniyor`,
    expectedAround: (amount: string) => `Geçen sefer ${amount}`,
    atLeastAmount: (amount: string) => `En az ${amount}`,
    costUnknownExcluded: (count: number) =>
      count === 1
        ? "Faturası henüz girilmemiş 1 abonelik bu toplama sıfır olarak giriyor."
        : `Faturası henüz girilmemiş ${count} abonelik bu toplama sıfır olarak giriyor.`,
    enterAmount: "Tutarı Gir",
    amountEntryTitle: "Bu ayın gerçek tutarı",
    currentAmount: "Girilen tutar",
    amountEntryHint: "Faturadaki gerçek tutarı gir. Bu tutar yalnızca seçili ayın ödemesine uygulanır.",
    amountEntrySaved: "Gerçek tutar kaydedildi.",
    variableAutoPayHint: "Tutar değişebildiği için otomatik onay kapalı; gerçek tutarı sen girdikten sonra ödeme kaydedilir.",
    previewA11y: (name: string, cycle: string, schedule: string, monthly: string) => `${name}. ${cycle}. ${schedule}. Aylık karşılığı ${monthly}.`,
    nextCharge: "Sıradaki ödeme",
    followingCharge: "Sonraki tekrar",
    scheduleOverview: "Ödeme döngüsü",
    scheduleOverviewHint: "Sıradaki ödemeyi ve hemen arkasındaki planı tek bakışta gör.",
    next31Days: "31 günde ödeme",
    automaticShort: "otomatik",
    todayShort: "Bugün",
    tomorrowShort: "Yarın",
    daysShort: "gün",
    paymentPath: "Sıradaki ödeme durakları",
    noUpcoming: "Önündeki 31 günde ödeme görünmüyor.",
    sameDayPayments: (count: number) => `Aynı gün ${count} ödeme`,
    automaticCount: (count: number) => `${count} otomatik ödeme`,
    manualCount: (count: number) => `${count} elle takip`,
    scheduleOverviewA11y: (active: number, upcoming: number, automatic: number, manual: number) =>
      `${active} aktif abonelik. Önündeki 31 günde ${upcoming} ödeme var. ${automatic} otomatik, ${manual} elle takip ediliyor.`,
    watchedSection: "İzlenen Kişilerin Abonelikleri",
    add: "Abonelik Ekle",
    edit: "Aboneliği Düzenle",
    name: "Ad",
    suggestedCategoryName: "Abonelikler",
    categoryOffer: "Senin için Abonelikler kategorisi oluşturabilirim.",
    categoryOfferAccept: "Oluştur ve Kaydet",
    categoryOfferDecline: "Kategori Seçeceğim",
    cycle: "Ne sıklıkla?", monthly: "Aylık", yearly: "Yıllık", custom: "Özel",
    intervalLabel: "Kaç ayda bir?",
    intervalHint: "Örn. 3 yazarsan üç ayda bir ödenir.",
    billingDay: "Ödeme günü",
    billingDayHint: "Her ödeme ayın bu gününe denk gelir.",
    yearlyRenewalDate: "Sonraki yenileme tarihi",
    yearlyRenewalHint: "Yıllık ücretin bir sonraki kez alınacağı tarihi seç.",
    daySchedule: (day: string) => `${day}. gün`,
    nextDue: (d: string) => `Sonraki: ${d}`,
    lastCharged: (d: string) => `Son ödeme: ${d}`,
    trialEnds: (d: string) => `Deneme bitiyor: ${d}`,
    autoPay: "Otomatik ödeme",
    autoPayHint: "Ödeme günü geldiğinde tutar otomatik ödendi sayılır: bakiyenden düşer ve Mali Tablo'ya işlenir. Yanlışsa tek dokunuşla geri alırsın.",
    trialToggle: "Deneme sürümü",
    trialToggleHint: "Ücretsiz deneme süresindeysen aç; bitiş gününü seç, süresi dolmadan hatırlatalım.",
    trialDate: "Deneme bitiş tarihi",
    priceHistory: "Fiyat Geçmişi",
    costSummary: "Abonelik maliyeti",
    costSummaryHint: "Aktif aboneliklerinin aylık ve yıllık karşılığı, son fiyat değişiklikleriyle birlikte.",
    monthlyCost: "Aylık",
    annualCost: "Yıllık",
    costExcluded: (count: number) =>
      `${count} abonelik farklı para biriminde olduğu için bu toplama katılmadı.`,
    recentPriceChanges: "Son fiyat değişiklikleri",
    noPriceChanges: "Fiyat değişikliği kaydedilmedi.",
    priceRose: "zamlandı",
    priceFell: "ucuzladı",
    priceChangeRow: (name: string, from: string, to: string, direction: string, when: string) =>
      `${name} ${direction}: ${from} yerine ${to}. ${when}.`,
    upcomingRenewal: (name: string, when: string, amount: string) =>
      `Sıradaki yenileme: ${name}, ${when}, ${amount}.`,
    canceled: "İptal edildi",
    perMonth: (v: string) => `${v}/ay`,
    emptyTitle: "Henüz abonelik yok",
    emptyHint: "Netflix'ten elektrik faturasına kadar, düzenli ödemelerini ekle, yaklaşanları Helix hatırlatsın.",
  },
  computed: {
    builderTitle: "Kolon hesabını kur",
    builderHint: "Önce hesap türünü seç; ardından kullanılacak kalemleri ve tabloda göreceğin adı belirle.",
    flowA11y: (count: number, operation: string, result: string) => `${count} girdi, ${operation} işlemi, ${result} önizleme sonucu.`,
    flowInput: "Girdi",
    flowOperation: "Hesap",
    flowResult: "Önizleme",
    stepType: "Hesaplama Türü",
    ops: {
      sum: { title: "Toplam", description: "Seçtiğin kategorileri tek kolonda toplar. Ör. tüm sabit giderler." },
      difference: { title: "Fark", description: "Bir grubun toplamından diğerini çıkarır. Ör. maaştan kirayı düş." },
      income_minus_expense: { title: "Net Akış", description: "Ayın tüm gelirlerinden tüm giderlerini çıkarır." },
      cc_split: { title: "Kart Ayrımı", description: "Kredi kartındaki tek çekim veya taksit toplamını gösterir." },
    },
    pickCategories: "Toplanacak Kategoriler",
    plusGroup: "Eklenecekler",
    minusGroup: "Çıkarılacaklar",
    selectedCount: (count: number) => `${count} seçili`,
    noCategories: "Önce Kalemler ekranından bir gelir veya gider kalemi ekle.",
    installmentPart: "Taksitli",
    nameLabel: "Kolon adı",
    addAction: "Kolonu Ekle",
    saveEdit: "Değişikliği Kaydet",
    editing: (name: string) => `Düzenleniyor: ${name}`,
    cancelEdit: "Vazgeç",
    showInTable: "Tabloda göster",
    existingTitle: "Kolonların",
    emptyTitle: "Henüz hesaplanan kolon yok",
    emptyHint: "Soldan bir hesap türü seç; Helix sonucunu her ay Mali Tablo'da otomatik hesaplasın.",
  },
  budgets: {
    title: "Aylık Harcama Limiti",
    settingsDesc: "Gider kalemlerine aylık sınır koy, kalanını ve aşımı izle.",
    category: "Gider kalemi",
    pickCategory: "Bir gider kalemi seç",
    amount: "Aylık limit",
    add: "Limit Ekle",
    editTitle: "Limiti düzenle",
    formHint: "Bir gider kalemi seçip o ay için ulaşmak istediğin üst sınırı belirle.",
    limitsTitle: "Bu ayın limitleri",
    limitsHint: "Gerçekleşen harcamalar ilerlemeyi; aşılan tutarlar kırmızı durumu gösterir.",
    emptyTitle: "Bu ay için limit yok",
    emptyHint: "Önem verdiğin bir gider kalemini ve ulaşmak istediğin aylık sınırı seç.",
    progress: (spent: string, limit: string) => `${spent} harcandı · ${limit} limit`,
    over: (amount: string) => `Limit ${amount} aşıldı`,
    remaining: (amount: string) => `${amount} kaldı`,
    emptyAnalysisTitle: "Aylık harcama limitini belirle",
    emptyAnalysisHint: "Önemli gider kalemlerinde ne kadar kaldığını Analiz ekranında izle.",
    analysisTitle: (month: string) => `${month} limit durumu`,
  },
  analysis: {
    viewWindow: "Analiz aralığı",
    findTransaction: "İşlem Bul",
    showSearchFilters: "Arama filtreleri",
    hideSearchFilters: "Filtreleri gizle",
    searchSource: "Ödeme yöntemi",
    searchPeriod: "Arama dönemi",
    selectedPeriod: "Seçili dönem",
    selectedPeriodRange: (range: string) => `Arama ${range} aralığında yapılıyor.`,
    allTime: "Tüm zamanlar",
    allTimeHint: "Arama kayıtlarının tamamında yapılıyor; yukarıdaki dönem seçimi bu aramaya uygulanmaz.",
    sortLabel: "Sıralama",
    sortRecent: "Önce en yeni",
    sortOldest: "Önce en eski",
    sortHighest: "Önce en yüksek tutar",
    sortLowest: "Önce en düşük tutar",
    showAllResults: (n: number) => `Tümünü göster (${n})`,
    showFewerResults: "Daha az göster",
    clearSearch: "Aramayı Temizle",
    searchAllTime: "Tüm Zamanlarda Ara",
    openTransaction: "İşlemi düzenlemek için aç",
    title: "Analiz",
    period1m: "1 Ay",
    period3m: "3 Ay",
    period6m: "6 Ay",
    period12m: "12 Ay",
    periodYear: "Yıl",
    periodCustom: "Özel",
    customStart: "Başlangıç ayı",
    customEnd: "Bitiş ayı",
    allCategories: "Tüm Kategoriler",
    searchPlaceholder: "Ara: kategori, tutar, ay ya da yıl…",
    noResults: "Eşleşen işlem yok.",
    chartPie: "Pasta",
    chartBars: "Sütun",
    chartTrend: "Net Trend",
    chartNetTrendTitle: "Aylık net değişim trendi",
    chartTotal: "Toplam",
    chartLargestShare: (label: string, percent: number) => `En büyük pay · ${label} · %${percent}`,
    chartExpenseDist: "Harcama ve yatırım dağılımı",
    chartEmpty: "Henüz veri yok; grafik sıfırdan başlıyor.",
    monthlyFlows: "Aylık gelir, gider ve yatırım",
    trendOf: (c: string, months: number) => `${c} · ${months} ay`,
  },
  settings: {
    title: "Ayarlar",
    balanceSection: "Bakiye",
    workspaceSection: "Çalışma Alanı",
    tools: "Araçlar",
    toolsDestination: "Hızlı Hesaplamalar",
    toolsDesc: "Hesap makinesi ve döviz çevirici.",
    appSection: "Uygulama",
    syncSection: "Cihazlar",
    transferSection: "Verilerini Taşı ve Koru",
    categories: `${productTerms.items} ve ${productTerms.columns}`,
    categoriesDesc: "Mali Tablo'daki gelir-gider kalemlerini ekle, düzenle ve sırala.",
    categoriesEmptyTitle: "Henüz gelir-gider kalemi yok",
    categoriesEmptyHint: "Soldan ilk kalemini ekle veya önerilen kalemlerle çalışma alanını hızlıca kur.",
    reorderHint: "Tutamacı basılı tutup istediğin yere sürükle.",
    reorderHandle: "Sürükleyerek sırala",
    moveUp: "Yukarı taşı",
    moveDown: "Aşağı taşı",
    addSuggested: "Önerilen Kalem Ekle",
    createItemTitle: "Kalem Oluştur",
    createItemHint: "Adını ve türünü belirle; eklediğin kalem sağdaki listede hemen yerini alır.",
    categoryMapA11y: (expense: number, income: number) => `${expense} gider kalemi ve ${income} gelir kalemi Mali Tablo'ya bağlanıyor.`,
    expenseCount: (count: number) => `${count} gider`,
    incomeCountShort: (count: number) => `${count} gelir`,
    computed: `Hesaplanan ${productTerms.columns}`,
    computedDesc: "Seçtiğin kalemleri toplayan ya da farkını alan, kendi hesapladığın kolonlar.",
    persons: "Kişiler",
    personsDesc: "Harcamalarını ayrıca izlediğin kişiler. Senin bakiyeni etkilemezler.",
    sources: productTerms.paymentMethods,
    sourcesDesc: "Kartların, nakdin ve hesapların. İşlemlerini bunlara bağlayabilirsin.",
    opening: productTerms.balanceAdjustment,
    openingDesc: "Uygulamadaki bakiye ile hesabındaki gerçek para tutmuyorsa buradan düzelt. Fark bugüne kaydedilir, geçmiş aylara dokunulmaz.",
    computedBalance: "Hesaplanan bakiye",
    realBalance: "Gerçek güncel bakiyen",
    currentBalanceFormHint: "Bugün hesabında gerçekten bulunan toplamı yaz; Helix yalnızca aradaki farkı kaydeder.",
    balanceMatchesShort: "Bakiye eşleşiyor",
    balanceChangeReady: "Düzeltme hazır",
    balanceDifference: "Kaydedilecek fark",
    balanceDriftShort: "Uyuşmuyor",
    balanceDriftCandidates: "Onaylanmamış kayıtlar",
    balanceDriftCandidatesHint: "Tarihi geçmiş ama hâlâ bekleyen kayıtlar tabloya işlenmez. Bu para gerçekten çıktıysa fark tam da bu kadardır. Kontrol etmek için dokun.",
    balanceDriftTitle: "Söylediğin bakiye ile tablon uyuşmuyor",
    balanceDriftBody: (declared: string, computed: string, at: string) =>
      `${at} tarihinde hesabında ${declared} olduğunu söylemiştin. Tablon şu an ${computed} gösteriyor. Hesabına bakıp aşağıdaki tutarı güncelleyebilir ya da eksik kaydı girebilirsin.`,
    balanceScopeHint: "Helix bakiyeyi ödeme yöntemlerine göre ayrı tutmadığı için bu düzeltme toplam bakiyene uygulanır.",
    balanceAdjustmentNote: (from: string, to: string) => `Bakiye ${from} → ${to} olarak düzeltildi`,
    balanceAdjustmentSaved: "Bakiye güncellendi",
    balanceAdjustmentsTitle: productTerms.balanceAdjustments,
    balanceAdjustmentsHint: "Her düzeltme ayrı bir hareket olarak görünür; gelir-gider istatistiklerine dahil edilmez ve buradan geri alınabilir.",
    noBalanceAdjustments: "Henüz bakiye düzeltmesi yok",
    noBalanceAdjustmentsHint: "Gerçek bakiye ile hesaplanan bakiye ayrıştığında yukarıdaki alan farkı bugüne kaydeder.",
    balanceWillMark: "Bakiyeni düzeltirsen Mali Tablo'da o ayın Güncel Bakiye hücresinde renkli bir nokta belirir; hücreye dokunarak buraya dönebilirsin.",
    balanceAdjustmentFallback: "Bakiye düzeltmesi",
    balanceAdjustmentDeleted: "Bakiye düzeltmesi silindi",
    historyOpeningTitle: "Geçmiş Başlangıç Noktası",
    historyOpeningSummary: "İlk kayıt ayın veya o aya başladığın bakiye yanlışsa buradan düzelt.",
    historyOpeningAction: "Başlangıç Noktasını Düzenle",
    historyOpeningHint: "Bu değişiklik geçmişten bugüne bütün bakiye zincirini yeniden hesaplar. Yalnız ilk kayıt ayın ya da o ayın başlangıç bakiyesi yanlışsa kullan; bugünkü fark için yukarıdaki güncel bakiye alanını kullan.",
    notifications: "Bildirimler",
    notificationsDeviceHint: "Bu cihazda yaklaşan ödemeler için yerel hatırlatmalar gösterilir. İzin yalnızca burada açtığında istenir.",
    notificationsDenied: "Bildirim izni verilmedi. İstersen cihaz ayarlarından Helix bildirimlerine izin verebilirsin.",
    notificationDetails: "Kilit ekranında ayrıntı",
    notificationDetailsHint: "Kapalıyken ad ve tutar gizlenir. Yalnız bu cihazda açıkça izin verirsen ayrıntı gösterilir.",
    notificationDetailsConfirm: "Ödeme adı ve tutarı, telefonun kilitliyken bildirim önizlemesinde görülebilir. Bu cihazda ayrıntıları göstermek istiyor musun?",
    notificationDetailsEnable: "Ayrıntıları Göster",
    notificationPreview: "Telefonun kilit ekranında böyle görünür:",
    notificationSampleName: "Örnek abonelik",
    reminderDays: "Hatırlatma: kaç gün önce",
    // The lock is named after whatever the device in hand actually offers.
    // A single "Face ID" string shipped to Android too, naming a technology
    // that does not exist there — on a security control, of all places.
    biometric: "Biyometrik Kilit",
    biometricFaceId: "Face ID Kilidi",
    biometricTouchId: "Touch ID Kilidi",
    biometricFace: "Yüz Tanıma Kilidi",
    biometricFingerprint: "Parmak İzi Kilidi",
    theme: "Tema", themeSystem: "Sistem", themeLight: "Açık", themeDark: "Koyu",
    palette: "Renk Paleti",
    paletteClay: "Amber",
    paletteOcean: "Petrol",
    paletteForest: "Servi",
    paletteClayDesc: "Sıcak keten, pişmiş toprak ve pirinç.",
    paletteOceanDesc: "Mineral gri, petrol mavisi ve soluk mercan.",
    paletteForestDesc: "Taş nötrleri, koyu servi ve yaban eriği.",
    export: "Yedek Oluştur",
    exportDesc: "Tüm verinin tek dosyalık kopyasını indir. Bir aksilikte ya da başka bir cihazda bununla geri yükleyebilirsin. Belgelerin kaydını taşır, dosyalarının kendisini taşımaz.",
    exportCsv: "İşlemleri CSV'ye Aktar",
    exportCsvDesc: "Tüm hareketlerini Excel ya da Google Sheets'te açılabilecek bir tabloya çıkar.",
    import: "Yedekten Geri Yükle",
    importDesc: "Daha önce oluşturduğun yedek dosyasını yükle, verilerini olduğu gibi geri getir.",
    /* "yazılabilir" — may be overwritten — left the one irreversible step in
       the app ambiguous about what it does. A restore keeps whichever copy of
       a row is newer, which is a rule that can be stated. */
    importConfirm: "Yedekteki her kayıt, bu cihazdaki eşinin üzerine yazılır; yalnızca bu cihazda daha yeni olanlar korunur. Bu işlem geri alınamaz. Devam edilsin mi?",
    importSuccess: (n: number) => `${n} kayıt içe aktarıldı`,
    sync: "Cihazlarını Güncelle",
    syncNow: "Şimdi Güncelle",
    syncState: { idle: "Cihazların güncel", syncing: "Güncelleniyor…", attention: "Bazı kayıtlar yalnız bu cihazda", error: "Güncelleme bekliyor", unconfigured: "Yalnız bu cihaz" },
    lastSync: (d: string) => `Son güncelleme: ${d}`,
    syncUnconfiguredHint: "Bulut senkronu yapılandırılmadı; veriler yalnız bu cihazda.",
    syncExplain: "Değişikliklerin önce bu cihazda saklanır. İnternet geldiğinde diğer cihazlarınla otomatik olarak güncellenir.",
    // The settings row. One quiet line, not a warning panel: nothing is lost,
    // nothing is urgent, and the detail belongs on its own screen.
    syncQuarantineRow: "Bu cihazda kalan kayıtlar",
    syncQuarantineRowHint: (count: number) =>
      `${count} kayıt buluta gönderilemedi. Hepsi cihazında duruyor.`,
    syncQuarantineCount: (count: number) => `${count} kayıt`,
    syncQuarantineTitle: "Bu cihazda kalan kayıtlar",
    syncQuarantineIntro: "Bu kayıtlar cihazında duruyor ve silinmedi. Bulut bunları kabul etmediği için burada bekliyorlar; uygulamanın geri kalanı normal çalışmaya devam eder.",
    syncQuarantineRetry: "Tekrar Dene",
    syncQuarantineBackup: "Yedek Al",
    syncQuarantineDismiss: "Listeden Kaldır",
    syncQuarantineDismissed: "Kayıt listeden kaldırıldı. Verin cihazında duruyor.",
    syncQuarantineDismissConfirm: "Bu satır listeden kaldırılacak. Kaydın kendisi cihazında kalmaya devam eder ve silinmez.",
    syncQuarantineRetryDone: (count: number) => `${count} kayıt yeniden sıraya alındı.`,
    syncQuarantineRetryNone: "Bu kayıtların hiçbiri şu an gönderilemiyor. Aşağıdaki açıklamalar ne yapılabileceğini söylüyor.",
    syncQuarantineType: (table: string) => `${table} kaydı`,
    syncQuarantineReason: {
      malformed_payload: "bozuk veri",
      wrong_user: "hesap eşleşmiyor",
      invalid_row: "geçersiz veri",
    },
    // What the LAST retry learned about this row, said as a next step rather
    // than as a status. "Yeniden dene" that can only fail is the thing the
    // owner reported; each of these names something that would actually help.
    syncQuarantineOutcome: {
      requeued: "Sıraya alındı; bir sonraki eşitlemede gönderilecek.",
      unrepairable: "Kaydın kendisinde bir sorun var. Uygulamada açıp kaydedersen düzelmiş hâli yeniden denenir.",
      missing: "Bu kaydın cihazında bir karşılığı kalmamış. Gönderilecek bir şey yok; satırı listeden kaldırabilirsin.",
      unsupported: "Bu kayıt türünü bu sürüm tanımıyor. Güncelleme sonrası tekrar denenebilir.",
    },
    syncQuarantineUntried: "Henüz denenmedi.",
    syncQuarantineEmpty: "Bekleyen kayıt kalmadı.",
    /* Said "Her şey buluta gönderildi" unconditionally, including on a
       device where Settings was simultaneously saying no cloud is configured.
       The caller now picks by actual sync state. */
    syncQuarantineEmptyHint: "Bekleyen her kayıt buluta gönderildi.",
    syncQuarantineEmptyLocal: "Bulut senkronu kapalı; kayıtların yalnızca bu cihazda tutuluyor.",
    syncQuarantineTypes,
    /** What a quarantined row is called when `syncQuarantineTypes` has no
     *  entry for it — a dead letter can name a table a newer build added. */
    syncQuarantineTypeFallback: "kayıt",
    columnVisible: "Mali Tablo'da göster",
    deleteCategoryTitle: "Kalemi sil",
    deleteCategoryBody: (count: number) =>
      count > 0
        ? `Bu kaleme bağlı ${count} kayıt var. Kalemi silersen bu kayıtlar silinmez; “Kategorisiz” olarak Mali Tablo'da görünmeye devam eder ve bakiyeni etkiler.`
        : "Bu kalemde kayıt yok. Kalem ve varsa bütçe hedefleri silinecek.",
    deleteCategorySheetTitle: (name: string) => `“${name}” kalemini sil`,
    deleteCategoryUsageIntro: (total: number, breakdown: string) =>
      `Bu kaleme bağlı ${total} kayıt var (${breakdown}). Hiçbiri silinmeyecek — nereye taşınacağını seç.`,
    deleteCategoryUsageTransactions: (n: number) => `${n} işlem`,
    deleteCategoryUsageSubscriptions: (n: number) => `${n} abonelik`,
    deleteCategoryUsageIncomes: (n: number) => `${n} gelir kuralı`,
    deleteCategoryUsagePlans: (n: number) => `${n} taksit planı`,
    deleteCategoryUsageNotes: (n: number) => `${n} ay notu`,
    deleteCategoryTargetLabel: "Kayıtlar nereye gitsin?",
    deleteCategoryUncategorized: "Kategorisiz bırak",
    deleteCategoryUncategorizedHint: "İşlemler Mali Tablo'da “Kategorisiz” altında toplanır; ay notları kalemle birlikte kaldırılır.",
    deleteCategoryMergeHint: "Kayıtlar bu kalemin altına taşınır.",
    deleteCategoryRulesBlock: "Bu kaleme bağlı abonelik veya gelir kuralı var; bir kuralın kalemsiz kalması ödemelerini bozar. Kategorisiz bırakmak yerine uyumlu bir kalem seç.",
    deleteCategoryNoTarget: "Aynı türde başka bir kalem yok. Önce uyumlu bir kalem oluştur, sonra bu kalemi silebilirsin.",
    showPending: "İleri tarihli işlemler Mali Tablo'da görünsün",
    showPendingHint: "Kapatırsan gelecek tarihli kayıtlar hücrelerde gizlenir; bakiye zaten günü gelince etkilenir.",
    kindExpense: "Gider", kindIncome: "Gelir",
    investmentCategory: "Yatırım kategorisi",
    investmentCategoryDesc: "Bu kalemdeki tutarlar harcama değil, yatırıma aktarılan para sayılır.",
    addCategory: "Kategori adı",
    incomeRules: productTerms.recurringIncomes,
    incomeRulesDesc: "Maaş, kira gibi her ay tekrar eden gelirleri bir kez tanımla.",
    addIncomeRule: "Gelir Kuralı Ekle",
    payDay: "Ödeme günü",
    defaultAmount: "Varsayılan tutar",
  },
  investments: {
    title: "Yatırımlar",
    setupTitle: "Yatırım alanını başlat",
    setupBody: "Bugün serbest duran yatırım nakdini yaz. Eski Mali Tablo hareketleri burada yeniden sayılmaz.",
    openingCash: "Bugünkü serbest yatırım bakiyesi",
    startedOn: "Cüzdan başlangıç tarihi",
    setupAction: "Yatırım Alanını Aç",
    setupWithExistingHint: "Zaten sahip olduğun bir yatırımı sonradan eklersen serbest bakiyenden düşmez; yalnız yeni alışlar düşer.",
    setupDetails: "Başlangıç bilgileri",
    setupDetailsHint: "Bugün elinde kullanıma hazır olan yatırım nakdini tanımla.",
    cash: "Serbest bakiye",
    readyToInvest: "Yeni işlemler için kullanıma hazır",
    portfolioTotal: "Cüzdan toplamı",
    investedCost: "Yatırılmış maliyet",
    activeProducts: "Aktif ürünler",
    productFilter: "Ürün türü",
    realizedResult: "Gerçekleşen sonuç",
    distribution: "Maliyet dağılımı",
    noProducts: "Henüz yatırım ürünü yok",
    noProductsHint: "Önce ürününü tanımla; ardından mevcut yatırımını veya yeni alışını ekle.",
    noFilteredProducts: "Bu türde ürün yok",
    noFilteredProductsHint: "Başka bir ürün türü seçerek portföyünü görmeye devam edebilirsin.",
    // The two used to read as the same offer. "Ürün Ekle" only defines the
    // instrument — Gram Altın, a fund, a currency — and touches no money;
    // "Mevcut Yatırım Ekle" records a holding you already own without spending
    // free balance. The captions name the difference instead of leaving the
    // user to discover it after tapping.
    addProduct: "Yeni Ürün Tanımla",
    addProductCaption: "Para hareketi yok",
    saveProduct: "Ürünü Kaydet",
    sell: "Satış Yap",
    sellCaption: "Bakiyene döner",
    addExisting: "Sahip Olduğumu Ekle",
    addExistingCaption: "Bakiyeden düşmez",
    refundCaption: "Mali tabloya çıkar",
    refund: "Boş Bakiyeyi Mali Tabloya Aktar",
    refundShort: "Serbest Bakiyeyi Aktar",
    refundTitle: "Serbest Bakiyeyi Aktar",
    refundAmountTitle: "Aktarılacak bakiye",
    refundAmountHint: "Bakiyenin tamamını veya yalnızca ihtiyacın olan kısmını seç.",
    refundAll: "Bakiyenin tamamı",
    refundPartial: "Bir kısmı",
    refundPartialAmount: "Aktarılacak tutar",
    refundDestinationTitle: "Mali Tablo kaydı",
    refundDestinationHint: "Tutarın görüneceği kalemi ve zamanı seç.",
    refundAction: "Mali Tabloya Aktar",
    refundExceedsCash: (cash: string) => `En fazla ${cash} aktarabilirsin.`,
    addOperation: "İşlem Ekle",
    product: "Ürün",
    movement: "Hareket",
    productName: "Ürün adı",
    productType: "Yatırım türü",
    marketProduct: "Piyasa ürünü",
    productNote: "Ürün notu",
    operationTitle: {
      existing: "Mevcut yatırımı ekle",
      buy: "Alış ekle",
      sell: "Satış yap",
      contribution: "BES katkısı ekle",
    },
    editOperation: "Yatırım hareketini düzenle",
    operationHint: {
      existing: "Bugün zaten sahip olduğun ürünü kaydet; serbest bakiyeden para düşmez.",
      buy: "Toplam alış tutarı serbest yatırım bakiyenden düşer.",
      sell: "Satış tutarı serbest bakiyeye döner; maliyet ve gerçekleşen sonuç otomatik hesaplanır.",
      contribution: "Katkı serbest bakiyeden düşer. Pay bilgisi yoksa yalnızca toplam tutar yeterli.",
    },
    quantity: "Miktar / adet",
    unitPrice: "Birim fiyat",
    operationDate: "İşlem tarihi",
    contributionWithUnits: "Pay bilgisi var",
    contributionAmountOnly: "Yalnız katkı tutarı",
    requiredQuantity: "Miktar / adet · zorunlu",
    requiredUnitPrice: "Birim fiyat · zorunlu",
    optionalTotal: "Toplam TRY · isteğe bağlı",
    requiredTotal: "Toplam katkı · zorunlu",
    operationImpact: {
      existing: "Yalnız portföye eklenir",
      buy: "Serbest bakiyeden düşer",
      sell: "Serbest bakiyeye eklenir",
      contribution: "Serbest bakiyeden düşer",
    },
    operationImpactLabel: "Bakiye etkisi",
    availableQuantityShort: (quantity: string) => `Eldeki: ${quantity}`,
    availableQuantity: "Eldeki miktar",
    calculationSummary: "İşlem özeti",
    calculatedTotal: "Hesaplanan toplam",
    oversoldWithHolding: (quantity: string) => `Bu satış elindeki ${quantity} miktarı aşıyor.`,
    operationDeleted: "Yatırım hareketi silindi",
    deleteOperation: "Hareketi Sil",
    deleteOperationBody: "Bu hareket kaldırıldığında cüzdan ve maliyetler yeniden hesaplanır.",
    removeProductHistory: "Yatırım Ürününü Kaldır",
    removeProductHistoryTitle: "Yatırım Ürününü Kaldır",
    removeProductHistoryLead: (name: string) => `${name} ürününü, tüm yatırım hareketlerini ve seçtiğin Mali Tablo aktarımlarını kaldır.`,
    removeProductHistorySummary: (count: number) => `${count} yatırım hareketi kaldırılacak.`,
    removeProductHistoryHint: "Bu ürün yanlış eklendiyse, ürün ve ona bağlı tüm hareketleri kaldırabilirsin.",
    removeProductHistoryBody: (name: string, operations: number, transfers: number) =>
      `${name} için ${operations} yatırım hareketi${transfers > 0 ? ` ve seçtiğin ${transfers} Mali Tablo aktarımı` : ""} kaldırılacak. Seçmediğin Mali Tablo kayıtları yerinde kalır.`,
    removeProductHistoryAction: "Ürünü Tamamen Kaldır",
    correctionTransfers: "Mali Tablo aktarımları",
    correctionTransfersHint: "Yalnız bu yanlış yatırımı boşaltmak için oluşturduğun aktarımı seç. Helix tahmin ederek başka bir Mali Tablo kaydını silmez.",
    correctionNoTransfers: "Seçilecek Mali Tablo aktarımı yok",
    correctionNoTransfersHint: "Bu ürünün satışı sonrası yatırım bakiyesini Mali Tablo'ya aktarmadıysan doğrudan geçmişi kaldırabilirsin.",
    correctionTransferLabel: (date: string, category: string) => `${date} · ${category}`,
    correctionTransferAmount: (amount: string) => `Mali Tablo'ya aktarılan ${amount}`,
    correctionNeedsTransfer: "Bu geçmiş silinince yatırım bakiyesi eksiye düşüyor. Bu yanlış yatırımın satışından sonra Mali Tablo'ya aktardığın kaydı seçerek birlikte kaldır.",
    correctionInvalidSelection: "Yalnızca kendi hesabındaki, yatırım bakiyesinden Mali Tablo'ya yapılmış canlı aktarımlar seçilebilir.",
    history: "Yatırım hareketleri",
    insufficientCash: "Serbest yatırım bakiyesi bu işlem için yeterli değil.",
    oversold: "Satış miktarı elindeki miktarı aşıyor.",
    unknownQuantity: "Bu ürünün pay miktarı bilinmediği için miktarlı satış yapılamaz.",
    inconsistentQuote: "Miktar, birim fiyat ve toplam tutar birbiriyle uyuşmuyor.",
    incompleteQuote: "Miktar, birim fiyat ve toplamdan en az ikisini doldur.",
    invalidQuantity: "Geçerli, pozitif bir miktar yaz.",
    invalidAmount: "Geçerli, pozitif bir tutar yaz.",
    invalidDate: "İşlem tarihi geçerli olmalı ve bugünden ileri olamaz.",
    invalidOperation: "Bu hareket seçtiğin yatırım türü için uygun değil.",
    types: {
      metal: "Kıymetli Maden",
      currency: "Döviz",
      equity: "Borsa",
      fund: "Fon",
      crypto: "Kripto",
      pension: "BES",
    },
    quantityUnknown: "Pay bilgisi yok",
    quantityHeld: (amount: string) => `${amount} adet`,
    averageCost: "Ort. maliyet",
    totalCost: "Toplam maliyet",
    realizedProfit: "Gerçekleşen kâr",
    realizedLoss: "Gerçekleşen zarar",
    transferredIn: "Yatırıma aktarılan",
    transferredOut: "Yatırımdan çekilen",
  },
  template: {
    title: "Önerilen Kalemler",
    toAddTitle: "Eklenebilecek kalemler",
    toAddHint: "Kullanmak istediklerini seç; mevcut kalemlerin değişmez.",
    haveTitle: "Zaten sende olanlar",
    haveHint: "Bunlar çalışma alanında hazır olduğu için yeniden eklenmez.",
    allPresent: "Şablondaki her kalem zaten sende. Dilersen Kalemler ekranından düzenleyebilirsin.",
    nonePresent: "Önerilen kalemlerden henüz eklenmiş olan yok.",
    addSelected: (n: number) => (n === 1 ? "1 kalemi ekle" : `${n} kalemi ekle`),
    categoryNames: {
      creditCard: "Kredi Kartı",
      bills: "Faturalar",
      groceries: "Market",
      carFuel: "Araç & Yakıt",
      rent: "Kira",
      transport: "Ulaşım",
      health: "Sağlık",
      entertainment: "Eğlence",
      extraExpenses: "Ek Giderler",
      salary: "Maaş",
      extraIncome: "Ek Gelirler",
      mortgage: "Ev Kredisi",
      carLoan: "Araç Kredisi",
      investment: "Yatırım",
      subscriptions: "Abonelikler",
      clothing: "Giyim",
      education: "Eğitim",
      rentalIncome: "Kira Geliri",
    },
  },
  persons: {
    selfBadge: "Bu hesap",
    overviewTitle: "Kimin akışını izliyorsun?",
    overviewHint: "Merkezdeki hesap bakiyeyi oluşturur; çevresindekiler yalnızca takip edilir.",
    overviewA11y: (total: number, watched: number) => `${total} kişi. Bu hesap merkezde, ${watched} kişi yalnızca takip ediliyor.`,
    totalCount: (count: number) => `${count} kişi`,
    watchedCount: (count: number) => `${count} takip edilen`,
    addTitle: "Takibe kişi ekle",
    addHint: "Ayrı görmek istediğin kişinin adını ekle; bu kayıt senin toplam bakiyene katılmaz.",
    listTitle: "Çalışma alanındaki kişiler",
    listHint: "Bu hesap bakiyeyi oluşturur; takip edilen kişiler yalnızca kendi hareketleriyle görünür.",
    ownerHint: "Bu hesabın sahibi · bakiyeye dahil",
    watchedHint: "Yalnızca takip · bakiyeye dahil değil",
    soloOverview: "Şimdilik yalnızca kendi hesabını izliyorsun.",
    soloAssignmentHint: "Sana ait · Başka kişileri Ayarlar’dan izleyebilirsin.",
  },
  references: {
    personInUse: (name: string) => `${name} hâlâ kullanılan kayıtlara bağlı`,
    sourceInUse: (name: string) => `${name} hâlâ kullanılan kayıtlara bağlı`,
    resolveBeforeDelete: "Veri kaybını önlemek için doğrudan silemezsin. Bağlı kayıtları aşağıda görüp başka bir kayda aktarabilirsin.",
    paymentSources: "Ödeme yöntemleri",
    installmentPlans: "Taksit ve kredi planları",
    transactions: "İşlemler",
    subscriptions: "Abonelikler",
    recurringIncomes: "Düzenli gelirler",
    choosePerson: "Bağlı kayıtların yeni kişisi",
    chooseSource: "Bağlı kayıtların yeni ödeme yöntemi",
    cardReplacementRequired: "Bağlı taksit planlarını korumak için ekstre tarihleri tamamlanmış başka bir kredi kartı seçmelisin. Uygun kart yoksa önce bu ekrandan yeni kart ekle.",
    noSource: "Ödeme yöntemi olmadan devam et",
    reassignAndDelete: "Aktar ve Sil",
    deleteUnusedPerson: "Bu kişiye bağlı canlı kayıt yok. Kişiyi silmek istiyor musun?",
    deleteUnusedSource: "Bu ödeme yöntemine bağlı canlı kayıt yok. Ödeme yöntemini silmek istiyor musun?",
    reassignPersonConfirm: (count: number, target: string) => `${count} bağlı kayıt ${target} kişisine aktarılacak ve eski kişi silinecek. Bu işlem geçmiş kayıtların sahipliğini de değiştirir.`,
    reassignSourceConfirm: (count: number, target: string) => `${count} bağlı kayıt “${target}” seçeneğine aktarılacak ve eski ödeme yöntemi silinecek.`,
  },
  importer: {
    title: "Excel / CSV İçe Aktar",
    heroTitle: "Dosyadan Mali Tablo'ya",
    heroReady: (sheets: number) => `${sheets} sayfa okundu; şimdi neyin geleceğini kontrol et.`,
    stepFile: "Dosya",
    stepReview: "Kontrol",
    stepImport: "Aktar",
    intro: "Yıllardır tuttuğun bütçe tablosunu olduğu gibi buraya taşıyabilirsin. Dosyanı seçtiğinde ayları ve kalemleri kendimiz tanır, Mali Tablo'na yerleştiririz. Her yıl kendi kolonlarıyla ayrı durur, hiçbir şeyi kaybetmezsin.",
    pick: "Dosyayı Seç",
    pickAgain: "Başka Dosya Seç",
    parseError: "Bu tabloyu okuyamadık. Aylar (ör. Ocak 2025) ilk satırda ya da ilk sütunda olursa tanıyabiliyoruz.",
    batchUnreadable: (years: string) =>
      `${years} yılı için önceki içe aktarma kaydı okunamadı, bu yüzden "değiştir" güvenli değil. Önce o yılın satırlarını elle temizleyip yeniden dene.`,
    fileTooLarge: "Bu dosya güvenli içe aktarma sınırını aşıyor (en fazla 15 MB).",
    missingSelf: "Hesabındaki “Ben” kişisini bulamadık. Verileri yenileyip yeniden dene.",
    diagram: { rent: "Kira", salary: "Maaş", january: "Oca", february: "Şub" },
    workbookTooComplex: "Bu tablo güvenli işlem sınırını aşıyor. Daha küçük yıllık dosyalara bölüp yeniden deneyebilirsin.",
    reasonTooSmall: "Sayfa boş görünüyor ya da tanımaya yetecek kadar veri yok.",
    reasonNoMonths: "Ay adlarını bulamadık. Bir satır ya da sütun Ocak 2025 gibi aylardan oluşmalı.",
    reasonNoColumns: "Ayların yanında kalem başlıklarını (Kira, Maaş gibi) göremedik.",
    reasonInvestmentSheet: "Yatırım sayfası gelir-gider olarak alınmaz; yatırımlar ayrı yönetilecek.",
    // format guide
    guideTitle: "Nasıl bir tablo işe yarar?",
    guideLead: "İki türlü de olur: ayları ister yana ister alta diz, ikisini de anlıyoruz. Bir eksende aylar, diğerinde kalemlerin; kesişen her kutu o ayki tutar.",
    layoutVertical: "Aylar ilk sütunda, kalemler üstte",
    layoutHorizontal: "Aylar üst satırda, kalemler solda",
    examplesTitle: "Tanıdığımız yazımlar",
    exMonthsLabel: "Aylar",
    exMonths: "Ocak 2025 · Oca 25 · 2025-01 · 01.2025",
    exAmountsLabel: "Tutarlar",
    exAmounts: "1.250,50 · 1250 · 12.000",
    exFormulaLabel: "Toplamlar",
    exFormula: "=500+300+700 (üç ayrı kalem olarak gelir)",
    autoTitle: "Senin için hallettiklerimiz",
    auto1: "Bakiye ve 'eldeki para' gibi kolonları geçiyoruz; bakiyeyi Helix zaten hesaplıyor, açılış tutarını da tablondan alıp kuruyoruz.",
    auto2: "Bir hücrede toplam yazmışsan kalemleri tek tek ayırıyoruz; o hücreye düştüğün notu da yanında saklıyoruz.",
    auto3: "Her yılı kendi kolonlarıyla tutuyoruz. 2025'te olan bir kalem 2026'da yoksa, 2026'da onu görmezsin.",
    errorTitle: "Bu dosyayı okuyamadık",
    // preview + selection
    yearSelectTitle: "Hangi yılları getirelim?",
    yearChip: (year: number, months: number) => `${year} · ${months} ay`,
    unparsedNote: (names: string) => `Şu sayfalarda tablo bulamadık, atladık: ${names}.`,
    columnsTitle: "Gelecek kalemler",
    openingTitle: "Başlangıç bakiyesi",
    openingHint: "Mali tablonun tamamı bu tek tutardan zincirlenir. Dosyandaki en erken ayın “ay başında eldeki para” hücresinden okundu.",
    openingEarlier: "Bu ay şu anki başlangıcından daha erken, o yüzden başlangıç buraya alınacak.",
    openingAdopt: "Başlangıç bakiyesini bu dosyadan güncelle",
    openingAdoptHint: (month: string) =>
      `Kapalı bırakırsan ${month} ayındaki mevcut başlangıcın korunur. Bakiyen tutmuyorsa ve dosyandaki tutar doğruysa aç.`,
    balanceColumnsNote: (labels: string) =>
      `Σ ile işaretli kolonlar bakiye ya da toplam sayıldı ve kapalı geldi: ${labels}. Toplam kolonunu aktarmak o ayı iki kez sayar. Biri aslında bir gelir ya da gider kalemiyse buradan açabilirsin.`,
    columnsLead: "İstemediğin bir kalem varsa dokunup çıkarabilirsin.",
    cardCyclesTitle: "Kredi Kartı Ekstre Tarihleri",
    cardCyclesHint: "Taksitleri doğru ekstre ve son ödeme dönemine yerleştirebilmemiz için dosyada bulunan her kartın iki gününü de belirt.",
    breakdownHint: "Yanında • olan hücreler ayrı kalemlere bölündü ya da bir not taşıyor.",
    detected: (m: number, c: number) => `${c} kalem, ${m} ay hazır.`,
    skipped: (cols: string) => `Şu bakiye kolonlarını geçtik: ${cols}.`,
    confirm: "İçe Aktar",
    reimportPrompt: (years: string) => `${years} için zaten kayıt var. O yılların eski aktarımını değiştirelim mi, yoksa üstüne mi ekleyelim?`,
    reimportReplace: "Değiştir",
    reimportAdd: "Üstüne Ekle",
    doneTitle: (n: number) => `${n} kayıt geldi`,
    doneHint: "Toplamlar tek tek ayrıldı, notların yerine yerleşti. Mali Tablo'da bir kutuya dokunarak hepsini görebilirsin.",
    settingsDesc: "Excel ya da CSV bütçe tablonu, tüm yıllarıyla içeri al.",
  },
  calc: {
    title: "Hesap Makinesi",
    useResult: "Sonucu Kullan",
    converterTitle: "Döviz Çevirici",
    convertFrom: "Çevrilecek tutar",
    convertTo: "Şu para birimine",
    swap: "Para birimlerini değiştir",
    enterAmount: "Çevirmek için bir tutar gir.",
    rateMissing: "Kur bilgisi henüz alınamadı. İnternete bağlanınca güncellenir.",
    staleRateDated: (d: string) => `${d} tarihli kur kullanılıyor; bağlantı gelince güncellenecek.`,
    lastLiveRate: (t: string) => `Son canlı kur · ${t}`,
    error: "Hata",
    resultUnavailable: "Sonuç desteklenen tutar sınırını aşıyor",
  },
  tour: {
    s1Title: "Durum",
    s1Body: "Açılış ekranın: güncel bakiyen, ay sonunda nereye varacağının öngörüsü ve yaklaşan ödemeler bir arada. Canlı altın ve döviz fiyatları da burada. Yeni bir harcama veya gelir eklemek için İşlem Ekle yeterli.",
    s2Title: "İşlem Eklemek",
    s2Body: "Tutarı yaz, kategori seç, gün seç, bitti. Tarihi ileriye alırsan işlem o gün gelince bakiyene yansır. Taksitli bir harcamayı bir kez girersin, Helix aylara böler. Yanına küçük hesap makinesiyle tutarı hesaplayabilirsin.",
    s3Title: "Mali Tablo",
    s3Body: "Tüm yılın tek tabloda: satırlar aylar, sütunlar kalemlerin. İçindeki bir kutucuğa dokun; o kalemin o aydaki hareketlerini görür, not düşer ya da hızlıca birden fazla tutarı tek seferde girersin. Tabloyu dik/yatay çevirebilir, bir kolonu sabitleyip yanındakilerle karşılaştırabilir, kolonlarını kendin belirleyebilirsin. Bir hücreyi, satırı ya da ayı basılı tutarsan işaretleyebilirsin: doğruladığın, kontrol etmen gereken ya da hatalı gördüğün yerler tabloda ayrışır.",
    s4Title: "Abonelikler ve Taksitler",
    s4Body: "Netflix'ten elektrik faturasına, ev kredisinden telefon taksidine tüm düzenli ödemelerini ekle. Vadesi gelince Helix hatırlatır; tek dokunuşla ödendi işaretlersin. Otomatik ödeme açıksa bunu senin yerine yapar.",
    s5Title: "Maaş ve Düzenli Gelirler",
    s5Body: "Maaş, kira geliri gibi her ay tekrar eden gelirlerini bir kez tanımla. Ödeme günü geldiğinde 'geldi mi?' diye sorar; onayladığında, çoğu ay değişebilen gerçek tutarıyla bakiyene ekler.",
    // Yatırımlar shipped after this tour was written, so the app was
    // explaining five of its six tabs. It is the sixth slide because it comes
    // after the ledger it feeds, and before the sync slide that closes the tour.
    s6Title: "Yatırımlar",
    s6Body: "Altın, döviz, fon, hisse ve BES'i tek yerde topla. Önce ürününü tanımlarsın — bu adımda para hareket etmez. Zaten sahip olduğun bir yatırımı eklersen serbest bakiyenden düşmez; alış yaparsan düşer, satarsan geri döner. Ortalama maliyetini ve gerçekleşen kârını Helix hesaplar; serbest bakiyeni istediğinde Mali Tablo'ya aktarırsın.",
    s7Title: "Her Cihazda, Çevrimdışı da",
    /* The slide that promises "it syncs" is where the shape of that promise
       belongs. Documents follow the ledger now (spec 3.1c), but the backup
       file still carries only their record — someone who reads this slide and
       then relies on a backup to move devices would find the receipts gone. */
    s7Body: "Her şey önce cihazına kaydedilir; internet olmasa da çalışır. Aynı hesapla girdiğin telefon ve bilgisayarında otomatik senkronlanır. İşlemlere eklediğin fiş ve faturalar da eşitlenir; onları da her cihazından açabilirsin. Yalnız yedek dosyası belgelerin kaydını taşır, içeriğini taşımaz. Eski Excel'ini içe aktarabilir, verini istediğinde yedekleyebilirsin. Bakiyen hesabınla tutmuyorsa Bakiye Düzeltme ile tek adımda eşitlersin.",
    next: "Devam",
    start: "Başlayalım",
    skip: "Geç",
    replay: "Tanıtım Turu",
    replayDesc: "Uygulamanın kısa turunu tekrar izle",
  },
  markets: {
    title: "Canlı Piyasalar",
    live: "Canlı",
    gram: "Gram Altın",
    quarter: "Çeyrek Altın",
    full: "Tam Altın",
    republic: "Cumhuriyet Altını",
    half: "Yarım Altın",
    resat: "Reşat Altını",
    silver: "Gümüş",
    copper: "Bakır",
    otherMetal: "Diğer kıymetli maden",
    otherCurrency: "Diğer döviz",
    addOtherMetal: "Diğer kıymetli maden ekle",
    addOtherCurrency: "Diğer döviz ekle",
    usd: "Dolar",
    eur: "Euro",
    buy: "Alış",
    sell: "Satış",
    quote: (label: string, buy: string, sell: string, direction: string) =>
      `${label}. Alış ${buy}. Satış ${sell}. ${direction}`,
    rising: "Yükseliyor",
    falling: "Düşüyor",
    unchanged: "Değişim yok",
    openDetail: (label: string) => `${label} geçmişini aç`,
    unknownInstrument: "Bu kalem artık takip edilmiyor.",
    range: { day: "1G", week: "1H", month: "1A", year: "1Y" },
    rangeChange: (range: string) => `${range} değişimi`,
    historyLoading: "Geçmiş yükleniyor",
    historyUnavailable: "Geçmiş veriye şu an ulaşılamıyor.",
    sourceNote: "Fiyatlar halka açık borsa emir defterlerinden anlık olarak alınır.",
    rangeLow: "En düşük",
    rangeHigh: "En yüksek",
    updatedAt: (t: string) => `Son güncelleme: ${t}`,
    connecting: "Bağlanıyor…",
    offline: "Çevrimdışı",
    offlineHint: "Canlı bağlantı şu an kurulamıyor; internet gelince fiyatlar otomatik güncellenir.",
    noData: "Henüz fiyat alınamadı. Bağlantı kurulduğunda canlı altın ve döviz fiyatları burada görünecek.",
    /* The card sat empty for the height of the dense list beside it with
       nothing a person could do. The socket does retry on its own, but after a
       long offline stretch the next attempt can be a minute away and the card
       never said so. */
    retryNow: "Yeniden Dene",
    autoRetry: "Bağlantı kendiliğinden yeniden denenir.",
    referenceRate: (d: string) => `Referans kur · ${d}`,
  },
  dataState: {
    loading: "Cihazındaki veriler hazırlanıyor…",
    stale: "Son kayıtlı veriler gösteriliyor; güncelleme şu an tamamlanamadı.",
    error: "Cihazındaki finans verileri şu an okunamadı. Boş sonuç göstermek yerine verileri koruduk.",
  },
  selection: {
    searchLabel: "Seçeneklerde ara",
    searchPlaceholder: "Ad yazarak ara",
    noResults: "Aramana uyan seçenek yok.",
    empty: "Seçilebilecek seçenek yok.",
    loading: "Seçenekler hazırlanıyor",
    error: "Seçenekler yüklenemedi. Tekrar dene.",
  },
  operation: {
    signingIn: "E-posta ve şifren doğrulanıyor",
    creatingAccount: "Helix hesabın oluşturuluyor",
    requestingReset: "Güvenli şifre bağlantın hazırlanıyor",
    // Every lifecycle wait names the operation it is: they all end the
    // session on the same blank screen, so a shared caption made signing out,
    // freezing and deleting indistinguishable at the one moment the user most
    // wants to know which one is running.
    initializeTitle: "Çalışma alanın hazırlanıyor",
    restoreTitle: "Verilerin getiriliyor",
    localSigningOutTitle: "Cihazdan çıkılıyor",
    freezingTitle: "Hesap donduruluyor",
    reactivateTitle: "Hesap yeniden açılıyor",
    signingOutTitle: "Güvenli çıkış",
    signingOut: "Son değişikliklerin bulutla eşitleniyor; ardından oturumun kapanacak",
    localSigningOut: "Bu cihazdaki çalışma alanı kaldırılıyor",
    deletingAccountTitle: "Hesap siliniyor",
    deletingAccount: "Hesabın, mali tablon ve ayarların kalıcı olarak kaldırılıyor",
    freezePhase: {
      marking: "Hesabın dondurma için kilitleniyor",
      syncing: "Son değişikliklerin güvenle korunuyor",
      "signing-out": "Korunan hesap bu cihazda kapatılıyor",
      "rolling-back": "Dondurma geri alınıyor; hesabın açık kalacak",
      complete: "Hesap donduruldu",
    },
    progress: (completed: number, total: number) => `${completed}/${total} tamamlandı`,
    dataSafe: "Verilerin güvende; tamamlanmamış değişiklikler kaydedilmedi.",
    importing: "Kayıtlar içe aktarılıyor",
    saving: "Kayıtlar güvenle yazılıyor",
  },
  sources: {
    formTitle: "Yöntem bilgileri",
    formHint: "Adını, türünü ve gerekiyorsa kredi kartı ekstre döngüsünü tamamla.",
    listTitle: "Kayıtlı ödeme yöntemleri",
    listHint: "İşlemlerde seçebildiğin kart, hesap, nakit ve otomatik talimatlar.",
    editTitle: "Ödeme yöntemini düzenle",
    editHint: (name: string) => `${name} için tür, sahip ve ödeme döngüsünü güncelle.`,
    emptyTitle: "Henüz ödeme yöntemi yok",
    emptyHint: "Yukarıdan kart, nakit, hesap veya dijital cüzdan eklediğinde işlemlerde seçebilirsin.",
    credit_card: "Kredi Kartı",
    debit_card: "Banka Kartı",
    virtual_card: "Sanal Kart",
    e_wallet: "Dijital Cüzdan",
    cash: "Nakit",
    direct_debit: "Otomatik Talimat",
    bank_transfer: "EFT / Havale",
    dueDay: "Son ödeme günü",
    statementDay: "Ekstre kesim günü",
    dueDayShort: "Son ödeme",
    statementDayShort: "Kesim",
    cycleRequired: "Kredi kartı için ekstre kesim ve son ödeme günlerini 1–31 arasında girmelisin.",
    cycleSameDay: "Kesim ve son ödeme aynı gün olamaz.",
    /* The rule, in the terms the card itself uses. It says the direction as
       well as the bound, because "kesimden önce" is the mistake people make
       and the picker refuses it without a reason otherwise. */
    cycleGraceInvalid: (max: number) => `Son ödeme, kesimden sonra ve en çok ${max} gün içinde olmalı.`,
    cycleGraceTaken: "Bu gün kesimle uyumlu bir ödeme tarihi vermiyor.",
    cycleGraceDays: (days: number) => `Kesimden ${days} gün sonra`,
    cycleHint: "Yeni harcamalar, gerçek ekstrelerinin son ödeme tarihinde bakiyene yansır.",
    /* The countdown, not the percentage. "Dönemin %62'si doldu" was a figure
       nobody acts on; "Ekstreye 6 gün" answers the question a person actually
       has at the till — does this purchase land on the statement about to
       close, or the next one. */
    cycleDaysLeft: (days: number) =>
      days === 0 ? "Ekstre bugün kesiliyor" : `Ekstreye ${days} gün`,
    cycleMissing: "Ekstre tarihleri eksik",
    statementHistory: "Ekstre Dönemleri",
    statementHistoryHint: "Bu karta bağlı gerçek ekstrelerin kesim ve son ödeme tarihleri.",
    statementDates: (statement: string, due: string) => `Kesim ${statement} · Son ödeme ${due}`,
    statementSummary: (count: number, largest: string) =>
      `Son ${count} dönem · en yüksek ${largest}`,
    statementMore: (count: number) => `+${count} eski dönem`,
    statementEmptyPeriod: "Bu dönemde harcama yok",
    owner: "Sahibi",
  },
  incomeKinds: {
    salary: "Maaş",
    rent: "Kira",
    allowance: "Destek",
    other: "Diğer",
  },
  incomes: {
    formTitle: "Düzenli gelir ekle",
    editTitle: "Gelir kuralını düzenle",
    formHint: "Gelirin türünü, olağan tutarını ve hangi döngüde bekleneceğini tanımla.",
    listTitle: "Tanımlı gelirler",
    listHint: "Bir kaydı açarak tutarını, döngüsünü veya bağlı kişiyi düzenleyebilirsin.",
    cadenceA11y: (description: string) => `Gelirin çalışma ritmi: ${description}.`,
    kindLabel: "Gelir Türü",
    nameLabel: "Başlık",
    dayError: "1 ile 31 arasında bir gün gir",
    categoryLabel: "Mali Tablo'da işleneceği kategori",
    everyMonth: (day: number) => day === 31 ? "Her ayın son günü" : `Her ayın ${day}. günü`,
    recurrenceLabel: "Tekrarlama",
    monthly: "Aylık",
    weekly: "Haftalık",
    biweekly: "2 Haftada Bir",
    firstPaymentDate: "İlk ödeme tarihi",
    everyInterval: (recurrence: "weekly" | "biweekly") => recurrence === "weekly" ? "Her hafta" : "2 haftada bir",
    emptyTitle: "Henüz düzenli gelir yok",
    emptyHint: "Maaşını ekle; maaş günü geldiğinde Helix sana sorar, onayladığında bakiye güncellenir.",
  },
  notif: {
    privateTitle: "Helix hatırlatması",
    privateBody: "Yaklaşan finansal planını görmek için Helix'i aç.",
    upcoming: (name: string, d: string, amount: string) => `${name} · ${d} (${amount})`,
    upcomingTitle: "Yaklaşan ödeme",
    dueTitle: "Bugün son gün",
    dueBody: (name: string, amount: string) => `${name} (${amount}) ödendi mi? Uygulamada teyit et.`,
    trialTitle: "Deneme süresi bitiyor",
    trialBody: (name: string, d: string) => `${name} ${d} tarihinde ücretli aboneliğe geçiyor.`,
    lastInstallmentTitle: "Son taksit 🎉",
    lastInstallmentBody: (name: string) => `${name} bu ay bitiyor.`,
    salaryTitle: "Maaş günü",
    salaryBody: (name: string, amount: string) => `${name} (${amount}) yattı mı? Teyit et.`,
  },
  feedback: {
    title: "Geri bildirim",
    settingsDesc: "Bir hata bildir ya da fikrini paylaş",
    intro: "Ne olduğunu kendi cümlelerinle yaz. Ekran görüntüsü eklersen çok daha hızlı bulurum.",
    categoryLabel: "Bu ne hakkında?",
    category: {
      visual: "Görsel hata",
      functional: "Çalışmayan özellik",
      performance: "Yavaşlık",
      data: "Yanlış veri veya hesap",
      suggestion: "Öneri",
      other: "Diğer",
    },
    categoryHint: {
      visual: "Bozuk görünüm, kayan hizalama, üst üste binen ya da kesilen yazı.",
      functional: "Basınca tepki vermeyen bir kontrol, açılmayan bir ekran.",
      performance: "Çalışıyor ama yavaş, takılıyor ya da pili tüketiyor.",
      data: "Tutar, tarih, bakiye ya da içe aktarma sonucu yanlış.",
      suggestion: "Bozuk bir şey yok; şöyle olsa daha iyi olur.",
      other: "Yukarıdakilerden hiçbiri.",
    },
    messageLabel: "Ne oldu?",
    imageTitle: "Ekran görüntüsü",
    imageHint: (max: number, perImage: string, total: string) =>
      `İsteğe bağlı. En fazla ${max} görsel, her biri ${perImage}, toplamda ${total}.`,
    imageAdd: "Görsel Ekle",
    imageAddMore: "Başka Görsel Ekle",
    imageRemove: "Kaldır",
    imageCount: (used: number, max: number, size: string) => `${used}/${max} görsel · ${size}`,
    imageFull: "Sınıra ulaştın. Yenisini eklemek için bir görseli kaldır.",
    messageCount: (used: number, max: number) => `${used}/${max} karakter`,
    send: "Gönder",
    sending: "Gönderiliyor",
    sent: "Geri bildirimin ulaştı. Teşekkürler.",
    rejected: {
      empty: "Birkaç cümle yazman gerekiyor.",
      tooShort: (min: number, used: number) =>
        `Biraz daha ayrıntı yazar mısın? En az ${min} karakter gerekiyor, şu an ${used}.`,
      tooLong: (max: number, used: number) =>
        `Bu biraz uzun oldu: ${used} karakter yazdın, en fazla ${max} olabilir.`,
      type: (picked: string) =>
        `Yalnızca görsel eklenebilir: JPEG, PNG, WebP ya da HEIC. Seçtiğin dosya ${picked}.`,
      // A picker can hand back an asset with no MIME type at all — a file with
      // no extension, or a provider that does not report one. "Kategorisiz"
      // was standing in here, which is a word about ledger columns.
      unknownType: "tanınmayan bir türde",
      size: (max: string, picked: string) =>
        `Bir görsel ${max}'ı aşamaz. Seçtiğin görsel ${picked}.`,
      count: (max: number) =>
        `En fazla ${max} görsel ekleyebilirsin. Yenisini eklemek için birini kaldır.`,
      total: (max: string, used: string, picked: string) =>
        `Görsellerin toplamı ${max}'ı aşamaz. Şu an ${used} ekli, seçtiğin görsel ${picked}.`,
      duplicate: "Bu görsel zaten ekli.",
      unreadable: "Bu dosya okunamadı. Başka bir görsel dener misin?",
    },
    failed: "Gönderilemedi. Bağlantını kontrol edip tekrar dener misin?",
    unauthenticated: "Geri bildirim göndermek için giriş yapman gerekiyor.",
    rateLimited: "Kısa sürede çok fazla bildirim gönderildi. Bir süre sonra tekrar dene; yazdıkların burada duruyor.",
    unconfigured: "Bu kurulum buluta bağlı değil, bu yüzden geri bildirim gönderilemiyor.",
    privacy: "Yalnızca yazdığın metin, seçtiğin kategori, varsa eklediğin görsel ve hesabının e-posta adresi gönderilir. Finansal verilerinin hiçbiri gitmez.",
  },
  months: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],
} as const;

/**
 * Turkish upper case.
 *
 * `textTransform: "uppercase"` is the obvious way to write a small-capital
 * eyebrow and it is wrong here. On the web it happens to work, because
 * `<html lang="tr">` is set and browsers case per the document language — so
 * the defect is invisible in the browser suite. React Native's own transform
 * has no locale: it maps "i" to "I" rather than to "İ", so on the shipped iOS
 * and Android builds the dashboard read GÜNCEL BAKIYE, and three months a year
 * came out NISAN, HAZIRAN and EKIM.
 *
 * `toLocaleUpperCase("tr-TR")` is what the rest of this file already uses for
 * names and search keys; eyebrows now go through the same door. The dotless ı
 * is handled by the same mapping, so MAYIS and KASIM stay correct too.
 */
export function upperTR(value: string): string {
  return value.toLocaleUpperCase("tr-TR");
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  const name = tr.months[Number(m) - 1];
  return name && y ? `${name} ${y}` : monthKey;
}

export function monthName(monthKey: string): string {
  return tr.months[Number(monthKey.slice(5, 7)) - 1] ?? monthKey;
}

export function shortMonthLabel(monthKey: string): string {
  return monthName(monthKey).slice(0, 3);
}

export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  const name = tr.months[Number(m) - 1];
  return name && y && d ? `${Number(d)} ${name} ${y}` : iso;
}

/**
 * A market rate, to the kuruş, with no currency mark.
 *
 * Market prices are the one figure the app does not put through
 * `formatMinorCompact`: that formatter rounds a large amount to "₺3,8M", which
 * is a fine way to read a balance and a useless way to read the price of a
 * Cumhuriyet altını. The mark is left to the caller because a tile prints it
 * once for a pair of prices rather than once each.
 *
 * The formatter is built once. This ran inside three separate render-time
 * helpers — two of them in one file — each constructing a fresh
 * `Intl.NumberFormat` per call, on a card that redraws six tiles every poll.
 */
const RATE_FORMAT = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function marketRateLabel(value: number): string {
  return RATE_FORMAT.format(value);
}

/** Compact "1 Ağu 2026" form for badges and other tight layouts. */
export function shortDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  const name = tr.months[Number(m) - 1];
  return name && y && d ? `${Number(d)} ${name.slice(0, 3)} ${y}` : iso;
}

export function dateTimeLabel(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(value);
}

/** ms epoch → compact "HH:MM" when today, full date-time otherwise. */
export function clockOrDateTimeLabel(ms: number): string {
  const at = new Date(ms);
  return at.toDateString() === new Date().toDateString()
    ? new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(at)
    : dateTimeLabel(at.toISOString());
}
