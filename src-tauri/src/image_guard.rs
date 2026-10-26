pub fn validate(b: &[u8], mime: &str) -> Result<(), String> {
    let bad = || "IMAGE_HEADER_OR_PIXELS".to_string();
    let be = |i: usize| -> Result<u32, String> {
        let s = b.get(i..i + 4).ok_or_else(bad)?;
        Ok(u32::from_be_bytes(s.try_into().unwrap()))
    };
    let le16 = |i: usize| -> Result<u32, String> {
        let s = b.get(i..i + 2).ok_or_else(bad)?;
        Ok(u16::from_le_bytes(s.try_into().unwrap()) as u32)
    };
    let (w, h) = match mime {
        "image/png" if b.starts_with(b"\x89PNG\r\n\x1a\n") => (be(16)?, be(20)?),
        "image/gif" if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") => (le16(6)?, le16(8)?),
        "image/webp" if b.len() >= 30 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" => {
            match &b[12..16] {
                b"VP8X" => (
                    1 + b[24] as u32 + ((b[25] as u32) << 8) + ((b[26] as u32) << 16),
                    1 + b[27] as u32 + ((b[28] as u32) << 8) + ((b[29] as u32) << 16),
                ),
                b"VP8 " => (le16(26)? & 16383, le16(28)? & 16383),
                b"VP8L" if b[20] == 47 => (
                    1 + b[21] as u32 + (((b[22] & 63) as u32) << 8),
                    1 + (b[22] >> 6) as u32 + ((b[23] as u32) << 2) + (((b[24] & 15) as u32) << 10),
                ),
                _ => return Err(bad()),
            }
        }
        "image/jpeg" if b.starts_with(&[255, 216]) => {
            let mut i = 2;
            let mut dims = None;
            while i + 3 < b.len() {
                if b[i] != 255 {
                    return Err(bad());
                }
                i += 1;
                while b.get(i) == Some(&255) {
                    i += 1;
                }
                let marker = *b.get(i).ok_or_else(bad)?;
                i += 1;
                if marker == 217 || marker == 218 {
                    break;
                }
                if marker == 1 || (208..=215).contains(&marker) {
                    continue;
                }
                let s = b.get(i..i + 2).ok_or_else(bad)?;
                let n = u16::from_be_bytes(s.try_into().unwrap()) as usize;
                if n < 2 || i + n > b.len() {
                    return Err(bad());
                }
                if [
                    192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
                ]
                .contains(&marker)
                    && n >= 7
                {
                    dims = Some((
                        u16::from_be_bytes([b[i + 5], b[i + 6]]) as u32,
                        u16::from_be_bytes([b[i + 3], b[i + 4]]) as u32,
                    ));
                    break;
                }
                i += n;
            }
            dims.ok_or_else(bad)?
        }
        _ => return Err(bad()),
    };
    if w == 0 || h == 0 || w > 16384 || h > 16384 || (w as u64) * (h as u64) > 40_000_000 {
        return Err(bad());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_forged_dimensions_and_mime() {
        let mut b = vec![0; 24];
        b[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        b[16..20].copy_from_slice(&100_000u32.to_be_bytes());
        b[20..24].copy_from_slice(&100_000u32.to_be_bytes());
        assert!(validate(&b, "image/png").is_err());
        assert!(validate(&b, "image/jpeg").is_err());
        b[16..20].copy_from_slice(&4u32.to_be_bytes());
        b[20..24].copy_from_slice(&4u32.to_be_bytes());
        assert!(validate(&b, "image/png").is_ok());
    }
}
