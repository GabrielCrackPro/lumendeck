// Reading the end of a log file without reading the log file.
//
// The naive version — `read_to_string` then split — works right up until the
// file is the size it is designed to grow to, at which point the webview that
// asked for 200 lines is holding 5 MB and the window stops responding. That is
// the worst possible failure mode for a diagnostics button: it hangs exactly
// when the user is already in trouble.
//
// So the tail is read backwards in fixed-size chunks from the end of the file
// until enough newlines have been seen, and only the part that was actually
// needed gets decoded. A 5 MB log and a 4 KB one cost roughly what the returned
// text costs.
//
// Lines are returned newest last, matching how the file reads top to bottom.
// A partial first line is dropped rather than returned: it is the middle of a
// record that rotation cut in half, and showing someone half a timestamp as
// if it were a whole line is exactly the kind of detail that makes a log
// untrustworthy.

/// Bytes read per backwards step. Large enough that a normal tail needs one
/// trip, small enough to stay inside the 2 MB read that Windows will not
/// refuse for a non-special file.
const CHUNK: usize = 64 * 1024;

/// The last `want` lines of `text`, newest last.
///
/// Split out from the file reading so it can be tested against strings that
/// include the awkward cases — empty input, no trailing newline, a single line
/// with no newline at all, more requested than exists — none of which need a
/// file on disk to reproduce.
pub fn tail_from_str(text: &str, want: usize) -> Vec<String> {
    if want == 0 || text.is_empty() {
        return Vec::new();
    }
    let mut lines: Vec<&str> = text.lines().collect();
    // The final chunk of a rotated file ends mid-record; `lines()` already drops
    // the trailing fragment, which is what we want.
    if lines.len() > want {
        lines = lines.split_off(lines.len() - want);
    }
    lines.into_iter().map(str::to_string).collect()
}

/// The last `want` lines of the file at `path`, reading backwards.
///
/// Returns lines newest last. A missing file is an empty vector: "no log yet"
/// is a state the UI has to render, not an exception to propagate.
pub fn tail(path: &std::path::Path, want: usize) -> std::io::Result<Vec<String>> {
    use std::io::{Read, Seek, SeekFrom};
    if want == 0 {
        return Ok(Vec::new());
    }
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        // "No log yet" is a state the UI has to render, not an exception. Every
        // other IO failure below still propagates, because a permission error
        // means something is actually wrong and swallowing it would hide that.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let size = file.metadata()?.len();
    if size == 0 {
        return Ok(Vec::new());
    }

    // Read backwards in chunks, counting newlines, until we have enough lines
    // plus the one that starts the oldest one we want.
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
        // Keep this chunk plus everything already collected, in file order.
        let mut next = buf;
        next.extend_from_slice(&collected);
        collected = next;
        if lines_needed == 0 {
            break;
        }
    }

    // We may have started mid-line; drop the fragment before the first newline.
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
        // Not a crash and not "everything": zero is a real answer here, and
        // returning the whole file for it would defeat the point of the reader.
        assert!(tail_from_str(&numbered(5), 0).is_empty());
    }

    #[test]
    fn an_empty_log_is_empty_not_an_error() {
        assert!(tail_from_str("", 10).is_empty());
    }

    #[test]
    fn a_file_with_no_trailing_newline_still_yields_its_last_line() {
        // Rotation can leave the file ending mid-write. Dropping the final
        // record entirely would hide the crash that caused the rotation.
        assert_eq!(tail_from_str("a\nb\nc", 1), vec!["c"]);
        assert_eq!(tail_from_str("only", 5), vec!["only"]);
    }

    #[test]
    fn blank_lines_are_lines() {
        assert_eq!(tail_from_str("a\n\n\nb\n", 4), vec!["a", "", "", "b"]);
    }

    #[test]
    fn reading_a_file_agrees_with_reading_the_same_text() {
        // The chunked reader is the one that can be wrong in ways the string
        // version cannot, so the two are held to the same answer.
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
        // The whole reason the reader exists. 500 lines of 80 bytes is well
        // under CHUNK, so this makes the file several chunks long and proves
        // the backwards walk terminates at the right place.
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
