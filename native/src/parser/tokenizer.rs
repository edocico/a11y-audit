use super::visitor::JsxVisitor;

/// Scan JSX source and emit events to all registered visitors.
/// This is a "lossy" lexer — it recognizes tags, attributes, comments, and strings,
/// but ignores everything else.
///
/// Port of: src/plugins/jsx/parser.ts → extractClassRegions() (state machine core)
pub fn scan_jsx(source: &str, visitors: &mut [&mut dyn JsxVisitor]) {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let line_offsets = build_line_offsets(source);

    let mut i = 0;

    while i < len {
        // ── Single-line comment: // ... \n ──
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            let comment_start = i;
            i += 2;
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            let comment_text = &source[comment_start + 2..i]; // strip leading //
            let line = line_at_offset(&line_offsets, comment_start);
            for v in visitors.iter_mut() {
                v.on_comment(comment_text, line);
            }
            continue;
        }

        // ── Block comment: /* ... */ ──
        if i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            let comment_start = i;
            i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            if i + 1 < len {
                i += 2; // skip */
            }
            let content_end = if i >= 2 { i - 2 } else { i };
            let comment_text = &source[comment_start + 2..content_end]; // strip /* and */
            let line = line_at_offset(&line_offsets, comment_start);
            for v in visitors.iter_mut() {
                v.on_comment(comment_text, line);
            }
            continue;
        }

        // ── String literals (skip to avoid false matches) ──
        if bytes[i] == b'"' || bytes[i] == b'\'' {
            let quote = bytes[i];
            i += 1;
            while i < len && bytes[i] != quote {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            if i < len {
                i += 1;
            }
            continue;
        }

        // ── Template literal (skip, but we handle className={`...`} separately below) ──
        if bytes[i] == b'`' {
            i += 1;
            while i < len && bytes[i] != b'`' {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            if i < len {
                i += 1;
            }
            continue;
        }

        // ── JSX Tags ──
        if bytes[i] == b'<' && i + 1 < len {
            let next = bytes[i + 1];

            // Closing tag: </TagName>
            if next == b'/' {
                let tag_start = i + 2;
                let (tag_name, tag_end) = read_tag_name(bytes, tag_start);
                if !tag_name.is_empty() {
                    for v in visitors.iter_mut() {
                        v.on_tag_close(&tag_name);
                    }
                }
                // Skip to closing >
                let mut j = tag_end;
                while j < len && bytes[j] != b'>' {
                    j += 1;
                }
                if j < len {
                    j += 1;
                }
                i = j;
                continue;
            }

            // Opening tag: starts with letter (including uppercase components)
            if next.is_ascii_alphabetic() {
                let tag_start = i + 1;
                let (tag_name, name_end) = read_tag_name(bytes, tag_start);

                if !tag_name.is_empty() {
                    // Find the end of the tag (the closing > or />)
                    let tag_close = find_tag_close(source, name_end);
                    let raw_tag = &source[i..tag_close];
                    let is_self_closing = is_self_closing_tag(source, name_end);

                    for v in visitors.iter_mut() {
                        v.on_tag_open(&tag_name, is_self_closing, raw_tag);
                    }

                    // Now scan inside the tag for className= attributes
                    scan_tag_attributes(source, bytes, name_end, tag_close, &line_offsets, raw_tag, visitors);

                    i = tag_close;
                    continue;
                }
            }
        }

        // ── Standalone cn(), clsx(), cva() outside className= ──
        if i + 3 <= len && !is_ident_char_before(bytes, i) {
            let standalone_fn = if starts_with_at(bytes, i, b"cn(") {
                Some(2)
            } else if i + 5 <= len && starts_with_at(bytes, i, b"clsx(") {
                Some(4)
            } else if i + 4 <= len && starts_with_at(bytes, i, b"cva(") {
                Some(3)
            } else {
                None
            };

            if let Some(fn_len) = standalone_fn {
                let paren_start = i + fn_len;
                if let Some((content, end)) = extract_balanced_parens(source, paren_start) {
                    let line = line_at_offset(&line_offsets, i);
                    for v in visitors.iter_mut() {
                        v.on_class_attribute(&content, line, "");
                    }
                    i = end + 1;
                    continue;
                }
            }
        }

        i += 1;
    }

    // Notify visitors that scanning is complete
    for v in visitors.iter_mut() {
        v.on_file_end();
    }
}

/// Scan tag attributes between name_end and tag_close for className= patterns.
fn scan_tag_attributes(
    source: &str,
    bytes: &[u8],
    name_end: usize,
    tag_close: usize,
    line_offsets: &[usize],
    raw_tag: &str,
    visitors: &mut [&mut dyn JsxVisitor],
) {
    let mut j = name_end;
    let class_name_prefix = b"className=";

    while j + class_name_prefix.len() <= tag_close {
        if starts_with_at(bytes, j, class_name_prefix) {
            let line = line_at_offset(line_offsets, j);
            let eq_end = j + class_name_prefix.len();
            let after_eq = skip_ws(bytes, eq_end);

            // className="..."
            if after_eq < tag_close && bytes[after_eq] == b'"' {
                let str_start = after_eq + 1;
                if let Some(str_end) = find_unescaped(bytes, b'"', str_start) {
                    let content = &source[str_start..str_end];
                    for v in visitors.iter_mut() {
                        v.on_class_attribute(content, line, raw_tag);
                    }
                    j = str_end + 1;
                    continue;
                }
            }

            // className={...}
            if after_eq < tag_close && bytes[after_eq] == b'{' {
                let inner = skip_ws(bytes, after_eq + 1);

                // className={'...'} or className={"..."}
                if inner < tag_close && (bytes[inner] == b'\'' || bytes[inner] == b'"') {
                    let quote = bytes[inner];
                    let str_start = inner + 1;
                    if let Some(str_end) = find_unescaped(bytes, quote, str_start) {
                        let content = &source[str_start..str_end];
                        for v in visitors.iter_mut() {
                            v.on_class_attribute(content, line, raw_tag);
                        }
                        j = str_end + 1;
                        continue;
                    }
                }

                // className={`...`}
                if inner < tag_close && bytes[inner] == b'`' {
                    let t_start = inner + 1;
                    if let Some(t_end) = find_unescaped(bytes, b'`', t_start) {
                        // Strip template expressions ${...} → space
                        let raw_template = &source[t_start..t_end];
                        let static_content = strip_template_expressions(raw_template);
                        for v in visitors.iter_mut() {
                            v.on_class_attribute(&static_content, line, raw_tag);
                        }
                        j = t_end + 1;
                        continue;
                    }
                }

                // className={cn(...)} or className={clsx(...)}
                if inner + 3 <= source.len() && starts_with_at(bytes, inner, b"cn(") {
                    let paren_start = inner + 2;
                    if let Some((content, end)) = extract_balanced_parens(source, paren_start) {
                        for v in visitors.iter_mut() {
                            v.on_class_attribute(&content, line, raw_tag);
                        }
                        j = end + 1;
                        continue;
                    }
                }
                if inner + 5 <= source.len() && starts_with_at(bytes, inner, b"clsx(") {
                    let paren_start = inner + 4;
                    if let Some((content, end)) = extract_balanced_parens(source, paren_start) {
                        for v in visitors.iter_mut() {
                            v.on_class_attribute(&content, line, raw_tag);
                        }
                        j = end + 1;
                        continue;
                    }
                }
            }

            j = eq_end;
            continue;
        }

        j += 1;
    }
}

// ── Helper Functions ──────────────────────────────────────────────────

/// Pre-compute line break offsets for binary search line numbering.
fn build_line_offsets(source: &str) -> Vec<usize> {
    let mut offsets = vec![0]; // Line 1 starts at offset 0
    for (i, ch) in source.bytes().enumerate() {
        if ch == b'\n' {
            offsets.push(i + 1);
        }
    }
    offsets
}

/// Binary search for 1-based line number at given byte offset.
fn line_at_offset(offsets: &[usize], offset: usize) -> u32 {
    match offsets.binary_search(&offset) {
        Ok(i) => (i + 1) as u32,
        Err(i) => i as u32,
    }
}

/// Valid tag-name characters: letters, digits, dot (motion.div), hyphen, underscore
fn is_tag_name_ch(ch: u8) -> bool {
    ch.is_ascii_alphanumeric() || ch == b'.' || ch == b'-' || ch == b'_'
}

/// Read a JSX tag name starting at `start`. Returns (name, end_position).
fn read_tag_name(bytes: &[u8], start: usize) -> (String, usize) {
    let mut end = start;
    while end < bytes.len() && is_tag_name_ch(bytes[end]) {
        end += 1;
    }
    let name = String::from_utf8_lossy(&bytes[start..end]).to_string();
    (name, end)
}

/// Check if the character before position i is alphanumeric or underscore.
fn is_ident_char_before(bytes: &[u8], i: usize) -> bool {
    if i == 0 {
        return false;
    }
    let ch = bytes[i - 1];
    ch.is_ascii_alphanumeric() || ch == b'_'
}

/// Skip whitespace from position i.
fn skip_ws(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

/// Find next unescaped occurrence of `target` starting from `start`.
fn find_unescaped(bytes: &[u8], target: u8, mut start: usize) -> Option<usize> {
    while start < bytes.len() {
        if bytes[start] == b'\\' {
            start += 2;
            continue;
        }
        if bytes[start] == target {
            return Some(start);
        }
        start += 1;
    }
    None
}

/// Check if bytes at position `at` start with `prefix`.
fn starts_with_at(bytes: &[u8], at: usize, prefix: &[u8]) -> bool {
    if at + prefix.len() > bytes.len() {
        return false;
    }
    &bytes[at..at + prefix.len()] == prefix
}

/// Determine if an opening tag is self-closing (/>).
/// Scans from `from_pos` (just after tag name) forward, respecting braces and strings.
///
/// Port of: src/plugins/jsx/parser.ts → isSelfClosingTag()
fn is_self_closing_tag(source: &str, from_pos: usize) -> bool {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut j = from_pos;
    let mut brace_depth: i32 = 0;

    while j < len {
        let ch = bytes[j];

        if ch == b'{' {
            brace_depth += 1;
            j += 1;
            continue;
        }
        if ch == b'}' {
            if brace_depth > 0 {
                brace_depth -= 1;
            }
            j += 1;
            continue;
        }

        // Skip string literals at any brace depth
        if ch == b'"' || ch == b'\'' || ch == b'`' {
            let q = ch;
            j += 1;
            while j < len && bytes[j] != q {
                if bytes[j] == b'\\' {
                    j += 1;
                }
                j += 1;
            }
            if j < len {
                j += 1;
            }
            continue;
        }

        if brace_depth == 0 {
            if ch == b'/' && j + 1 < len && bytes[j + 1] == b'>' {
                return true;
            }
            if ch == b'>' {
                return false;
            }
        }

        j += 1;
    }

    false // malformed JSX, assume not self-closing
}

/// Find the byte offset just past the closing `>` or `/>` of a tag.
/// Respects braces and strings inside attributes.
fn find_tag_close(source: &str, from_pos: usize) -> usize {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut j = from_pos;
    let mut brace_depth: i32 = 0;

    while j < len {
        let ch = bytes[j];

        if ch == b'{' {
            brace_depth += 1;
            j += 1;
            continue;
        }
        if ch == b'}' {
            if brace_depth > 0 {
                brace_depth -= 1;
            }
            j += 1;
            continue;
        }

        // Skip strings
        if ch == b'"' || ch == b'\'' || ch == b'`' {
            let q = ch;
            j += 1;
            while j < len && bytes[j] != q {
                if bytes[j] == b'\\' {
                    j += 1;
                }
                j += 1;
            }
            if j < len {
                j += 1;
            }
            continue;
        }

        if brace_depth == 0 {
            if ch == b'/' && j + 1 < len && bytes[j + 1] == b'>' {
                return j + 2;
            }
            if ch == b'>' {
                return j + 1;
            }
        }

        j += 1;
    }

    len // malformed — return end of source
}

/// Extract balanced parentheses content from position `open_pos`.
/// The char at `open_pos` must be `(`.
/// Returns (content_inside_parens, closing_paren_position).
///
/// Port of: src/plugins/jsx/categorizer.ts → extractBalancedParens()
fn extract_balanced_parens(source: &str, open_pos: usize) -> Option<(String, usize)> {
    let bytes = source.as_bytes();
    if open_pos >= bytes.len() || bytes[open_pos] != b'(' {
        return None;
    }

    let mut depth: i32 = 1;
    let mut i = open_pos + 1;
    let len = bytes.len();

    while i < len && depth > 0 {
        let ch = bytes[i];

        // Skip string literals
        if ch == b'\'' || ch == b'"' {
            i += 1;
            while i < len && bytes[i] != ch {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            i += 1;
            continue;
        }

        // Skip template literals
        if ch == b'`' {
            i += 1;
            while i < len && bytes[i] != b'`' {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            i += 1;
            continue;
        }

        if ch == b'(' {
            depth += 1;
        } else if ch == b')' {
            depth -= 1;
        }

        if depth > 0 {
            i += 1;
        }
    }

    if depth == 0 {
        let content = source[open_pos + 1..i].to_string();
        Some((content, i))
    } else {
        None
    }
}

/// Strip `${...}` expressions from a template literal body, replacing with space.
fn strip_template_expressions(template: &str) -> String {
    let bytes = template.as_bytes();
    let len = bytes.len();
    let mut result = String::with_capacity(len);
    let mut i = 0;

    while i < len {
        if i + 1 < len && bytes[i] == b'$' && bytes[i + 1] == b'{' {
            // Skip the expression
            let mut depth = 1;
            i += 2;
            while i < len && depth > 0 {
                if bytes[i] == b'{' {
                    depth += 1;
                } else if bytes[i] == b'}' {
                    depth -= 1;
                }
                i += 1;
            }
            result.push(' ');
        } else {
            result.push(template.as_bytes()[i] as char);
            i += 1;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_offsets_simple() {
        let offsets = build_line_offsets("abc\ndef\nghi");
        assert_eq!(offsets, vec![0, 4, 8]);
        assert_eq!(line_at_offset(&offsets, 0), 1);
        assert_eq!(line_at_offset(&offsets, 4), 2);
        assert_eq!(line_at_offset(&offsets, 8), 3);
    }

    #[test]
    fn line_at_middle_of_line() {
        let offsets = build_line_offsets("abc\ndef\nghi");
        assert_eq!(line_at_offset(&offsets, 2), 1); // middle of line 1
        assert_eq!(line_at_offset(&offsets, 5), 2); // middle of line 2
    }

    #[test]
    fn self_closing_detection() {
        assert!(is_self_closing_tag("<br />", 3));
        assert!(!is_self_closing_tag("<div>", 4));
        assert!(is_self_closing_tag(r#"<input type="text" />"#, 6));
        assert!(!is_self_closing_tag(r#"<div className="test">"#, 4));
    }

    #[test]
    fn self_closing_with_braces() {
        assert!(is_self_closing_tag(r#"<Comp onClick={() => {}} />"#, 5));
    }

    #[test]
    fn tag_close_detection() {
        assert_eq!(find_tag_close("<div>", 4), 5);
        assert_eq!(find_tag_close("<br />", 3), 6);
    }

    #[test]
    fn extract_balanced_simple() {
        let (content, end) = extract_balanced_parens(r#"("bg-red", "text-white")"#, 0).unwrap();
        assert_eq!(content, r#""bg-red", "text-white""#);
        assert_eq!(end, 23);
    }

    #[test]
    fn extract_balanced_nested() {
        let (content, _end) = extract_balanced_parens("(a, fn(b, c))", 0).unwrap();
        assert_eq!(content, "a, fn(b, c)");
    }

    #[test]
    fn strip_template_expr() {
        assert_eq!(
            strip_template_expressions("bg-red-500 ${expr} text-white"),
            "bg-red-500   text-white"
        );
    }

    #[test]
    fn strip_template_nested() {
        assert_eq!(
            strip_template_expressions("prefix ${a ? `${b}` : c} suffix"),
            "prefix   suffix"
        );
    }

    // ── Tokenizer integration tests using a RecordingVisitor ──

    struct RecordingVisitor {
        events: Vec<String>,
    }

    impl RecordingVisitor {
        fn new() -> Self {
            Self { events: vec![] }
        }
    }

    impl JsxVisitor for RecordingVisitor {
        fn on_tag_open(&mut self, tag: &str, self_closing: bool, _raw: &str) {
            self.events.push(format!(
                "OPEN:{}{}",
                tag,
                if self_closing { "/" } else { "" }
            ));
        }
        fn on_tag_close(&mut self, tag: &str) {
            self.events.push(format!("CLOSE:{}", tag));
        }
        fn on_comment(&mut self, content: &str, line: u32) {
            self.events
                .push(format!("COMMENT:L{}:{}", line, content.trim()));
        }
        fn on_class_attribute(&mut self, value: &str, line: u32, _raw: &str) {
            self.events.push(format!("CLASS:L{}:{}", line, value));
        }
    }

    #[test]
    fn simple_tag_pair() {
        let mut v = RecordingVisitor::new();
        scan_jsx("<div>hello</div>", &mut [&mut v as &mut dyn JsxVisitor]);
        assert_eq!(v.events, vec!["OPEN:div", "CLOSE:div"]);
    }

    #[test]
    fn self_closing_tag() {
        let mut v = RecordingVisitor::new();
        scan_jsx("<br />", &mut [&mut v as &mut dyn JsxVisitor]);
        assert_eq!(v.events, vec!["OPEN:br/"]);
    }

    #[test]
    fn class_name_static() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            r#"<div className="bg-red-500 text-white">x</div>"#,
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        assert!(v
            .events
            .contains(&"CLASS:L1:bg-red-500 text-white".to_string()));
    }

    #[test]
    fn class_name_single_quoted() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            r#"<div className={'bg-red-500 text-white'}>x</div>"#,
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        assert!(v
            .events
            .contains(&"CLASS:L1:bg-red-500 text-white".to_string()));
    }

    #[test]
    fn class_name_template_literal() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            r#"<div className={`bg-red-500 ${expr} text-white`}>x</div>"#,
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        // Template expressions stripped, classes preserved
        let class_events: Vec<_> = v.events.iter().filter(|e| e.starts_with("CLASS:")).collect();
        assert_eq!(class_events.len(), 1);
        assert!(class_events[0].contains("bg-red-500"));
        assert!(class_events[0].contains("text-white"));
    }

    #[test]
    fn class_name_cn_function() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            r#"<div className={cn("bg-red-500", "text-white")}>x</div>"#,
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        let class_events: Vec<_> = v.events.iter().filter(|e| e.starts_with("CLASS:")).collect();
        assert_eq!(class_events.len(), 1);
        assert!(class_events[0].contains("bg-red-500"));
    }

    #[test]
    fn class_name_clsx_function() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            r#"<div className={clsx("bg-red-500", "text-white")}>x</div>"#,
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        let class_events: Vec<_> = v.events.iter().filter(|e| e.starts_with("CLASS:")).collect();
        assert_eq!(class_events.len(), 1);
    }

    #[test]
    fn comment_single_line() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            "// @a11y-context bg:#09090b\n<div />",
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        assert!(v
            .events
            .iter()
            .any(|e| e.contains("COMMENT") && e.contains("@a11y-context")));
    }

    #[test]
    fn comment_block() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            "{/* @a11y-context-block bg:bg-slate-900 */}\n<div />",
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        assert!(v
            .events
            .iter()
            .any(|e| e.contains("COMMENT") && e.contains("@a11y-context-block")));
    }

    #[test]
    fn nested_tags() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            "<Card><div>x</div></Card>",
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        assert_eq!(
            v.events,
            vec!["OPEN:Card", "OPEN:div", "CLOSE:div", "CLOSE:Card"]
        );
    }

    #[test]
    fn multiple_classes_in_file() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            r#"<div className="bg-red">
                <span className="text-white">hi</span>
            </div>"#,
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        let class_events: Vec<_> = v.events.iter().filter(|e| e.starts_with("CLASS:")).collect();
        assert_eq!(class_events.len(), 2);
    }

    #[test]
    fn line_numbers_tracked() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            "line1\n<div className=\"bg-red\">\nx\n</div>",
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        let class_events: Vec<_> = v.events.iter().filter(|e| e.starts_with("CLASS:")).collect();
        assert_eq!(class_events.len(), 1);
        assert!(class_events[0].starts_with("CLASS:L2:"));
    }

    #[test]
    fn standalone_cn_call() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            r#"const cls = cn("bg-red-500", "text-white");"#,
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        let class_events: Vec<_> = v.events.iter().filter(|e| e.starts_with("CLASS:")).collect();
        assert_eq!(class_events.len(), 1);
    }

    #[test]
    fn component_with_class() {
        let mut v = RecordingVisitor::new();
        scan_jsx(
            r#"<Card className="bg-card text-card-foreground">content</Card>"#,
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        assert!(v.events.contains(&"OPEN:Card".to_string()));
        assert!(v
            .events
            .contains(&"CLASS:L1:bg-card text-card-foreground".to_string()));
        assert!(v.events.contains(&"CLOSE:Card".to_string()));
    }

    #[test]
    fn no_false_match_in_string() {
        let mut v = RecordingVisitor::new();
        // className= inside a string literal should NOT be matched
        scan_jsx(
            r#"const s = "className=\"bg-red\""; <div>x</div>"#,
            &mut [&mut v as &mut dyn JsxVisitor],
        );
        let class_events: Vec<_> = v.events.iter().filter(|e| e.starts_with("CLASS:")).collect();
        assert_eq!(class_events.len(), 0);
    }
}
