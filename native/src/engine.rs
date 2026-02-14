use std::collections::HashMap;

use rayon::prelude::*;

use crate::types::{ExtractOptions, PreExtractedFile};

/// Parse multiple JSX files in parallel and return extracted ClassRegion data.
///
/// Uses Rayon's `par_iter()` for CPU-parallel parsing — each file gets its own
/// `ScanOrchestrator` instance (no shared mutable state across files).
///
/// This is the main "hot path" entry point called from JS via NAPI.
pub fn extract_and_scan(options: &ExtractOptions) -> Vec<PreExtractedFile> {
    let container_config: HashMap<String, String> = options
        .container_config
        .iter()
        .map(|e| (e.component.clone(), e.bg_class.clone()))
        .collect();

    options
        .file_contents
        .par_iter()
        .map(|file_input| {
            let regions =
                crate::parser::scan_file(&file_input.content, &container_config, &options.default_bg);
            PreExtractedFile {
                path: file_input.path.clone(),
                regions,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_options(files: Vec<(&str, &str)>, containers: &[(&str, &str)]) -> ExtractOptions {
        ExtractOptions {
            file_contents: files
                .into_iter()
                .map(|(path, content)| FileInput {
                    path: path.to_string(),
                    content: content.to_string(),
                })
                .collect(),
            container_config: containers
                .iter()
                .map(|(c, b)| ContainerEntry {
                    component: c.to_string(),
                    bg_class: b.to_string(),
                })
                .collect(),
            default_bg: "bg-background".to_string(),
        }
    }

    #[test]
    fn single_file_extraction() {
        let options = make_options(
            vec![("test.tsx", r##"<div className="bg-red-500 text-white">x</div>"##)],
            &[],
        );
        let results = extract_and_scan(&options);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "test.tsx");
        assert_eq!(results[0].regions.len(), 1);
        assert_eq!(results[0].regions[0].content, "bg-red-500 text-white");
    }

    #[test]
    fn multiple_files_parallel() {
        let options = make_options(
            vec![
                ("a.tsx", r##"<div className="text-white">a</div>"##),
                ("b.tsx", r##"<span className="text-black">b</span>"##),
                ("c.tsx", r##"<p className="text-red-500">c</p>"##),
            ],
            &[],
        );
        let results = extract_and_scan(&options);
        assert_eq!(results.len(), 3);
        // Rayon may reorder — collect paths and check all present
        let paths: Vec<&str> = results.iter().map(|r| r.path.as_str()).collect();
        assert!(paths.contains(&"a.tsx"));
        assert!(paths.contains(&"b.tsx"));
        assert!(paths.contains(&"c.tsx"));
    }

    #[test]
    fn container_config_propagated() {
        let options = make_options(
            vec![(
                "card.tsx",
                r##"<Card><span className="text-white">x</span></Card>"##,
            )],
            &[("Card", "bg-card")],
        );
        let results = extract_and_scan(&options);
        assert_eq!(results[0].regions[0].context_bg, "bg-card");
    }

    #[test]
    fn empty_files_returns_empty_regions() {
        let options = make_options(vec![("empty.tsx", "")], &[]);
        let results = extract_and_scan(&options);
        assert_eq!(results.len(), 1);
        assert!(results[0].regions.is_empty());
    }

    #[test]
    fn no_files_returns_empty() {
        let options = make_options(vec![], &[]);
        let results = extract_and_scan(&options);
        assert!(results.is_empty());
    }

    #[test]
    fn many_files_stress_test() {
        // Generate 50 files to verify rayon handles concurrent parsing
        let files: Vec<(String, String)> = (0..50)
            .map(|i| {
                (
                    format!("file_{}.tsx", i),
                    format!(r##"<div className="text-color-{}">content {}</div>"##, i, i),
                )
            })
            .collect();
        let options = ExtractOptions {
            file_contents: files
                .iter()
                .map(|(p, c)| FileInput {
                    path: p.clone(),
                    content: c.clone(),
                })
                .collect(),
            container_config: vec![],
            default_bg: "bg-background".to_string(),
        };
        let results = extract_and_scan(&options);
        assert_eq!(results.len(), 50);
        // Every file should have exactly 1 region
        for result in &results {
            assert_eq!(result.regions.len(), 1, "file {} has {} regions", result.path, result.regions.len());
        }
    }
}
