/// Calculate APCA Lightness Contrast (Lc) value.
/// Positive Lc = dark text on light bg.
/// Negative Lc = light text on dark bg.
/// |Lc| >= 60 is roughly equivalent to WCAG AA for body text.
///
/// Port of: apca-w3 npm library (v0.1.9) -> APCAcontrast() + sRGBtoY()
pub fn calc_apca_lc(text_hex: &str, bg_hex: &str) -> f64 {
    // Constants from apca-w3 0.1.9 SA98G object
    const MAIN_TRC: f64 = 2.4;
    const S_RCO: f64 = 0.2126729;
    const S_GCO: f64 = 0.7151522;
    const S_BCO: f64 = 0.0721750;

    const NORM_BG: f64 = 0.56;
    const NORM_TXT: f64 = 0.57;
    const REV_BG: f64 = 0.65;
    const REV_TXT: f64 = 0.62;

    const BLK_THRS: f64 = 0.022;
    const BLK_CLMP: f64 = 1.414;

    const SCALE_BOW: f64 = 1.14;
    const SCALE_WOB: f64 = 1.14;
    const LO_BOW_OFFSET: f64 = 0.027;
    const LO_WOB_OFFSET: f64 = 0.027;
    const DELTA_Y_MIN: f64 = 0.0005;
    const LO_CLIP: f64 = 0.1;

    // sRGBtoY: simple power curve (NOT the WCAG piecewise function)
    let linearize = |c: u8| -> f64 {
        (c as f64 / 255.0).powf(MAIN_TRC)
    };

    let (tr, tg, tb) = super::hex::parse_hex_rgb(text_hex);
    let (br, bg, bb) = super::hex::parse_hex_rgb(bg_hex);

    let mut txt_y = S_RCO * linearize(tr) + S_GCO * linearize(tg) + S_BCO * linearize(tb);
    let mut bg_y = S_RCO * linearize(br) + S_GCO * linearize(bg) + S_BCO * linearize(bb);

    // Black soft clamp
    txt_y = if txt_y > BLK_THRS {
        txt_y
    } else {
        txt_y + (BLK_THRS - txt_y).powf(BLK_CLMP)
    };
    bg_y = if bg_y > BLK_THRS {
        bg_y
    } else {
        bg_y + (BLK_THRS - bg_y).powf(BLK_CLMP)
    };

    // Early return for extremely low delta Y
    if (bg_y - txt_y).abs() < DELTA_Y_MIN {
        return 0.0;
    }

    let output_contrast = if bg_y > txt_y {
        // Normal polarity: dark text on light bg (BoW) -> positive Lc
        let sapc = (bg_y.powf(NORM_BG) - txt_y.powf(NORM_TXT)) * SCALE_BOW;
        if sapc < LO_CLIP { 0.0 } else { sapc - LO_BOW_OFFSET }
    } else {
        // Reverse polarity: light text on dark bg (WoB) -> negative Lc
        let sapc = (bg_y.powf(REV_BG) - txt_y.powf(REV_TXT)) * SCALE_WOB;
        if sapc > -LO_CLIP { 0.0 } else { sapc + LO_WOB_OFFSET }
    };

    output_contrast * 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    // Cross-reference values from: node -e "const {calcAPCA} = require('apca-w3'); ..."
    #[test]
    fn black_on_white() {
        let lc = calc_apca_lc("#000000", "#ffffff");
        // apca-w3: 106.0
        assert!((lc - 106.0).abs() < 1.0, "got {lc}");
    }

    #[test]
    fn white_on_black() {
        let lc = calc_apca_lc("#ffffff", "#000000");
        // apca-w3: -107.9
        assert!((lc - (-107.9)).abs() < 1.0, "got {lc}");
    }

    #[test]
    fn gray_on_white() {
        let lc = calc_apca_lc("#767676", "#ffffff");
        // apca-w3: 71.6
        assert!((lc - 71.6).abs() < 1.0, "got {lc}");
    }

    #[test]
    fn same_color_returns_zero() {
        let lc = calc_apca_lc("#808080", "#808080");
        // apca-w3: 0
        assert!(lc.abs() < 1.0, "got {lc}");
    }

    #[test]
    fn slate_on_white() {
        let lc = calc_apca_lc("#1e293b", "#ffffff");
        // apca-w3: 101.4
        assert!((lc - 101.4).abs() < 1.0, "got {lc}");
    }

    #[test]
    fn zinc_100_on_zinc_950() {
        let lc = calc_apca_lc("#f4f4f5", "#09090b");
        // apca-w3: -100.6
        assert!((lc - (-100.6)).abs() < 1.0, "got {lc}");
    }
}
