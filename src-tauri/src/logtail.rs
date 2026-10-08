
const CHUNK: usize = 64 * 1024;

pub fn tail_from_str(text: &str, want: usize) -> Vec<String> {
    if want == 0 || text.is_empty() {
        return Vec::new();
    }
    let mut lines: Vec<&str> = text.lines().collect();
    if lines.len() > want {
        lines = lines.split_off(lines.len() - want);
    }
    lines.into_iter().map(str::to_string).collect()
}

pub fn tail(path: &std::path::Path, want: usize) -> std::io::Result<Vec<String>> {
    use std::io::{Read, Seek, SeekFrom};
    if want == 0 {
        return Ok(Vec::new());
    }
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let size = file.metadata()?.len();
    if size == 0 {
        return Ok(Vec::new());
    }

    let mut collected: Vec<u8> = Vec::new();
    let mut lines_needed = want;
    let mut pos = size;
    while pos > 0 {
        let take = CHUNK.min(pos as usize) as u64;
        pos -= take;
        let mut buf = vec![0u8; take as usize];
        file.seek(SeekFrom::Start(pos))?;
        file.read_exact(&mut buf)?;
        for &b in buf.iter().rev() {
            if b == b'\n' {
                lines_needed = lines_needed.saturating_sub(1);
                if lines_needed == 0 {
                    break;
                }
            }
        }
        let mut next = buf;
        next.extend_from_slice(&collected);
        collected = next;
        if lines_needed == 0 {
            break;
        }
    }

    let text = String::from_utf8_lossy(&collected);
    let text = match text.find('\n') {
        Some(i) if pos > 0 => &text[i + 1..],
        _ => &text[..],
    };
    Ok(tail_from_str(text, want))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn numbered(n: usize) -> String {
        (0..n).map(|i| format!("line {i}\n")).collect()
    }

    #[test]
    fn a_tail_keeps_the_end_of_the_file() {
        let out = tail_from_str(&numbered(10), 3);
        assert_eq!(out, vec!["line 7", "line 8", "line 9"]);
    }

    #[test]
    fn asking_for_more_than_exists_returns_everything() {
        let out = tail_from_str(&numbered(3), 100);
        assert_eq!(out, vec!["line 0", "line 1", "line 2"]);
    }

    #[test]
    fn asking_for_one_line_returns_the_last_one() {
        assert_eq!(tail_from_str(&numbered(5), 1), vec!["line 4"]);
    }

    #[test]
    fn asking_for_nothing_returns_nothing() {
        assert!(tail_from_str(&numbered(5), 0).is_empty());
    }

    #[test]
    fn an_empty_log_is_empty_not_an_error() {
        assert!(tail_from_str("", 10).is_empty());
    }

    #[test]
    fn a_file_with_no_trailing_newline_still_yields_its_last_line() {
        assert_eq!(tail_from_str("a\nb\nc", 1), vec!["c"]);
        assert_eq!(tail_from_str("only", 5), vec!["only"]);
    }

    #[test]
    fn blank_lines_are_lines() {
        assert_eq!(tail_from_str("a\n\n\nb\n", 4), vec!["a", "", "", "b"]);
    }

    #[test]
    fn reading_a_file_agrees_with_reading_the_same_text() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "lumendeck-logtail-{}.log",
            std::process::id()
        ));
        let text = numbered(500);
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(text.as_bytes()).unwrap();
        drop(f);

        for want in [1usize, 2, 7, 50, 499, 500, 900] {
            let from_file = tail(&path, want).unwrap();
            let from_str = tail_from_str(&text, want);
            assert_eq!(from_file, from_str, "disagreed at want={want}");
        }
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn a_file_larger_than_one_chunk_still_returns_only_the_tail() {
        let path = std::env::temp_dir().join(format!("lumendeck-logtail-big-{}.log", std::process::id()));
        let mut text = String::new();
        for i in 0..4_000 {
            text.push_str(&format!("{i:06} {}\n", "x".repeat(70)));
        }
        std::fs::write(&path, &text).unwrap();
        assert!(text.len() > CHUNK * 2, "test file should span several chunks");

        let out = tail(&path, 3).unwrap();
        assert_eq!(out.len(), 3);
        assert_eq!(out[2], format!("003999 {}", "x".repeat(70)));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn a_missing_file_is_an_empty_result_not_an_error() {
        let missing = std::env::temp_dir().join("lumendeck-no-such-log-file.log");
        assert_eq!(tail(&missing, 10).unwrap(), Vec::<String>::new());
    }
}
