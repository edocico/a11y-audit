/// Events emitted by the tokenizer for visitor consumption.
/// Each visitor implements the methods it cares about; default impls are no-ops.
#[allow(unused_variables)]
pub trait JsxVisitor {
    /// Called when a JSX opening tag is encountered.
    /// `tag_name`: e.g. "Card", "div", "Button"
    /// `is_self_closing`: true if the tag ends with />
    /// `raw_tag`: the full tag string from < to > (including attributes)
    fn on_tag_open(&mut self, tag_name: &str, is_self_closing: bool, raw_tag: &str) {}

    /// Called when a JSX closing tag is encountered.
    fn on_tag_close(&mut self, tag_name: &str) {}

    /// Called when a comment is found (single-line or block).
    /// `content`: the text inside the comment (excluding // or /* */ markers)
    /// `line`: 1-based line number
    fn on_comment(&mut self, content: &str, line: u32) {}

    /// Called when a className or class attribute value is found.
    /// `value`: the extracted class string content
    /// `line`: 1-based line number
    /// `raw_tag`: the full raw tag string for context (inline style extraction, etc.)
    fn on_class_attribute(&mut self, value: &str, line: u32, raw_tag: &str) {}

    /// Called when the scan of a file is complete.
    fn on_file_end(&mut self) {}
}
