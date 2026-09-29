// Danh sách loại/keyword MẶC ĐỊNH của "Nhóm hàng" (29/09/2026, người dùng cung cấp + xác nhận: thêm tên viết đúng
// hoodie/sweat/shorts/polo/banner/tag/sign, Youth/KID là loại riêng, Garter ở Nhóm 2, BodySuit/Romper ở Nhóm 2).
// CHỈ dùng để nạp vào SQLite đúng 1 lần khi bảng nhom_hang_loai vừa được tạo (services/caiDatDbService.js) — sau đó
// thêm/sửa/xoá ở Settings; sửa file này KHÔNG còn tác dụng với DB đã có.
// { nhóm: { tên loại: 'keyword, keyword, ...' } }
module.exports = {
  1: {
    Tshirt: 't-shirt, t shirt, tshirt, tshir, tsirt, t-shir, t-sirt, áothun, ao thun',
    TshirtYouth: 't shirt youth',
    TshirtKID: 'tshirt kid',
    Sweat: 'sweat, sweatshirt, sweat shirt, sweats, sweatr, sweat-shirt, sweatshrt, swetshirt, swatshirt, sw',
    SweatYouth: 'sweatyouth',
    SweatKID: 'sweatkid',
    Hoodie: 'hoodie, hoodi, hoody, hoddie, hoodei, hoodies, hodie, hodei',
    HoodieYouth: 'hoodieyouth',
    HoodieKID: 'hoodiekid',
    QuarterZip: 'quarter zip, quarter-zip, qtr zip, qtrzip, 1/4 zip, quarterzip, quarter zips',
    BabyTee: 'baby tee, baby-tee, babyte, babyteee, baby t, baby t-shirt',
    Mockneck: 'mock neck, mock-neck, mok neck, mokneck, mockneck trơn, mockneck ging ham, sw ghingham, mock neck sw, áo mockneck, ao mockneck',
    SweatCaoCổTrơn: 'sweat cao cổ trơn, sweat cao co tron, sweat caoco tron, sweat-cao-co-tron',
    SweatCaro: 'sweat caro, sweat-caro, sweat carô, sweatcaro',
    AoLen: 'áo len, ao len, aolen, áo len người lớn, ao len nguoi lon, áo len trẻ em, ao len tre em, sweater len',
    AoRen: 'áo ren, ao ren, aoren, áo 2 dây ren, ao 2 day ren, ao 2 dây ren hoa văn',
    Ao3Lo: 'áo 3 lỗ, ao 3 lo, áo 3 lỗ ren, ao 3 lo ren, aó 3 lỗ ren, tanktop, tank top',
    Ao2Day: 'áo 2 dây, ao 2 day, áo 2dây, ao 2day',
    Shorts: 'shorts, quần đùi, quan dui, quandui, short, short-pant, pant-short',
    Polo: 'polo, áo polo, ao polo, polos, polog',
  },
  2: {
    WashHat: 'wash hat, wash-hat, washhat, mũ wash, mu wash, washed hat',
    TruckerHat: 'trucker hat, trucker-hat, truker hat, truckerhat, mũ trucker',
    KeyChain: 'key chain, key-chain, keychain, key chain pet, keychainpet, móc khóa, moc khoa',
    BabyFlag: 'baby flag, baby-flag, babyflag, cờ baby, co baby',
    Banner: 'banner, baner, bannner, bannar, băng rôn, bang ron',
    Ornament: 'ornamnet, ornament, hoop ornament, ornamets, trang trí tree',
    Tag: 'tag, tags, tagg, thẻ tag, the tag, sign + tag, sign and tag',
    Sign: 'sign, sign only, sign-only, biển bảng, bảng sign',
    YemCho: 'yếm chó, yem cho, yemcho, dog bib, pet bib',
    TuaDua: 'tua dua, tua-dua, tuadua, tassel',
    VoGoi: 'vỏ gối, vo goi, vogoi, pillow cover, pillow cover only, pillow-cover',
    GoiCoRuot: 'gối có ruột, goi co ruot, goicoruot, cover+pillow insert, cover + pillow insert, pillow insert',
    ChanLen: 'chăn len, chan len, chanlen, chăn len trẻ em, chan len tre em, blanket',
    BodySuit: 'body suit, body-suit, bodysuit, romper, baby romper, babyromper',
    Garter: 'garter',
  },
};
